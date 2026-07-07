// Access tools (docs/FEATURES.md §13 "Allowlist edit / resolve; authorize;
// target resolve"): three operator utilities over the admin channel-access
// methods. Allowlist: resolve previews candidate ids against the surface
// directory (pure evaluation, no confirm), apply mutates the surface policy
// via channels.allowlist.edit behind ConfirmSurface with confirm +
// explicitUserRequest in the body (additionalProperties: true).
// Authorize (channels.authorize) is a dry-run policy probe — read-only, no
// confirm. Target resolve (channels.targets.resolve) is read-only UNLESS
// "create if missing" is checked, which can mint a conversation on the live
// surface — that path is confirm-gated.
//
// Results are one-shot mutations (operator submits a form), so no query keys;
// the surface picker reuses the channels.status query (same daemon vocabulary
// as the rest of the view).

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, ListChecks, ShieldQuestion } from "lucide-react";
import { invoke } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface, type ConfirmMetadata } from "../../components/ConfirmSurface.tsx";
import { channelsKeys } from "./keys.ts";
import {
  readAllowlistEditResult,
  readAllowlistResolution,
  readAuthorizeResult,
  readResolvedTarget,
  readStatusRows,
  type AllowlistResolution,
  type AuthorizeResult,
  type ResolvedTarget,
} from "./channels-wire.ts";

