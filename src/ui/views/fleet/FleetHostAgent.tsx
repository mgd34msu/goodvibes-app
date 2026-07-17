// FleetHostAgent — the fleet toolbar's "Host agent" affordance
// (acp.agents.list / acp.sessions.create, operator contract 1.11):
// daemon-as-ACP-client hosting of a third-party coding agent (Claude Code,
// Codex, opencode) as a long-lived daemon session that appears as a
// steerable/stoppable fleet row (kind 'acp-agent').
//
// Working directory is picked from KNOWN CANDIDATES ONLY — the
// GOODVIBES_WORKING_DIR default (/app/git/workspace) plus every registered
// workspace root (workspaces.registrations.list) — never a free-text path.
// A structured spawn failure ({binary, stage, message}) is rendered
// verbatim, never a hung row: the daemon bounds the handshake itself.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { queryKeys } from "../../lib/queries.ts";
import { appJson } from "../../lib/http.ts";
import { formatError, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { EmptyState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { asArray, asRecord, firstString } from "../../lib/wire.ts";

interface DiscoveredAgent {
  readonly id: string;
  readonly title: string;
  readonly binaryPath: string;
}

interface DirCandidate {
  readonly path: string;
  readonly label: string;
}

interface HostedError {
  readonly binary: string;
  readonly stage: string;
  readonly message: string;
}

function normalizeAgent(value: unknown): DiscoveredAgent {
  const record = asRecord(value);
  return {
    id: firstString(record, ["id"]),
    title: firstString(record, ["title"]) || firstString(record, ["id"]),
    binaryPath: firstString(record, ["binaryPath"]),
  };
}

function readHostedError(value: unknown): HostedError | null {
  const record = asRecord(value);
  const errorRecord = record["error"];
  if (errorRecord === null || errorRecord === undefined) return null;
  const rec = asRecord(errorRecord);
  return {
    binary: firstString(rec, ["binary"]),
    stage: firstString(rec, ["stage"]),
    message: firstString(rec, ["message"]),
  };
}

export function FleetHostAgentButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="fleet-action" title="Host a third-party coding agent" onClick={() => setOpen(true)}>
        <Bot size={13} aria-hidden="true" /> Host agent
      </button>
      {open && <FleetHostAgentModal onClose={() => setOpen(false)} />}
    </>
  );
}

function FleetHostAgentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [agentId, setAgentId] = useState("");
  const [cwd, setCwd] = useState("");

  const agents = useQuery({
    queryKey: queryKeys.acpAgents,
    queryFn: async () => {
      const raw = asRecord(await gv.acp.agents.list());
      return asArray(raw["agents"]).map(normalizeAgent);
    },
    retry: false,
  });

  const workspace = useQuery({
    queryKey: ["fleet", "acp", "workspace-default"] as const,
    queryFn: () => appJson<{ workspaceDir?: string }>("/app/git/workspace"),
    retry: false,
  });

  const registrations = useQuery({
    queryKey: queryKeys.workspaceRegistrations,
    queryFn: async () => {
      const raw = asRecord(await gv.workspaces.registrations.list());
      return asArray(raw["workspaces"]).map((entry) => {
        const record = asRecord(entry);
        return { root: firstString(record, ["root"]), label: firstString(record, ["label"]) };
      });
    },
    retry: false,
  });

  const candidates: DirCandidate[] = useMemo(() => {
    const list: DirCandidate[] = [];
    const defaultDir = workspace.data?.workspaceDir ?? "";
    if (defaultDir) list.push({ path: defaultDir, label: "current directory" });
    for (const ws of registrations.data ?? []) {
      if (!ws.root || ws.root === defaultDir) continue;
      list.push({ path: ws.root, label: ws.label || "registered workspace" });
    }
    return list;
  }, [workspace.data, registrations.data]);

  const create = useMutation({
    mutationFn: (input: { agentId: string; cwd: string }) => gv.acp.sessions.create(input),
    onSuccess: async (result) => {
      const record = asRecord(result);
      const hosted = asRecord(record["hosted"]);
      const hostedError = readHostedError(record["hosted"]);
      const title = firstString(hosted, ["title"]) || agentId;
      if (hostedError) {
        toast({
          title: `Could not host ${title}`,
          description: `${hostedError.stage} stage failed for ${hostedError.binary} — ${hostedError.message}`,
          tone: "danger",
          durationMs: 0,
        });
        return;
      }
      toast({ title: `Hosting ${title}`, description: `Running in ${cwd} — appears as an acp-agent fleet row.`, tone: "success" });
      await queryClient.invalidateQueries({ queryKey: queryKeys.fleet });
      onClose();
    },
    onError: (error: unknown) => toast({ title: "Could not host agent", description: formatError(error), tone: "danger" }),
  });

  const agentsUnavailable = agents.isError && isMethodUnavailableError(agents.error);
  const canCreate = Boolean(agentId) && Boolean(cwd) && !create.isPending;

  return (
    <Modal open onClose={onClose} title="Host a third-party coding agent" size="md">
      <div className="fleet-host-agent">
        {agents.isPending && <SkeletonBlock variant="text" lines={3} />}
        {agentsUnavailable && (
          <UnavailableState capability="acp.agents.list" description="this daemon cannot discover third-party coding agents" />
        )}
        {agents.isSuccess && agents.data.length === 0 && (
          <EmptyState
            icon={<Bot size={26} />}
            title="No third-party agents discovered"
            description="Install Claude Code, Codex CLI, or opencode on this machine's PATH to host it here."
          />
        )}
        {agents.isSuccess && agents.data.length > 0 && (
          <>
            <fieldset className="fleet-host-agent__field">
              <legend>Agent</legend>
              {agents.data.map((agent) => (
                <label key={agent.id} className="fleet-host-agent__option">
                  <input
                    type="radio"
                    name="acp-agent"
                    value={agent.id}
                    checked={agentId === agent.id}
                    onChange={() => setAgentId(agent.id)}
                  />
                  <span>
                    {agent.title} <small>{agent.binaryPath}</small>
                  </span>
                </label>
              ))}
            </fieldset>

            <fieldset className="fleet-host-agent__field">
              <legend>Working directory (known directories only)</legend>
              {candidates.length === 0 ? (
                <p className="fleet-host-agent__note" role="note">
                  No known directory yet — register a workspace or wait for the default to load.
                </p>
              ) : (
                candidates.map((candidate) => (
                  <label key={candidate.path} className="fleet-host-agent__option">
                    <input
                      type="radio"
                      name="acp-dir"
                      value={candidate.path}
                      checked={cwd === candidate.path}
                      onChange={() => setCwd(candidate.path)}
                    />
                    <span>
                      {candidate.label} <small>{candidate.path}</small>
                    </span>
                  </label>
                ))
              )}
            </fieldset>

            <div className="fleet-host-agent__actions">
              <button
                type="button"
                className="fleet-action fleet-action--primary"
                disabled={!canCreate}
                onClick={() => create.mutate({ agentId, cwd })}
              >
                {create.isPending ? (
                  <>
                    <Loader2 size={13} className="spinning" aria-hidden="true" /> Hosting…
                  </>
                ) : (
                  "Host here"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
