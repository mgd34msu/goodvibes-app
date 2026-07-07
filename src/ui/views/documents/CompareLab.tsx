// Blind model compare (docs/FEATURES.md §11): pick a prompt + two models,
// run the same prompt through two companion chat sessions (one per model),
// show the replies side-by-side ANONYMIZED as A/B, let the user judge, THEN
// reveal which model wrote which. The judgment is recorded to the app-local
// notes registry tagged "model-compare", and the winner can be promoted to
// the daemon's default model via confirm-gated config.set provider.model.
//
// Replies are POLLED off companion.chat.messages.list every 2.5s while a
// compare is in flight — this view deliberately does not open chat's
// per-session SSE streams (that is the chat surface's machinery; a short
// poll is honest and self-contained here).

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { formatError, errorStatus } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { asRecord, firstArray, firstString, formatRelative, readPath } from "../../lib/wire.ts";
import { MarkdownMessage } from "../../components/MarkdownMessage.tsx";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { compareModelOptionsFrom, type CompareModelOption } from "./compare-models.ts";
import { createNote, docKeys, listNotes } from "./documents-data.ts";

// ─── Wire helpers (local, defensive) ─────────────────────────────────────────

function sessionIdFrom(created: unknown): string {
  return (
    firstString(created, ["sessionId", "id"]) ||
    firstString(readPath(created, ["session"]), ["sessionId", "id"]) ||
    firstString(readPath(created, ["data"]), ["sessionId", "id"])
  );
}