function splitIds(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function SurfaceSelect({
  value,
  onChange,
  surfaces,
}: {
  value: string;
  onChange: (next: string) => void;
  surfaces: string[];
}) {
  return (
    <label className="channels-filter">
      <span>Surface</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Pick a surface…</option>
        {surfaces.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AccessToolsPanel() {
  // Surface vocabulary comes from channels.status — shared cache with StatusBoard.
  const status = useQuery({
    queryKey: channelsKeys.status,
    queryFn: () => invoke("channels.status"),
    select: readStatusRows,
  });
  const surfaces = (status.data ?? []).map((row) => row.surface).filter(Boolean);

  return (
    <div className="channels-access">
      <AllowlistSection surfaces={surfaces} />
      <AuthorizeSection surfaces={surfaces} />
      <TargetResolveSection surfaces={surfaces} />
    </div>
  );
}

// ─── Allowlist: resolve preview + confirmed edit ─────────────────────────────

function AllowlistSection({ surfaces }: { surfaces: string[] }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [surface, setSurface] = useState("");
  const [kind, setKind] = useState("");
  const [addText, setAddText] = useState("");
  const [removeText, setRemoveText] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<AllowlistResolution | null>(null);

  const body = () => ({
    ...(splitIds(addText).length > 0 ? { add: splitIds(addText) } : {}),
    ...(splitIds(removeText).length > 0 ? { remove: splitIds(removeText) } : {}),
    ...(kind ? { kind } : {}),
  });
  const hasEntries = splitIds(addText).length > 0 || splitIds(removeText).length > 0;

  const resolve = useMutation({
    // Pure evaluation — resolves candidate handles into stable ids, writes nothing.
    mutationFn: () => invoke("channels.allowlist.resolve", { params: { surface }, body: body() }),
    onSuccess: (data) => setPreview(readAllowlistResolution(data)),
    onError: (error: unknown) =>
      toast({ title: "Resolve failed", description: formatError(error), tone: "danger" }),
  });

  const apply = useMutation({
    mutationFn: (meta: ConfirmMetadata) =>
      invoke("channels.allowlist.edit", { params: { surface }, body: { ...body(), ...meta } }),
    onSuccess: async (data) => {
      setConfirming(false);
      setPreview(null);
      setAddText("");
      setRemoveText("");
      await queryClient.invalidateQueries({ queryKey: channelsKeys.all });
      const result = readAllowlistEditResult(data);
      toast({
        title: `Allowlist updated on ${result.surface || surface}`,
        description: `Now ${result.userCount} users · ${result.channelCount} channels · ${result.groupCount} groups.`,
        tone: "success",
      });
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Allowlist edit failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!surface || !hasEntries || apply.isPending) return;
    setConfirming(true);
  }

  return (
    <section className="channels-access__section" aria-label="Allowlist editor">
      <h4 className="channels-health__heading">
        <ListChecks size={14} aria-hidden="true" /> Allowlist
      </h4>
      <p className="channels-access__hint">
        Add or remove ids on a surface's allowlist. Resolve previews how the surface interprets
        each entry before anything is written.
      </p>
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <div className="channels-filter-row">
          <SurfaceSelect value={surface} onChange={setSurface} surfaces={surfaces} />
          <label className="channels-filter">
            <span>Kind (optional)</span>
            <input
              type="text"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              placeholder="user | channel | group"
              spellCheck={false}
            />
          </label>
        </div>
        <div className="channels-policy-form__grid">
          <label className="channels-field">
            <span>Add (one per line)</span>
            <textarea
              rows={3}
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
              spellCheck={false}
              className="channels-field__code"
            />
          </label>
          <label className="channels-field">
            <span>Remove (one per line)</span>
            <textarea
              rows={3}
              value={removeText}
              onChange={(e) => setRemoveText(e.target.value)}
              spellCheck={false}
              className="channels-field__code"
            />
          </label>
        </div>
        <div className="channels-invoke__actions">
          <button
            type="button"
            className="channels-btn"
            disabled={!surface || !hasEntries || resolve.isPending}
            onClick={() => resolve.mutate()}
          >
            {resolve.isPending ? "Resolving…" : "Resolve (preview)"}
          </button>
          <button
            type="submit"
            className="channels-btn channels-btn--primary"
            disabled={!surface || !hasEntries || apply.isPending}
          >
            {apply.isPending ? "Applying…" : "Apply edit…"}
          </button>
        </div>
      </form>
      {preview && (
        <div className="channels-access__result" aria-label="Resolution preview">
          {preview.resolved.length === 0 && preview.unresolved.length === 0 && (
            <span className="channels-access__hint">The surface resolved nothing for these entries.</span>
          )}
          {preview.resolved.map((entry) => (
            <span key={`${entry.kind}:${entry.id}`} className="channels-access__resolved">
              <span className="badge ok">{entry.kind || "resolved"}</span>
              {entry.label} <code>{entry.id}</code>
              <span className="channels-access__from">from {entry.input}</span>
            </span>
          ))}
          {preview.unresolved.map((input) => (
            <span key={input} className="channels-access__resolved">
              <span className="badge warning">unresolved</span>
              <code>{input}</code>
            </span>
          ))}
        </div>
      )}
      <ConfirmSurface
        open={confirming}
        action="Edit channel allowlist"
        target={surface}
        blastRadius="Changes who this surface will answer — allowlist edits take effect immediately for every agent replying on this channel."
        confirmLabel="Apply edit"
        onConfirm={(meta) => apply.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}

// ─── Authorize probe (dry-run evaluation, read-only) ─────────────────────────

function AuthorizeSection({ surfaces }: { surfaces: string[] }) {
  const { toast } = useToast();
  const [surface, setSurface] = useState("");
  const [actionId, setActionId] = useState("");
  const [actorId, setActorId] = useState("");
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<AuthorizeResult | null>(null);

  const probe = useMutation({
    mutationFn: () =>
      invoke("channels.authorize", {
        params: { surface },
        body: {
          actionId,
          ...(actorId ? { actorId } : {}),
          ...(target ? { target } : {}),
        },
      }),
    onSuccess: (data) => setResult(readAuthorizeResult(data)),
    onError: (error: unknown) =>
      toast({ title: "Authorization check failed", description: formatError(error), tone: "danger" }),
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!surface || !actionId.trim() || probe.isPending) return;
    probe.mutate();
  }

  return (
    <section className="channels-access__section" aria-label="Authorization probe">
      <h4 className="channels-health__heading">
        <ShieldQuestion size={14} aria-hidden="true" /> Authorize
      </h4>
      <p className="channels-access__hint">
        Dry-run: asks the daemon whether an action would be allowed on a surface. Nothing runs.
      </p>
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <div className="channels-filter-row">
          <SurfaceSelect value={surface} onChange={setSurface} surfaces={surfaces} />
          <label className="channels-filter channels-filter--grow">
            <span>Action id (required)</span>
            <input
              type="text"
              value={actionId}
              onChange={(e) => setActionId(e.target.value)}
              placeholder="e.g. send"
              spellCheck={false}
            />
          </label>
          <label className="channels-filter">
            <span>Actor id (optional)</span>
            <input type="text" value={actorId} onChange={(e) => setActorId(e.target.value)} spellCheck={false} />
          </label>
          <label className="channels-filter">
            <span>Target (optional)</span>
            <input type="text" value={target} onChange={(e) => setTarget(e.target.value)} spellCheck={false} />
          </label>
          <button
            type="submit"
            className="channels-btn"
            disabled={!surface || !actionId.trim() || probe.isPending}
          >
            {probe.isPending ? "Checking…" : "Check"}
          </button>
        </div>
      </form>
      {result && (
        <div className="channels-access__result" aria-live="polite">
          <span className={result.allowed ? "badge ok" : "badge bad"}>
            {result.allowed ? "allowed" : "denied"}
          </span>
          {result.reason && <span>{result.reason}</span>}
          {result.accountLabel && <code>account: {result.accountLabel}</code>}
        </div>
      )}
    </section>
  );
}

// ─── Target resolver (read-only unless create-if-missing) ────────────────────

function TargetResolveSection({ surfaces }: { surfaces: string[] }) {
  const { toast } = useToast();
  const [surface, setSurface] = useState("");
  const [input, setInput] = useState("");
  const [preferredKind, setPreferredKind] = useState("");
  const [live, setLive] = useState(false);
  const [createIfMissing, setCreateIfMissing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ResolvedTarget | null>(null);

  const resolve = useMutation({
    mutationFn: (meta: ConfirmMetadata | undefined) =>
      invoke("channels.targets.resolve", {
        params: { surface },
        body: {
          input,
          ...(preferredKind ? { preferredKind } : {}),
          ...(live ? { live } : {}),
          ...(createIfMissing ? { createIfMissing } : {}),
          ...(meta ?? {}),
        },
      }),
    onSuccess: (data) => {
      setConfirming(false);
      setResult(readResolvedTarget(data));
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "Target resolve failed", description: formatError(error), tone: "danger" });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (!surface || !input.trim() || resolve.isPending) return;
    // create-if-missing can mint a conversation on the live surface — confirm it.
    if (createIfMissing) setConfirming(true);
    else resolve.mutate(undefined);
  }

  return (
    <section className="channels-access__section" aria-label="Target resolver">
      <h4 className="channels-health__heading">
        <Crosshair size={14} aria-hidden="true" /> Resolve target
      </h4>
      <p className="channels-access__hint">
        Turns a handle, address, or channel name into the exact delivery target a send would use.
      </p>
      <form className="channels-policy-form" onSubmit={handleSubmit}>
        <div className="channels-filter-row">
          <SurfaceSelect value={surface} onChange={setSurface} surfaces={surfaces} />
          <label className="channels-filter channels-filter--grow">
            <span>Input (required)</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="@handle, #channel, phone number…"
              spellCheck={false}
            />
          </label>
          <label className="channels-filter">
            <span>Preferred kind (optional)</span>
            <input
              type="text"
              value={preferredKind}
              onChange={(e) => setPreferredKind(e.target.value)}
              placeholder="user | channel | group"
              spellCheck={false}
            />
          </label>
          <label className="channels-filter channels-filter--check">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>Live lookup</span>
          </label>
          <label className="channels-filter channels-filter--check">
            <input
              type="checkbox"
              checked={createIfMissing}
              onChange={(e) => setCreateIfMissing(e.target.checked)}
            />
            <span>Create if missing</span>
          </label>
          <button
            type="submit"
            className="channels-btn"
            disabled={!surface || !input.trim() || resolve.isPending}
          >
            {resolve.isPending ? "Resolving…" : createIfMissing ? "Resolve…" : "Resolve"}
          </button>
        </div>
      </form>
      {result && (
        <div className="channels-access__result" aria-live="polite">
          <span className="badge ok">{result.kind || "target"}</span>
          <span>{result.display || result.normalized || result.to}</span>
          <code>to: {result.to}</code>
          {result.channelId && <code>channel {result.channelId}</code>}
          {result.threadId && <code>thread {result.threadId}</code>}
          {result.accountId && <code>account {result.accountId}</code>}
          {result.source && <span className="channels-access__from">via {result.source}</span>}
        </div>
      )}
      <ConfirmSurface
        open={confirming}
        action="Resolve target with create-if-missing"
        target={`${input} on ${surface}`}
        blastRadius="If no conversation exists for this target, the surface CREATES one — visible to the recipient on the real channel."
        danger
        confirmLabel="Resolve and create"
        onConfirm={(meta) => resolve.mutate(meta)}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
