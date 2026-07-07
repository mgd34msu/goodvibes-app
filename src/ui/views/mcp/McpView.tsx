// MCP workspace (docs/FEATURES.md §16): servers list with connection status,
// transport command, and per-server tool counts; the namespaced tools browser
// (mcp:<server>:<tool>); the merged config view (locations + registrations);
// reload / upsert / remove — all admin-gated behind ConfirmSurface. Realtime:
// every query key extends the ["mcp"] prefix, which the `mcp` wire domain in
// DOMAIN_INVALIDATIONS already invalidates — no polling needed here.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, Plus, RefreshCw, RotateCw, Search, Wrench } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, errorStatus, isMethodUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import {
  formatReloadSummary,
  mcpKeys,
  readConfigLocations,
  readConfiguredServers,
  readReloadSummary,
  readSandboxBindings,
  readSecurityPosture,
  readServerStatuses,
  readTools,
  type McpConfiguredServer,
} from "./mcp-data.ts";
import { ServerEditorModal, type ServerEditorSubmit } from "./ServerEditorModal.tsx";

export function McpView(): React.ReactElement {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [toolSearch, setToolSearch] = useState("");
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<McpConfiguredServer | null>(null);
  const [removeTarget, setRemoveTarget] = useState<McpConfiguredServer | null>(null);

  // Reads — all invalidated by the `mcp` realtime domain (lib/realtime.ts).
  const servers = useQuery({ queryKey: mcpKeys.servers, queryFn: () => gv.invoke("mcp.servers.list"), retry: false });
  const tools = useQuery({ queryKey: mcpKeys.tools, queryFn: () => gv.invoke("mcp.tools.list"), retry: false });
  const config = useQuery({ queryKey: mcpKeys.config, queryFn: () => gv.invoke("mcp.config.get"), retry: false });

  const statuses = useMemo(() => readServerStatuses(servers.data), [servers.data]);
  const security = useMemo(() => readSecurityPosture(servers.data), [servers.data]);
  const sandboxBindings = useMemo(() => readSandboxBindings(servers.data), [servers.data]);
  const toolRows = useMemo(() => readTools(tools.data), [tools.data]);
  const locations = useMemo(() => readConfigLocations(config.data), [config.data]);
  const configured = useMemo(() => readConfiguredServers(config.data), [config.data]);

  const toolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tool of toolRows) counts.set(tool.serverName, (counts.get(tool.serverName) ?? 0) + 1);
    return counts;
  }, [toolRows]);

  // Server rows: union of runtime statuses and config registrations, so a
  // configured-but-never-connected server and a runtime-only one both render.
  const serverRows = useMemo(() => {
    const byName = new Map<string, { name: string; connected: boolean | null; config: McpConfiguredServer | null }>();
    for (const status of statuses) {
      byName.set(status.name, { name: status.name, connected: status.connected, config: null });
    }
    for (const entry of configured) {
      const existing = byName.get(entry.name);
      if (existing) existing.config = entry;
      else byName.set(entry.name, { name: entry.name, connected: null, config: entry });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [statuses, configured]);

  const filteredTools = useMemo(() => {
    const q = toolSearch.trim().toLowerCase();
    if (!q) return toolRows;
    return toolRows.filter(
      (tool) =>
        tool.qualifiedName.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.serverName.toLowerCase().includes(q),
    );
  }, [toolRows, toolSearch]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: mcpKeys.root });

  // ── mutations ──────────────────────────────────────────────────────────────

  const reload = useMutation({
    // mcp.config.reload input is additionalProperties:false — the confirm gate
    // is client-side (ConfirmSurface), nothing extra rides the wire.
    mutationFn: () => gv.invoke("mcp.config.reload"),
    onSuccess: async (result) => {
      setReloadConfirmOpen(false);
      await invalidate();
      toast({ title: "MCP config reloaded", description: formatReloadSummary(readReloadSummary(result)), tone: "success" });
    },
    onError: (error: unknown) => toast({ title: "Reload failed", description: formatError(error), tone: "danger" }),
  });

  const upsert = useMutation({
    mutationFn: (payload: ServerEditorSubmit) => gv.invoke("mcp.servers.upsert", { body: payload }),
    onSuccess: async (result, payload) => {
      setEditorOpen(false);
      setEditTarget(null);
      await invalidate();
      toast({
        title: `Server "${payload.server.name}" saved`,
        description: formatReloadSummary(readReloadSummary(result)),
        tone: "success",
      });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: formatError(error), tone: "danger" }),
  });

  const remove = useMutation({
    // Remove input is additionalProperties:false (serverName + scope only).
    mutationFn: (target: McpConfiguredServer) =>
      gv.invoke("mcp.servers.remove", {
        params: { serverName: target.name },
        query:
          target.source?.scope === "project" || target.source?.scope === "global"
            ? { scope: target.source.scope }
            : undefined,
      }),
    onSuccess: async (result, target) => {
      setRemoveTarget(null);
      await invalidate();
      toast({
        title: `Server "${target.name}" removed`,
        description: formatReloadSummary(readReloadSummary(result)),
        tone: "info",
      });
    },
    onError: (error: unknown) => toast({ title: "Remove failed", description: formatError(error), tone: "danger" }),
  });

  // Palette commands — view-scoped, live only while the view is mounted.
  useEffect(() => {
    registerCommand({
      id: "mcp.refresh",
      title: "Refresh MCP",
      group: "system",
      keywords: ["mcp", "servers", "tools", "reload list"],
      run: () => void queryClient.invalidateQueries({ queryKey: mcpKeys.root }),
    });
    registerCommand({
      id: "mcp.reloadConfig",
      title: "Reload MCP Config",
      group: "system",
      keywords: ["mcp", "reload", "config"],
      run: () => setReloadConfirmOpen(true),
    });
    registerCommand({
      id: "mcp.addServer",
      title: "Add MCP Server",
      group: "system",
      keywords: ["mcp", "server", "register", "new"],
      run: () => {
        setEditTarget(null);
        setEditorOpen(true);
      },
    });
    return () => {
      unregisterCommand("mcp.refresh");
      unregisterCommand("mcp.reloadConfig");
      unregisterCommand("mcp.addServer");
    };
  }, [queryClient]);

  const serversUnavailable = servers.isError && isMethodUnavailableError(servers.error);
  const toolsUnavailable = tools.isError && isMethodUnavailableError(tools.error);
  const configUnavailable = config.isError && isMethodUnavailableError(config.error);
  const configRefused = config.isError && errorStatus(config.error) === 403;

  const connectedCount = statuses.filter((s) => s.connected).length;

  return (
    <div className="mcp-view">
      {/* ── Servers ── */}
      <section className="mcp-servers" aria-label="MCP servers">
        <div className="section-toolbar">
          <span className="section-toolbar__summary">
            <Plug size={14} aria-hidden="true" /> Servers
            {servers.isSuccess ? ` · ${connectedCount}/${statuses.length} connected` : ""}
          </span>
          <span className="mcp-toolbar-actions">
            <button
              type="button"
              className="mcp-action"
              onClick={() => {
                setEditTarget(null);
                setEditorOpen(true);
              }}
            >
              <Plus size={13} aria-hidden="true" /> Add server
            </button>
            <button type="button" className="mcp-action" onClick={() => setReloadConfirmOpen(true)}>
              <RotateCw size={13} aria-hidden="true" /> Reload config
            </button>
            <button
              type="button"
              className="section-toolbar__refresh"
              aria-label="Refresh MCP data"
              onClick={() => void invalidate()}
            >
              <RefreshCw
                size={15}
                aria-hidden="true"
                className={servers.isFetching || tools.isFetching || config.isFetching ? "spinning" : undefined}
              />
            </button>
          </span>
        </div>

        {servers.isPending && <SkeletonBlock variant="text" lines={4} />}

        {serversUnavailable && (
          <UnavailableState capability="mcp.servers.list" description="MCP servers cannot be listed on this daemon." />
        )}

        {servers.isError && !serversUnavailable && (
          <ErrorState error={servers.error} onRetry={() => void servers.refetch()} title="Failed to load MCP servers" />
        )}

        {servers.isSuccess && serverRows.length === 0 && (
          <EmptyState
            icon={<Plug size={28} aria-hidden="true" />}
            title="No MCP servers registered"
            description="Register a server to add its tools to every agent using this daemon."
            action={{
              label: "Add server",
              onClick: () => {
                setEditTarget(null);
                setEditorOpen(true);
              },
            }}
          />
        )}

        {servers.isSuccess && serverRows.length > 0 && (
          <ul className="mcp-server-rows">
            {serverRows.map((row) => (
              <li key={row.name} className="mcp-server-row">
                <div className="mcp-server-row__head">
                  <span className="mcp-server-row__name">{row.name}</span>
                  {row.connected === null ? (
                    <span className="badge neutral" title="In config but not reported by the runtime — reload may be needed">
                      not loaded
                    </span>
                  ) : (
                    <span className={row.connected ? "badge ok" : "badge bad"}>
                      {row.connected ? "connected" : "disconnected"}
                    </span>
                  )}
                  <span className="badge info">
                    {toolCounts.get(row.name) ?? 0} tool{(toolCounts.get(row.name) ?? 0) === 1 ? "" : "s"}
                  </span>
                  {row.config?.trustMode && <span className="badge warning">trust: {row.config.trustMode}</span>}
                  {row.config?.role && <span className="badge neutral">role: {row.config.role}</span>}
                </div>
                {row.config && (
                  <code className="mcp-server-row__transport" title="stdio transport command">
                    {[row.config.command, ...row.config.args].join(" ")}
                  </code>
                )}
                {row.config && (
                  <div className="mcp-server-row__meta">
                    {row.config.envKeys.length > 0 && <span>env: {row.config.envKeys.join(", ")}</span>}
                    {row.config.allowedPaths.length > 0 && <span>paths: {row.config.allowedPaths.join(", ")}</span>}
                    {row.config.allowedHosts.length > 0 && <span>hosts: {row.config.allowedHosts.join(", ")}</span>}
                    {row.config.source && (
                      <span>
                        source: {row.config.source.scope} <code>{row.config.source.path}</code>
                        {row.config.source.writable ? "" : " (read-only)"}
                      </span>
                    )}
                  </div>
                )}
                <div className="mcp-server-row__actions">
                  {row.config ? (
                    <>
                      <button
                        type="button"
                        className="mcp-action"
                        onClick={() => {
                          setEditTarget(row.config);
                          setEditorOpen(true);
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="mcp-action mcp-action--danger" onClick={() => setRemoveTarget(row.config)}>
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="mcp-server-row__note">runtime-only — not in an editable config file</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {servers.isSuccess && (security.length > 0 || sandboxBindings.length > 0) && (
          <p className="mcp-posture-note">
            Runtime posture: {security.length} security entr{security.length === 1 ? "y" : "ies"} ·{" "}
            {sandboxBindings.length} sandbox binding{sandboxBindings.length === 1 ? "" : "s"} (read-only; see the
            Sandbox category in Settings for isolation config).
          </p>
        )}
      </section>

      {/* ── Tools browser ── */}
      <section className="mcp-tools" aria-label="MCP tools">
        <div className="section-toolbar">
          <span className="section-toolbar__summary">
            <Wrench size={14} aria-hidden="true" /> Tools
            {tools.isSuccess ? ` · ${toolRows.length}` : ""}
          </span>
        </div>

        <label className="mcp-tools__search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
            placeholder="Search tools by name, server, or description…"
            aria-label="Search MCP tools"
          />
        </label>

        {tools.isPending && <SkeletonBlock variant="text" lines={4} />}

        {toolsUnavailable && (
          <UnavailableState capability="mcp.tools.list" description="the namespaced tool inventory is not served." />
        )}

        {tools.isError && !toolsUnavailable && (
          <ErrorState error={tools.error} onRetry={() => void tools.refetch()} title="Failed to load MCP tools" />
        )}

        {tools.isSuccess && filteredTools.length === 0 && (
          <EmptyState
            title={toolSearch.trim() ? "No tools match" : "No MCP tools"}
            description={
              toolSearch.trim()
                ? `Nothing matches "${toolSearch.trim()}".`
                : "Connected servers expose their tools here under mcp:<server>:<tool>."
            }
          />
        )}

        {tools.isSuccess && filteredTools.length > 0 && (
          <ul className="mcp-tool-rows">
            {filteredTools.map((tool) => (
              <li key={tool.qualifiedName} className="mcp-tool-row">
                <code className="mcp-tool-row__name">{tool.qualifiedName}</code>
                <span className="mcp-tool-row__server">{tool.serverName}</span>
                {tool.description && <p className="mcp-tool-row__description">{tool.description}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Config locations ── */}
      <section className="mcp-config" aria-label="MCP config files">
        <div className="section-toolbar">
          <span className="section-toolbar__summary">Config files</span>
        </div>

        {config.isPending && <SkeletonBlock variant="text" lines={2} />}

        {configRefused && (
          <div className="settings-refused" role="status">
            <strong>Admin access required</strong>
            <span>Reading merged MCP config needs an admin-scoped principal.</span>
          </div>
        )}

        {configUnavailable && (
          <UnavailableState capability="mcp.config.get" description="config file locations cannot be shown." />
        )}

        {config.isError && !configRefused && !configUnavailable && (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} title="Failed to load MCP config" />
        )}

        {config.isSuccess && locations.length === 0 && (
          <EmptyState title="No config locations" description="The daemon reported no MCP config files." />
        )}

        {config.isSuccess && locations.length > 0 && (
          <ul className="mcp-locations">
            {locations.map((location, i) => (
              // Index-qualified: the daemon can report the same location twice
              // (observed live: external:~/.mcp/mcp.json duplicated).
              <li key={`${location.scope}:${location.path}:${i}`} className="mcp-location">
                <span className="badge neutral">{location.scope}</span>
                <code>{location.path}</code>
                <span className="mcp-location__kind">{location.kind}</span>
                {!location.writable && <span className="badge warning">read-only</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Overlays ── */}
      <ConfirmSurface
        open={reloadConfirmOpen}
        action="Reload MCP config"
        target="All configured MCP servers"
        blastRadius="Re-reads every MCP config file and restarts changed servers — in-flight tool calls on restarted servers fail and agents reconnect."
        confirmLabel={reload.isPending ? "Reloading…" : "Reload"}
        onCancel={() => setReloadConfirmOpen(false)}
        onConfirm={() => reload.mutate()}
      />

      <ServerEditorModal
        open={editorOpen}
        existing={editTarget}
        saving={upsert.isPending}
        onClose={() => {
          setEditorOpen(false);
          setEditTarget(null);
        }}
        onSubmit={(payload) => upsert.mutate(payload)}
      />

      <ConfirmSurface
        open={removeTarget !== null}
        action="Remove MCP server"
        target={removeTarget ? `${removeTarget.name} (${removeTarget.source?.scope ?? "unknown scope"} config)` : ""}
        blastRadius="Deletes the registration from its config file and reloads — every agent loses this server's tools immediately. The server's own files are untouched."
        danger
        requireTypedText={removeTarget?.name}
        confirmLabel={remove.isPending ? "Removing…" : "Remove server"}
        onCancel={() => setRemoveTarget(null)}
        onConfirm={() => {
          if (removeTarget) remove.mutate(removeTarget);
        }}
      />
    </div>
  );
}