function messagesFrom(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  for (const path of [["messages"], ["items"], ["data"], ["result", "messages"], ["data", "messages"]]) {
    const value = readPath(response, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function messageRole(message: unknown): string {
  return firstString(message, ["role", "author", "kind"]).toLowerCase();
}

function messageContent(message: unknown): string {
  const direct = firstString(message, ["content", "body", "text", "message"]);
  if (direct) return direct;
  return firstArray(message, ["parts", "content"])
    .map((part) => firstString(part, ["text", "content", "body"]))
    .filter(Boolean)
    .join("\n");
}

function latestAssistantReply(response: unknown): string {
  const messages = messagesFrom(response);
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const role = messageRole(message);
    if ((role.includes("assistant") || role.includes("model") || role.includes("agent")) && messageContent(message)) {
      return messageContent(message);
    }
  }
  return "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Slot state machine ──────────────────────────────────────────────────────

type SlotId = "a" | "b";

type SlotState =
  | { phase: "starting" }
  | { phase: "waiting"; sessionId: string }
  | { phase: "done"; sessionId: string; content: string }
  | { phase: "failed"; sessionId: string; message: string };

interface ActiveRun {
  prompt: string;
  /** Which real model landed in each anonymized slot (randomized). */
  assignments: Record<SlotId, CompareModelOption>;
}

const POLL_MS = 2_500;
const REPLY_DEADLINE_MS = 180_000;

export function CompareLab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const providersQuery = useQuery({ queryKey: queryKeys.providers, queryFn: () => gv.providers.list() });
  const modelOptions = useMemo(() => compareModelOptionsFrom(providersQuery.data), [providersQuery.data]);

  const [prompt, setPrompt] = useState("");
  const [leftKey, setLeftKey] = useState("");
  const [rightKey, setRightKey] = useState("");
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [slots, setSlots] = useState<Record<SlotId, SlotState>>({
    a: { phase: "starting" },
    b: { phase: "starting" },
  });
  const [verdict, setVerdict] = useState<"" | SlotId | "tie">("");
  const [promoteTarget, setPromoteTarget] = useState<CompareModelOption | null>(null);
  // Monotonic token: bumping it makes in-flight slot loops drop their writes.
  const runToken = useRef(0);

  useEffect(
    () => () => {
      runToken.current++;
    },
    [],
  );

  function setSlot(token: number, slot: SlotId, state: SlotState): void {
    if (runToken.current !== token) return;
    setSlots((current) => ({ ...current, [slot]: state }));
  }

  async function runSlot(token: number, slot: SlotId, option: CompareModelOption, promptText: string): Promise<void> {
    let sessionId = "";
    try {
      const created = await gv.chat.sessions.create({
        title: `Blind compare — response ${slot.toUpperCase()}`,
        provider: option.providerId,
        model: option.modelId,
      });
      sessionId = sessionIdFrom(created);
      if (!sessionId) throw new Error("Session create did not return a session id");
      setSlot(token, slot, { phase: "waiting", sessionId });
      await gv.chat.messages.create(sessionId, { content: promptText });
      const deadline = Date.now() + REPLY_DEADLINE_MS;
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        if (runToken.current !== token) return;
        const listed = await gv.chat.messages.list(sessionId);
        const reply = latestAssistantReply(listed);
        if (reply) {
          setSlot(token, slot, { phase: "done", sessionId, content: reply });
          return;
        }
      }
      setSlot(token, slot, {
        phase: "failed",
        sessionId,
        message: `No reply within ${REPLY_DEADLINE_MS / 1000}s — the model may still be running; check the Chat view.`,
      });
    } catch (error) {
      setSlot(token, slot, { phase: "failed", sessionId, message: formatError(error) });
    }
  }

  function startCompare(): void {
    const left = modelOptions.find((o) => o.registryKey === leftKey);
    const right = modelOptions.find((o) => o.registryKey === rightKey);
    const trimmed = prompt.trim();
    if (!left || !right || !trimmed) return;
    // Randomize which model becomes A vs B — the whole point of "blind".
    const flip = Math.random() < 0.5;
    const assignments: Record<SlotId, CompareModelOption> = flip
      ? { a: right, b: left }
      : { a: left, b: right };
    const token = ++runToken.current;
    setRun({ prompt: trimmed, assignments });
    setSlots({ a: { phase: "starting" }, b: { phase: "starting" } });
    setVerdict("");
    void runSlot(token, "a", assignments.a, trimmed);
    void runSlot(token, "b", assignments.b, trimmed);
  }

  const recordJudgment = useMutation({
    mutationFn: async (picked: SlotId | "tie") => {
      if (!run) throw new Error("No active comparison");
      const winner = picked === "tie" ? null : run.assignments[picked];
      const loser = picked === "tie" ? null : run.assignments[picked === "a" ? "b" : "a"];
      const summary =
        picked === "tie"
          ? `Blind compare tie between ${run.assignments.a.registryKey} and ${run.assignments.b.registryKey}`
          : `Blind compare: ${winner?.registryKey} beat ${loser?.registryKey}`;
      await createNote({
        text: `${summary} — prompt: "${run.prompt.slice(0, 200)}"`,
        tags: ["model-compare"],
        verdict: picked === "tie" ? "tie" : "winner",
        winner: winner?.registryKey ?? "",
        models: { a: run.assignments.a.registryKey, b: run.assignments.b.registryKey },
        prompt: run.prompt,
        judgedAt: Date.now(),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: docKeys.compareNotes });
      toast({ title: "Judgment recorded", tone: "success" });
    },
    onError: (error: unknown) => {
      const status = errorStatus(error);
      toast({
        title: "Judgment not recorded",
        description:
          status === 404 || status === 501
            ? "The app-local notes registry is not served by this build — the verdict is shown but not stored."
            : formatError(error),
        tone: "warning",
      });
    },
  });

  function pickVerdict(picked: SlotId | "tie"): void {
    if (!run || verdict) return;
    setVerdict(picked);
    recordJudgment.mutate(picked);
    // Hygiene: close both compare sessions best-effort — they served their turn.
    for (const slot of ["a", "b"] as const) {
      const state = slots[slot];
      if (state.phase === "done" || state.phase === "waiting") {
        void gv.chat.sessions.close(state.sessionId).catch(() => undefined);
      }
    }
  }

  const setDefault = useMutation({
    mutationFn: (option: CompareModelOption) => gv.config.set({ key: "provider.model", value: option.registryKey }),
    onSuccess: async (_result, option) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.configAll });
      setPromoteTarget(null);
      toast({ title: "Default model updated", description: option.registryKey, tone: "success" });
    },
    onError: (error: unknown) =>
      toast({ title: "config.set failed", description: formatError(error), tone: "danger" }),
  });

  // Past judgments — app-local registry, no wire events: 30s poll.
  const notesQuery = useQuery({
    queryKey: docKeys.compareNotes,
    queryFn: listNotes,
    refetchInterval: 30_000,
    retry: false,
  });
  const judgments = useMemo(
    () =>
      (notesQuery.data ?? [])
        .filter((note) => Array.isArray(note["tags"]) && note["tags"].includes("model-compare"))
        .sort((x, y) => (Number(asRecord(y)["createdAt"]) || 0) - (Number(asRecord(x)["createdAt"]) || 0))
        .slice(0, 10),
    [notesQuery.data],
  );

  const bothSettled =
    run !== null && (slots.a.phase === "done" || slots.a.phase === "failed") && (slots.b.phase === "done" || slots.b.phase === "failed");
  const revealed = verdict !== "";
  const winnerOption = verdict === "a" || verdict === "b" ? (run?.assignments[verdict] ?? null) : null;

  return (
    <section className="compare-lab" aria-label="Blind model compare">
      <div className="compare-lab__setup">
        <label className="compare-lab__label" htmlFor="compare-prompt">
          Prompt (sent identically to both models)
        </label>
        <textarea
          id="compare-prompt"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="One prompt, two models, blind judgment."
        />
        {providersQuery.isError ? (
          <ErrorState
            error={providersQuery.error}
            onRetry={() => void providersQuery.refetch()}
            title="Provider catalog failed to load"
          />
        ) : (
          <div className="compare-lab__models">
            <select value={leftKey} onChange={(e) => setLeftKey(e.target.value)} aria-label="First model">
              <option value="">
                {providersQuery.isPending
                  ? "Loading models…"
                  : modelOptions.length === 0
                    ? "No models listed by providers.list"
                    : "Pick model 1…"}
              </option>
              {modelOptions.map((o) => (
                <option key={o.registryKey} value={o.registryKey}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="compare-lab__vs" aria-hidden="true">
              vs
            </span>
            <select value={rightKey} onChange={(e) => setRightKey(e.target.value)} aria-label="Second model">
              <option value="">Pick model 2…</option>
              {modelOptions.map((o) => (
                <option key={o.registryKey} value={o.registryKey} disabled={o.registryKey === leftKey}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="compare-lab__start"
              onClick={startCompare}
              disabled={!prompt.trim() || !leftKey || !rightKey || leftKey === rightKey}
              title={leftKey && leftKey === rightKey ? "Pick two different models" : undefined}
            >
              <Scale size={14} aria-hidden="true" /> Run blind compare
            </button>
          </div>
        )}
      </div>

      {run && (
        <>
          <div className="compare-lab__arena">
            {(["a", "b"] as const).map((slot) => {
              const state = slots[slot];
              return (
                <article key={slot} className="compare-slot" aria-label={`Response ${slot.toUpperCase()}`}>
                  <header className="compare-slot__header">
                    <span className="compare-slot__name">Response {slot.toUpperCase()}</span>
                    {revealed ? (
                      <span className="badge neutral">{run.assignments[slot].registryKey}</span>
                    ) : (
                      <span className="badge info">model hidden</span>
                    )}
                  </header>
                  <div className="compare-slot__body">
                    {state.phase === "starting" && <SkeletonBlock variant="text" lines={3} />}
                    {state.phase === "waiting" && (
                      <p className="compare-slot__waiting" role="status">
                        Waiting for the reply… (polling every {POLL_MS / 1000}s)
                      </p>
                    )}
                    {state.phase === "failed" && (
                      <ErrorState error={new Error(state.message)} title="This side failed" />
                    )}
                    {state.phase === "done" && <MarkdownMessage content={state.content} />}
                  </div>
                </article>
              );
            })}
          </div>

          {!revealed && (
            <div className="compare-lab__verdict" role="group" aria-label="Pick a winner">
              <span className="compare-lab__verdict-hint">
                {bothSettled ? "Judge before the models are revealed:" : "Both replies must settle before judging."}
              </span>
              <button type="button" onClick={() => pickVerdict("a")} disabled={!bothSettled || slots.a.phase !== "done"}>
                A wins
              </button>
              <button type="button" onClick={() => pickVerdict("tie")} disabled={!bothSettled}>
                Tie
              </button>
              <button type="button" onClick={() => pickVerdict("b")} disabled={!bothSettled || slots.b.phase !== "done"}>
                B wins
              </button>
            </div>
          )}

          {revealed && (
            <div className="compare-lab__reveal" role="status">
              <p>
                {verdict === "tie" ? (
                  <>
                    Tie — A was <strong>{run.assignments.a.registryKey}</strong>, B was{" "}
                    <strong>{run.assignments.b.registryKey}</strong>.
                  </>
                ) : (
                  <>
                    Winner: <strong>{winnerOption?.registryKey}</strong> (response {verdict.toUpperCase()}). The other
                    side was{" "}
                    <strong>{run.assignments[verdict === "a" ? "b" : "a"].registryKey}</strong>.
                  </>
                )}
              </p>
              {winnerOption && (
                <button type="button" onClick={() => setPromoteTarget(winnerOption)}>
                  Set {winnerOption.registryKey} as default model…
                </button>
              )}
            </div>
          )}
        </>
      )}

      {!run && (
        <EmptyState
          icon={<Scale size={28} aria-hidden="true" />}
          title="No comparison running"
          description="Model names stay hidden until you pick a winner — judgments are recorded to the notes registry tagged model-compare."
        />
      )}

      <div className="compare-lab__history">
        <h3 className="compare-lab__history-title">Past judgments</h3>
        {notesQuery.isPending && <SkeletonBlock variant="text" lines={2} />}
        {notesQuery.isError && (
          <p className="compare-lab__history-note" role="status">
            Judgment history unavailable — the notes registry did not answer (
            {formatError(notesQuery.error)}).
          </p>
        )}
        {notesQuery.isSuccess && judgments.length === 0 && (
          <p className="compare-lab__history-note">No recorded judgments yet.</p>
        )}
        {judgments.length > 0 && (
          <ul className="compare-lab__history-list">
            {judgments.map((note, index) => (
              <li key={firstString(note, ["id"]) || index}>
                <span>{firstString(note, ["text"])}</span>
                <span className="compare-lab__history-time">{formatRelative(note["createdAt"])}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmSurface
        open={promoteTarget !== null}
        action="Set default model"
        target={promoteTarget?.registryKey ?? ""}
        blastRadius="Writes provider.model in the daemon config (admin) — every surface that uses the default model route (TUI, agent, new chats) switches to this model."
        confirmLabel="Set as default"
        onCancel={() => setPromoteTarget(null)}
        onConfirm={() => {
          if (promoteTarget) setDefault.mutate(promoteTarget);
        }}
      />
    </section>
  );
}
