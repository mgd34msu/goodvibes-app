// GENERATED FILE — pinned snapshot of CONFIG_SCHEMA from
// @pellux/goodvibes-sdk@1.11.2 (platform/config, Bun-only subpath the
// webview must not import — docs/ARCHITECTURE.md §5). Pure data: key, type,
// default, description, enum values, validation hint. The runtime `validate`
// functions cannot cross the boundary and are intentionally dropped; the
// daemon re-validates every config.set anyway, so client-side hints are
// advisory only. Regenerate with a one-off Bun snippet that dynamically
// imports the SDK's platform config subpath (the same one named in the first
// line of this header) and re-serializes CONFIG_SCHEMA — see
// scripts/generate-operator-routes.ts for the sibling pattern.

export interface ConfigSettingMeta {
  readonly key: string;
  readonly type: "boolean" | "number" | "string" | "enum" | "object";
  readonly default: unknown;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly validationHint?: string;
}

export const CONFIG_SCHEMA_SNAPSHOT: readonly ConfigSettingMeta[] =
[
  {
    "key": "display.stream",
    "type": "boolean",
    "default": true,
    "description": "Stream LLM tokens as they arrive"
  },
  {
    "key": "display.lineNumbers",
    "type": "enum",
    "default": "off",
    "description": "Show line numbers for all assistant output, code blocks only, or not at all",
    "enumValues": [
      "all",
      "code",
      "off"
    ]
  },
  {
    "key": "display.collapseThreshold",
    "type": "number",
    "default": 30,
    "description": "Line count threshold for collapsing tool output",
    "validationHint": "number in [1, 1000]"
  },
  {
    "key": "display.theme",
    "type": "string",
    "default": "vaporwave",
    "description": "Color theme name"
  },
  {
    "key": "display.showThinking",
    "type": "boolean",
    "default": false,
    "description": "Show reasoning/thinking content in a dimmed block above assistant responses"
  },
  {
    "key": "display.showReasoningSummary",
    "type": "boolean",
    "default": false,
    "description": "Show reasoning summary (Mercury-2) in a dimmed block above assistant responses"
  },
  {
    "key": "display.showTokenSpeed",
    "type": "boolean",
    "default": false,
    "description": "Show streaming tokens/sec counter during generation"
  },
  {
    "key": "display.showToolPreview",
    "type": "boolean",
    "default": false,
    "description": "Show partial tool call preview while streaming"
  },
  {
    "key": "provider.reasoningEffort",
    "type": "enum",
    "default": "medium",
    "description": "Reasoning effort level for models that support it",
    "enumValues": [
      "instant",
      "low",
      "medium",
      "high"
    ]
  },
  {
    "key": "provider.model",
    "type": "string",
    "default": "openrouter:openrouter/free",
    "description": "Default provider-qualified LLM model registry key"
  },
  {
    "key": "provider.embeddingProvider",
    "type": "string",
    "default": "hashed-local",
    "description": "Default memory embedding provider"
  },
  {
    "key": "provider.systemPromptFile",
    "type": "string",
    "default": "",
    "description": "Path to a file containing the system prompt (empty = none)"
  },
  {
    "key": "provider.optimizerMode",
    "type": "enum",
    "default": "off",
    "description": "Provider routing optimizer: off (optimizer inactive, default), manual (optimizer active but never auto-routes), auto (selects the best capable provider per request via capability contracts), or pinned (force one model — see provider.optimizerPinnedModel). Runtime /provider commands and pin/unpin still override for the session.",
    "enumValues": [
      "off",
      "manual",
      "auto",
      "pinned"
    ]
  },
  {
    "key": "provider.optimizerPinnedModel",
    "type": "string",
    "default": "",
    "description": "Provider-qualified model id (e.g. anthropic:claude-sonnet-4) pinned by the provider optimizer at startup when provider.optimizerMode is \"pinned\". Empty leaves the optimizer unpinned (falls back to manual)."
  },
  {
    "key": "behavior.autoApprove",
    "type": "boolean",
    "default": false,
    "description": "Auto-approve all tool permission requests (--no-worries-just-vibes)"
  },
  {
    "key": "behavior.autoCompactThreshold",
    "type": "number",
    "default": 80,
    "description": "Compact conversation when context usage exceeds this percentage",
    "validationHint": "number in [10, 100]"
  },
  {
    "key": "behavior.compactionStrategy",
    "type": "enum",
    "default": "structured",
    "description": "Session compaction: off (sessions run uncompacted), structured (in-place summarization with semantic chunking and relevance scoring, default), or distiller (fresh model call producing a continuation brief; falls back to structured below the quality floor and the receipt names any fallback). behavior.autoCompactThreshold sets when compaction triggers.",
    "enumValues": [
      "off",
      "structured",
      "distiller"
    ]
  },
  {
    "key": "behavior.staleContextWarnings",
    "type": "boolean",
    "default": true,
    "description": "Emit proactive context-pressure warnings before compaction is required"
  },
  {
    "key": "behavior.saveHistory",
    "type": "boolean",
    "default": true,
    "description": "Persist conversation history to disk"
  },
  {
    "key": "behavior.notifyOnComplete",
    "type": "boolean",
    "default": true,
    "description": "Emit terminal bell and desktop notification when a long turn completes"
  },
  {
    "key": "behavior.returnContextMode",
    "type": "enum",
    "default": "off",
    "description": "Resume summary mode: off, local deterministic summary, or helper-assisted summary",
    "enumValues": [
      "off",
      "local",
      "assisted"
    ]
  },
  {
    "key": "behavior.guidanceMode",
    "type": "enum",
    "default": "minimal",
    "description": "Operational guidance mode: off, minimal, or guided",
    "enumValues": [
      "off",
      "minimal",
      "guided"
    ]
  },
  {
    "key": "storage.secretPolicy",
    "type": "enum",
    "default": "preferred_secure",
    "description": "Secret persistence policy: plaintext allowed, preferred secure, or require secure",
    "enumValues": [
      "plaintext_allowed",
      "preferred_secure",
      "require_secure"
    ]
  },
  {
    "key": "storage.artifacts.maxBytes",
    "type": "number",
    "default": 536870912,
    "description": "Maximum stored artifact size for file, URL, multipart, and raw upload ingest in bytes",
    "validationHint": "integer in [1048576, 10737418240]"
  },
  {
    "key": "permissions.mode",
    "type": "enum",
    "default": "prompt",
    "description": "Session permission mode. prompt (default/\"normal\"): auto-approve reads, ask for the rest. plan: read-only tools allowed, every mutating/exec tool is refused with a structured plan-mode denial. accept-edits: file write/edit tools auto-approve, exec and other risky classes still ask. allow-all (\"auto\"): every tool auto-approved. custom: per-tool config actions apply.",
    "enumValues": [
      "prompt",
      "allow-all",
      "custom",
      "plan",
      "accept-edits"
    ]
  },
  {
    "key": "permissions.backgroundAgents",
    "type": "enum",
    "default": "inherit",
    "description": "How background/subagent tool calls consult the permission layer. inherit (default): background tool execution runs through the same session permission mode as the foreground turn loop (allow-all changes nothing; prompt/plan/accept-edits/custom apply their matrices; asks broker through the same blocked-on-user machinery with subagent attribution). allow-all: background agents are exempt — their tool calls auto-approve regardless of the session mode.",
    "enumValues": [
      "inherit",
      "allow-all"
    ]
  },
  {
    "key": "permissions.divergenceThreshold",
    "type": "number",
    "default": 0.05,
    "description": "Maximum permission-evaluator divergence rate (0.0–1.0) the permission-divergence-dashboard enforce gate tolerates before blocking a transition from simulation to enforce mode. Default 0.05 = 5%. A per-simulator divergenceThreshold override still wins.",
    "validationHint": "number in [0, 1]"
  },
  {
    "key": "permissions.maxDivergenceRecords",
    "type": "number",
    "default": 500,
    "description": "Maximum divergence records the permissions simulator retains for the divergence dashboard/trend history. A per-simulator maxDivergenceRecords override still wins.",
    "validationHint": "integer in [1, 1000000]"
  },
  {
    "key": "diagnostics.postEdit",
    "type": "enum",
    "default": "on",
    "description": "Post-edit diagnostics: after a successful file write/edit, append cheap, in-process syntax diagnostics (errors only) for the touched file to the tool result so the model sees a broken edit immediately. on (default): run the tree-sitter syntax provider when a TS/JS project context is detectable (no process spawn, no type checking). off: never append diagnostics.",
    "enumValues": [
      "on",
      "off"
    ]
  },
  {
    "key": "permissions.tools.read",
    "type": "enum",
    "default": "allow",
    "description": "Permission for file read operations (read, find, analyze)",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.write",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for file write operations",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.edit",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for file edit/patch operations",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.exec",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for shell command execution",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.find",
    "type": "enum",
    "default": "allow",
    "description": "Permission for file/directory search operations",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.fetch",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for outbound network fetch requests (custom mode only)",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.analyze",
    "type": "enum",
    "default": "allow",
    "description": "Permission for code/project analysis operations",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.inspect",
    "type": "enum",
    "default": "allow",
    "description": "Permission for inspecting runtime state and objects",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.agent",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for spawning subagents or delegating tasks",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.state",
    "type": "enum",
    "default": "allow",
    "description": "Permission for reading runtime/session state",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.workflow",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for executing multi-step workflow automation",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.registry",
    "type": "enum",
    "default": "allow",
    "description": "Permission for querying the tool/skill registry",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.mcp",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for MCP tool calls (external server tools)",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "permissions.tools.delegate",
    "type": "enum",
    "default": "prompt",
    "description": "Permission for unknown or unregistered tools (safe default: prompt)",
    "enumValues": [
      "allow",
      "prompt",
      "deny"
    ]
  },
  {
    "key": "orchestration.recursionEnabled",
    "type": "boolean",
    "default": false,
    "description": "Allow recursive agent orchestration under bounded policy controls"
  },
  {
    "key": "orchestration.maxDepth",
    "type": "number",
    "default": 0,
    "description": "Maximum recursive orchestration depth: 0=disabled, higher values allow deeper bounded recursion",
    "validationHint": "number in [0, 5]"
  },
  {
    "key": "planner.decomposition",
    "type": "enum",
    "default": "agent",
    "description": "How /workstream decomposes a goal into work items: 'agent' spawns a read-only planning agent (with automatic fallback to the heuristic path on any failure); 'heuristic' forces the deterministic single-item path and never spawns an agent",
    "enumValues": [
      "agent",
      "heuristic"
    ]
  },
  {
    "key": "planner.maxTurns",
    "type": "number",
    "default": 6,
    "description": "Maximum turns the planning-decomposition agent may take before it is stopped and the heuristic path is used",
    "validationHint": "number in [1, 20]"
  },
  {
    "key": "planner.tokenCeiling",
    "type": "number",
    "default": 120000,
    "description": "Total token budget for the planning-decomposition agent; exceeding it stops the agent and falls back to the heuristic path",
    "validationHint": "number in [1000, 2000000]"
  },
  {
    "key": "planner.wallTimeoutMs",
    "type": "number",
    "default": 120000,
    "description": "Wall-clock timeout (ms) for the planning-decomposition agent; exceeding it cancels the agent and falls back to the heuristic path",
    "validationHint": "number in [1000, 600000]"
  },
  {
    "key": "sandbox.enabled",
    "type": "boolean",
    "default": true,
    "description": "Master switch for the per-command exec sandbox (bubblewrap on Linux): the workspace is writable, the rest of the filesystem is read-only, /tmp is isolated, and network is disabled unless a command is on sandbox.egressAllowlist. Default ON where the host probe passes; honestly reported unavailable when bubblewrap is not present, leaving the exec path unchanged."
  },
  {
    "key": "sandbox.judgment",
    "type": "enum",
    "default": "annotate",
    "description": "Model-judgment pass on sandbox escalation asks: off (plain asks), annotate (default — a proposed verdict with stated reasons annotates the ask, the human still decides), or auto-approve (additionally auto-approves looks-safe verdicts; explicit opt-in). Never auto-denies and never touches the frozen catastrophic block; every judgment leaves a receipt.",
    "enumValues": [
      "off",
      "annotate",
      "auto-approve"
    ]
  },
  {
    "key": "sandbox.replIsolation",
    "type": "enum",
    "default": "shared-vm",
    "description": "Preferred isolation mode for evaluation runtimes once virtualization is enabled",
    "enumValues": [
      "shared-vm",
      "per-runtime-vm"
    ]
  },
  {
    "key": "sandbox.mcpIsolation",
    "type": "enum",
    "default": "disabled",
    "description": "Preferred isolation mode for MCP servers once virtualization is enabled",
    "enumValues": [
      "disabled",
      "shared-vm",
      "hybrid",
      "per-server-vm"
    ]
  },
  {
    "key": "sandbox.windowsMode",
    "type": "enum",
    "default": "native-basic",
    "description": "Windows host posture: native basic mode or require WSL before enabling virtualized sandboxing",
    "enumValues": [
      "native-basic",
      "require-wsl"
    ]
  },
  {
    "key": "sandbox.vmBackend",
    "type": "enum",
    "default": "local",
    "description": "Sandbox backend: local host execution by default, or QEMU for virtualized isolation",
    "enumValues": [
      "local",
      "qemu"
    ]
  },
  {
    "key": "sandbox.qemuBinary",
    "type": "string",
    "default": "qemu-system-x86_64",
    "description": "QEMU system binary to use when vmBackend=qemu"
  },
  {
    "key": "sandbox.qemuImagePath",
    "type": "string",
    "default": "",
    "description": "Disk image path for QEMU-backed sandbox sessions; when empty, QEMU sessions remain planned-only"
  },
  {
    "key": "sandbox.qemuExecWrapper",
    "type": "string",
    "default": "",
    "description": "Host-side wrapper/bridge used to execute guest commands inside a configured QEMU sandbox"
  },
  {
    "key": "sandbox.qemuGuestHost",
    "type": "string",
    "default": "",
    "description": "Optional guest host/IP used by the QEMU wrapper for real guest command transport"
  },
  {
    "key": "sandbox.qemuGuestPort",
    "type": "number",
    "default": 2222,
    "description": "Optional guest SSH port used by the QEMU wrapper for real guest command transport",
    "validationHint": "integer port in [1, 65535]"
  },
  {
    "key": "sandbox.qemuGuestUser",
    "type": "string",
    "default": "goodvibes",
    "description": "Optional guest username used by the QEMU wrapper for real guest command transport"
  },
  {
    "key": "sandbox.qemuWorkspacePath",
    "type": "string",
    "default": "/workspace",
    "description": "Guest workspace path used by the QEMU wrapper when executing commands inside the guest"
  },
  {
    "key": "sandbox.qemuSessionMode",
    "type": "enum",
    "default": "attach",
    "description": "Whether the QEMU wrapper attaches to an already running guest or launches a guest per command",
    "enumValues": [
      "attach",
      "launch-per-command"
    ]
  },
  {
    "key": "sandbox.replJavaScriptCommand",
    "type": "string",
    "default": "bun",
    "description": "Guest command used for JavaScript-family REPL runtimes inside QEMU, including JavaScript, TypeScript, SQL, and GraphQL"
  },
  {
    "key": "ui.voiceEnabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the optional local-first voice control surface"
  },
  {
    "key": "ui.systemMessages",
    "type": "enum",
    "default": "panel",
    "description": "Where operational system messages render by default: panel, conversation, or both",
    "enumValues": [
      "panel",
      "conversation",
      "both"
    ]
  },
  {
    "key": "tts.provider",
    "type": "string",
    "default": "elevenlabs",
    "description": "Default TTS provider used by spoken-output clients when no provider is supplied on the request"
  },
  {
    "key": "tts.voice",
    "type": "string",
    "default": "",
    "description": "Default TTS voice id used by spoken-output clients when no voice is supplied on the request"
  },
  {
    "key": "tts.llmProvider",
    "type": "string",
    "default": "",
    "description": "Optional LLM provider override for spoken-output turns; empty means use the active chat provider"
  },
  {
    "key": "tts.llmModel",
    "type": "string",
    "default": "",
    "description": "Optional LLM model override for spoken-output turns; empty means use the active chat model"
  },
  {
    "key": "tts.speed",
    "type": "number",
    "default": 1,
    "description": "Playback speed multiplier for TTS synthesis (0.25–4.0); 1.0 is normal speed",
    "validationHint": "number in [0.25, 4]"
  },
  {
    "key": "ui.operationalMessages",
    "type": "enum",
    "default": "panel",
    "description": "Where tool, agent, MCP, plugin, and other operational activity messages render by default: panel, conversation, or both",
    "enumValues": [
      "panel",
      "conversation",
      "both"
    ]
  },
  {
    "key": "ui.wrfcMessages",
    "type": "enum",
    "default": "both",
    "description": "Where WRFC lifecycle updates render by default: panel, conversation, or both",
    "enumValues": [
      "panel",
      "conversation",
      "both"
    ]
  },
  {
    "key": "release.channel",
    "type": "enum",
    "default": "stable",
    "description": "Preferred release channel for install/update flows",
    "enumValues": [
      "stable",
      "preview"
    ]
  },
  {
    "key": "automation.enabled",
    "type": "boolean",
    "default": true,
    "description": "Enable the automation subsystem (durable routines, schedule evaluation, run history). Default on: with no routines defined it idles and surfaces a how-to-create-your-first-routine empty state."
  },
  {
    "key": "automation.maxConcurrentRuns",
    "type": "number",
    "default": 4,
    "description": "Maximum automation runs that may execute concurrently",
    "validationHint": "integer in [1, 64]"
  },
  {
    "key": "automation.runHistoryLimit",
    "type": "number",
    "default": 100,
    "description": "Maximum run history entries retained per automation job",
    "validationHint": "integer in [1, 5000]"
  },
  {
    "key": "automation.defaultTimeoutMs",
    "type": "number",
    "default": 900000,
    "description": "Default execution timeout for automation runs in milliseconds",
    "validationHint": "integer in [1000, 86400000]"
  },
  {
    "key": "automation.catchUpWindowMinutes",
    "type": "number",
    "default": 30,
    "description": "How long after startup the engine should catch up missed runs",
    "validationHint": "integer in [0, 1440]"
  },
  {
    "key": "automation.failureCooldownMs",
    "type": "number",
    "default": 300000,
    "description": "Cooldown applied after a failed automation run before retrying",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "automation.deleteAfterRun",
    "type": "boolean",
    "default": false,
    "description": "Delete one-shot automation jobs after their first successful run"
  },
  {
    "key": "checkin.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the proactive check-in: on a cadence, a briefing is judged and the user is contacted only when something warrants it"
  },
  {
    "key": "checkin.cadence",
    "type": "string",
    "default": "0 */4 * * *",
    "description": "Proactive check-in cadence as a cron expression (default: every 4 hours)"
  },
  {
    "key": "checkin.deliveryChannel",
    "type": "string",
    "default": "",
    "description": "Where a proactive check-in message is delivered: \"surfaceKind\" or \"surfaceKind:address\" (e.g. \"slack:C123\")"
  },
  {
    "key": "checkin.quietHours",
    "type": "string",
    "default": "",
    "description": "Proactive check-in quiet hours as \"HH:MM-HH:MM\" local time (empty disables); no message is sent during this window"
  },
  {
    "key": "controlPlane.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the standalone control-plane HTTP server"
  },
  {
    "key": "controlPlane.gateway",
    "type": "boolean",
    "default": true,
    "description": "The shared gateway/control-plane host serving state snapshots, live streams (SSE/WS), and authenticated control APIs to terminal hosts and remote clients. Default on so a stock daemon can stream companion chat; every streaming endpoint stays auth-gated and the default bind stays loopback. Turn off for a request/response-only daemon."
  },
  {
    "key": "controlPlane.hostMode",
    "type": "enum",
    "default": "local",
    "description": "Network binding mode: local (127.0.0.1, default port), network (0.0.0.0, default port), custom (editable host and port)",
    "enumValues": [
      "local",
      "network",
      "custom"
    ]
  },
  {
    "key": "controlPlane.host",
    "type": "string",
    "default": "127.0.0.1",
    "description": "Bind host for the control-plane HTTP server"
  },
  {
    "key": "controlPlane.port",
    "type": "number",
    "default": 3421,
    "description": "Bind port for the control-plane HTTP server",
    "validationHint": "integer port in [1, 65535]"
  },
  {
    "key": "controlPlane.baseUrl",
    "type": "string",
    "default": "http://127.0.0.1:3421",
    "description": "Public base URL used by route bindings and link generation"
  },
  {
    "key": "controlPlane.streamMode",
    "type": "enum",
    "default": "sse",
    "description": "Live update stream mode for control-plane clients",
    "enumValues": [
      "sse",
      "websocket",
      "both"
    ]
  },
  {
    "key": "controlPlane.allowRemote",
    "type": "boolean",
    "default": false,
    "description": "Allow remote clients to connect to the control plane"
  },
  {
    "key": "controlPlane.trustProxy",
    "type": "boolean",
    "default": false,
    "description": "Trust proxy forwarding headers such as x-forwarded-for for the control plane"
  },
  {
    "key": "controlPlane.openaiCompatible.enabled",
    "type": "boolean",
    "default": true,
    "description": "Expose OpenAI-compatible /v1/models and /v1/chat/completions routes on the authenticated daemon"
  },
  {
    "key": "controlPlane.openaiCompatible.pathPrefix",
    "type": "string",
    "default": "/v1",
    "description": "Path prefix for the daemon OpenAI-compatible routes"
  },
  {
    "key": "controlPlane.webui.serve",
    "type": "boolean",
    "default": false,
    "description": "Serve a built web UI bundle same-origin from the daemon (opt-in; loopback default unchanged). The bundle is public and the app token-authenticates its own API calls."
  },
  {
    "key": "controlPlane.webui.bundleDir",
    "type": "string",
    "default": "",
    "description": "Directory holding the built web UI bundle (index.html + assets) served when controlPlane.webui.serve is true. Empty disables serving."
  },
  {
    "key": "controlPlane.cors.enabled",
    "type": "boolean",
    "default": false,
    "description": "Answer OPTIONS preflight and emit Access-Control-Allow-* headers for allowlisted origins (opt-in; off by default). Never wildcards; credentials are allowlist-gated."
  },
  {
    "key": "controlPlane.cors.allowedOrigins",
    "type": "string",
    "default": "",
    "description": "Comma-separated explicit allowlist of browser origins permitted to make cross-origin requests when controlPlane.cors.enabled is true (e.g. http://localhost:5173). Empty refuses every cross-origin request."
  },
  {
    "key": "controlPlane.tls.mode",
    "type": "enum",
    "default": "off",
    "description": "TLS mode for the control-plane HTTP server",
    "enumValues": [
      "off",
      "proxy",
      "direct"
    ]
  },
  {
    "key": "controlPlane.tls.certFile",
    "type": "string",
    "default": "",
    "description": "Certificate chain PEM path for direct control-plane TLS (empty = ~/.goodvibes/certs/fullchain.pem)"
  },
  {
    "key": "controlPlane.tls.keyFile",
    "type": "string",
    "default": "",
    "description": "Private key PEM path for direct control-plane TLS (empty = ~/.goodvibes/certs/privkey.pem)"
  },
  {
    "key": "httpListener.hostMode",
    "type": "enum",
    "default": "local",
    "description": "Network binding mode: local (127.0.0.1, default port), network (0.0.0.0, default port), custom (editable host and port)",
    "enumValues": [
      "local",
      "network",
      "custom"
    ]
  },
  {
    "key": "httpListener.host",
    "type": "string",
    "default": "127.0.0.1",
    "description": "Bind host for the webhook HTTP listener"
  },
  {
    "key": "httpListener.port",
    "type": "number",
    "default": 3422,
    "description": "Bind port for the webhook HTTP listener",
    "validationHint": "integer port in [1, 65535]"
  },
  {
    "key": "httpListener.trustProxy",
    "type": "boolean",
    "default": false,
    "description": "Trust proxy forwarding headers such as x-forwarded-for for the webhook listener"
  },
  {
    "key": "httpListener.tls.mode",
    "type": "enum",
    "default": "off",
    "description": "TLS mode for the webhook HTTP listener",
    "enumValues": [
      "off",
      "proxy",
      "direct"
    ]
  },
  {
    "key": "httpListener.tls.certFile",
    "type": "string",
    "default": "",
    "description": "Certificate chain PEM path for direct webhook-listener TLS (empty = ~/.goodvibes/certs/fullchain.pem)"
  },
  {
    "key": "httpListener.tls.keyFile",
    "type": "string",
    "default": "",
    "description": "Private key PEM path for direct webhook-listener TLS (empty = ~/.goodvibes/certs/privkey.pem)"
  },
  {
    "key": "web.enabled",
    "type": "boolean",
    "default": true,
    "description": "Enable the browser-based operator surface. Default on, bound to loopback (web.hostMode local): served on this machine only until deliberately widened via web.hostMode. The URL is announced once at daemon start."
  },
  {
    "key": "web.hostMode",
    "type": "enum",
    "default": "local",
    "description": "Network binding mode: local (127.0.0.1, default port), network (0.0.0.0, default port), custom (editable host and port)",
    "enumValues": [
      "local",
      "network",
      "custom"
    ]
  },
  {
    "key": "web.host",
    "type": "string",
    "default": "127.0.0.1",
    "description": "Bind host for the web surface"
  },
  {
    "key": "web.port",
    "type": "number",
    "default": 3423,
    "description": "Bind port for the web surface",
    "validationHint": "integer port in [1, 65535]"
  },
  {
    "key": "web.publicBaseUrl",
    "type": "string",
    "default": "http://127.0.0.1:3423",
    "description": "Public base URL for web links and ntfy/notification deep links"
  },
  {
    "key": "web.staticAssetsDir",
    "type": "string",
    "default": "dist/web",
    "description": "Static asset directory for the embedded web surface"
  },
  {
    "key": "atRest.redactionEnabled",
    "type": "boolean",
    "default": true,
    "description": "When true (default), secret/credential patterns (API keys, bearer tokens, GitHub/GitLab/Slack/AWS credentials, home paths) are redacted at WRITE time from the on-disk transcript journal (per-agent <agentId>.jsonl) and the local execution ledger (spans + ledger jsonl), reusing the same pattern set as the telemetry egress. A redacted value shows a [REDACTED_*] marker — a record never pretends the content was absent. Set false ONLY for local debugging where plaintext secrets on disk are acceptable."
  },
  {
    "key": "atRest.retentionMaxAgeDays",
    "type": "number",
    "default": 30,
    "description": "Age cap (days) for the on-disk transcript journal and execution-ledger files. Files older than this are pruned at the retention enforcement point (the journal prunes on each new agent session; the ledger prunes on each export). Generous by default; bounded so the files cannot grow without limit.",
    "validationHint": "integer in [1, 365]"
  },
  {
    "key": "atRest.retentionMaxTotalMb",
    "type": "number",
    "default": 512,
    "description": "Total-size cap (MB) across the on-disk transcript journal / execution-ledger file set. When exceeded, the retention enforcement point deletes oldest-first (rotated backups before freshly-written active files) until under budget.",
    "validationHint": "integer in [1, 1048576]"
  },
  {
    "key": "learning.consolidation.enabled",
    "type": "boolean",
    "default": true,
    "description": "Master switch for the idle-time memory consolidation pass (dedupe merges, confidence decay of never-referenced records, and review proposals). On by default — the daemon runs it at idle and on a slow schedule; every outcome is reversible or proposal-gated, and false turns the pass off."
  },
  {
    "key": "learning.consolidation.intervalMs",
    "type": "number",
    "default": 21600000,
    "description": "Minimum time between consolidation runs, in milliseconds. Doubles as the schedule cadence (default: 6 hours).",
    "validationHint": "integer in [1, 2592000000]"
  },
  {
    "key": "learning.consolidation.minIdleMs",
    "type": "number",
    "default": 0,
    "description": "Minimum continuous idle time required before a consolidation run may start, in milliseconds (default: 0 = no idle requirement).",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "learning.consolidation.maxMergesPerRun",
    "type": "number",
    "default": 10,
    "description": "Maximum duplicate groups merged in a single consolidation run.",
    "validationHint": "integer in [1, 10000]"
  },
  {
    "key": "learning.consolidation.maxDecaysPerRun",
    "type": "number",
    "default": 20,
    "description": "Maximum records decayed or archived in a single consolidation run.",
    "validationHint": "integer in [1, 10000]"
  },
  {
    "key": "learning.consolidation.maxProposalsPerRun",
    "type": "number",
    "default": 20,
    "description": "Maximum review proposals emitted in a single consolidation run.",
    "validationHint": "integer in [1, 10000]"
  },
  {
    "key": "learning.consolidation.decayAgeDays",
    "type": "number",
    "default": 45,
    "description": "Active records older than this (by updatedAt) become decay candidates, in days.",
    "validationHint": "integer in [1, 3650]"
  },
  {
    "key": "learning.consolidation.decayConfidenceStep",
    "type": "number",
    "default": 10,
    "description": "Confidence points removed from a never-referenced decaying record per run.",
    "validationHint": "integer in [1, 100]"
  },
  {
    "key": "learning.consolidation.archiveConfidenceFloor",
    "type": "number",
    "default": 40,
    "description": "A decaying record whose confidence would fall to or below this is archived (marked stale).",
    "validationHint": "integer in [0, 100]"
  },
  {
    "key": "power.keepAwake",
    "type": "boolean",
    "default": false,
    "description": "The owner keep-awake toggle: the daemon holds a sleep inhibitor INDEPENDENT of work state, so the host stays reachable after work finishes and after surfaces close. Covers idle + sleep + lid-switch inhibitor classes where the OS grants them; the served state names any refused class honestly. Every attached surface shows an always-visible \"sleep disabled\" chip while this is on — the chip, not a timer, is the safety mechanism."
  },
  {
    "key": "power.inhibitWhileWorking",
    "type": "boolean",
    "default": true,
    "description": "Hold an idle/sleep inhibitor automatically while real work runs (a running turn, an active agent, a schedule about to fire), released when work drains. On by default so the host cannot sleep mid-work."
  },
  {
    "key": "power.workInhibitMaxMinutes",
    "type": "number",
    "default": 180,
    "description": "Hard cap in minutes on the automatic WORK inhibitor (never the keep-awake toggle): a wedged hold releases at the cap and the state reports the expiry honestly.",
    "validationHint": "integer in [1, 1440]"
  },
  {
    "key": "memory.budgetMb",
    "type": "number",
    "default": 0,
    "description": "MemoryGovernor budget in MB. The governor sheds caches and pauses background jobs as RSS approaches this budget. 0 means auto: min(25% of system RAM, 4096 MB), resolved at daemon start.",
    "validationHint": "integer in [0, 1048576]"
  },
  {
    "key": "memory.tier.elevatedPct",
    "type": "number",
    "default": 60,
    "description": "Elevated tier threshold, as a percent of the budget: at/above this the governor trims registered caches to their floor and runs a gc.",
    "validationHint": "integer in [1, 100]"
  },
  {
    "key": "memory.tier.highPct",
    "type": "number",
    "default": 80,
    "description": "High tier threshold, as a percent of the budget: at/above this the governor flushes all registered caches and pauses deferrable background jobs.",
    "validationHint": "integer in [1, 100]"
  },
  {
    "key": "memory.tier.criticalPct",
    "type": "number",
    "default": 95,
    "description": "Critical tier threshold, as a percent of the budget: at/above this the governor refuses new expensive work with an honest structured outcome and emits an ops attention event.",
    "validationHint": "integer in [1, 100]"
  },
  {
    "key": "memory.tripwire.rateMbPerSec",
    "type": "number",
    "default": 25,
    "description": "Leak tripwire rate in MB/s: if RSS keeps growing faster than this AFTER a full cache flush, the flush did not help and a leak is suspected.",
    "validationHint": "number in [1, 100000]"
  },
  {
    "key": "memory.tripwire.sustainSec",
    "type": "number",
    "default": 60,
    "description": "Leak tripwire sustain window in seconds: the post-flush growth rate must exceed memory.tripwire.rateMbPerSec continuously for this long before the governor writes a receipt and exits for a clean supervisor restart.",
    "validationHint": "integer in [1, 86400]"
  },
  {
    "key": "memory.hardLimitPct",
    "type": "number",
    "default": 90,
    "description": "Absolute-memory backstop as a percent of the EFFECTIVE KILL CEILING — the daemon's own cgroup memory limit where one applies, else physical RAM. If RSS holds at/above this percent of that ceiling for memory.tripwire.sustainSec, the governor writes a hard-limit receipt and exits so a supervisor restarts clean — catching a leak too slow for memory.tripwire.rateMbPerSec just before the kernel/cgroup OOM killer would strike. Default 90: fire at 90% of the real kill line, leaving a safety margin for the exit itself. Deliberately anchored to the kill ceiling and NOT to memory.budgetMb: the budget caps small by design (25% of RAM, max 4096 MB), and a large-but-stable working set above the budget on a big-RAM host is handled by the critical tier (refuse new expensive work, stay alive) — anchoring the exit to the budget would put such a healthy daemon in a permanent restart loop.",
    "validationHint": "integer in [1, 100]"
  },
  {
    "key": "voice.local.sttEngine",
    "type": "enum",
    "default": "",
    "description": "Local speech-to-text engine: whisper-cpp (blessed default — CPU-first, realtime-capable) or faster-whisper (NVIDIA-GPU alternative via a wrapper script). Empty = not configured (honest unconfigured status; nothing auto-downloads).",
    "enumValues": [
      "",
      "whisper-cpp",
      "faster-whisper"
    ]
  },
  {
    "key": "voice.local.sttBinary",
    "type": "string",
    "default": "",
    "description": "Absolute path to the local STT engine binary (e.g. whisper.cpp's whisper-cli)."
  },
  {
    "key": "voice.local.sttModelPath",
    "type": "string",
    "default": "",
    "description": "Absolute path to the local STT model file (e.g. ggml-tiny.en.bin). The user downloads this explicitly — nothing auto-downloads."
  },
  {
    "key": "voice.local.ttsEngine",
    "type": "enum",
    "default": "",
    "description": "Local text-to-speech engine: piper (blessed default — sub-50ms first-audio class, MIT) or kokoro (quality alternative, Apache 2.0, via a wrapper script). Empty = not configured.",
    "enumValues": [
      "",
      "piper",
      "kokoro"
    ]
  },
  {
    "key": "voice.local.ttsBinary",
    "type": "string",
    "default": "",
    "description": "Absolute path to the local TTS engine binary (e.g. piper)."
  },
  {
    "key": "voice.local.ttsModelPath",
    "type": "string",
    "default": "",
    "description": "Absolute path to the local TTS voice model (e.g. en_US-lessac-low.onnx with its .json beside it). The user downloads this explicitly — nothing auto-downloads."
  },
  {
    "key": "fleet.maxSize",
    "type": "number",
    "default": 8,
    "description": "Maximum fleet size — the one ceiling on agents this daemon is responsible for: native spawned agents, ACP-hosted agents, and elastic fix-task agents all count against it. Externally-launched agents merely observed on the host never count. Renamed from orchestration.maxActiveAgents.",
    "validationHint": "number in [1, 20]"
  },
  {
    "key": "surfaces.slack.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Slack surface adapter"
  },
  {
    "key": "surfaces.slack.signingSecret",
    "type": "string",
    "default": "",
    "description": "Slack signing secret used to verify inbound requests"
  },
  {
    "key": "surfaces.slack.botToken",
    "type": "string",
    "default": "",
    "description": "Slack bot token used for outbound replies and thread updates"
  },
  {
    "key": "surfaces.slack.appToken",
    "type": "string",
    "default": "",
    "description": "Slack app-level token used for advanced client flows"
  },
  {
    "key": "surfaces.slack.defaultChannel",
    "type": "string",
    "default": "",
    "description": "Default Slack channel for notifications and replies"
  },
  {
    "key": "surfaces.slack.workspaceId",
    "type": "string",
    "default": "",
    "description": "Slack workspace identifier for route binding"
  },
  {
    "key": "surfaces.discord.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Discord surface adapter"
  },
  {
    "key": "surfaces.discord.publicKey",
    "type": "string",
    "default": "",
    "description": "Discord application public key used to verify interactions"
  },
  {
    "key": "surfaces.discord.botToken",
    "type": "string",
    "default": "",
    "description": "Discord bot token used for outbound replies"
  },
  {
    "key": "surfaces.discord.applicationId",
    "type": "string",
    "default": "",
    "description": "Discord application ID used for interaction responses"
  },
  {
    "key": "surfaces.discord.defaultChannelId",
    "type": "string",
    "default": "",
    "description": "Default Discord channel for notifications and replies"
  },
  {
    "key": "surfaces.discord.guildId",
    "type": "string",
    "default": "",
    "description": "Discord guild identifier for route binding"
  },
  {
    "key": "surfaces.ntfy.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the ntfy notification surface"
  },
  {
    "key": "surfaces.ntfy.baseUrl",
    "type": "string",
    "default": "https://ntfy.sh",
    "description": "Base URL for ntfy delivery"
  },
  {
    "key": "surfaces.ntfy.topic",
    "type": "string",
    "default": "",
    "description": "Optional default ntfy topic for outbound notifications; does not override inbound route topics"
  },
  {
    "key": "surfaces.ntfy.chatTopic",
    "type": "string",
    "default": "goodvibes-chat",
    "description": "ntfy topic routed into the active terminal TUI session as normal chat"
  },
  {
    "key": "surfaces.ntfy.agentTopic",
    "type": "string",
    "default": "goodvibes-agent",
    "description": "ntfy topic routed to agent work in the active terminal TUI session"
  },
  {
    "key": "surfaces.ntfy.remoteTopic",
    "type": "string",
    "default": "goodvibes-ntfy",
    "description": "ntfy topic routed to a daemon-owned remote chat session"
  },
  {
    "key": "surfaces.ntfy.token",
    "type": "string",
    "default": "",
    "description": "ntfy access token used for authenticated delivery"
  },
  {
    "key": "surfaces.ntfy.defaultPriority",
    "type": "number",
    "default": 3,
    "description": "Default ntfy priority (1-5)",
    "validationHint": "integer in [1, 5]"
  },
  {
    "key": "surfaces.webhook.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the generic webhook surface"
  },
  {
    "key": "surfaces.webhook.defaultTarget",
    "type": "string",
    "default": "",
    "description": "Default outbound webhook target URL"
  },
  {
    "key": "surfaces.webhook.timeoutMs",
    "type": "number",
    "default": 10000,
    "description": "Outbound webhook timeout in milliseconds",
    "validationHint": "integer in [1000, 60000]"
  },
  {
    "key": "surfaces.webhook.secret",
    "type": "string",
    "default": "",
    "description": "Shared secret used to sign or verify webhook payloads"
  },
  {
    "key": "surfaces.homeassistant.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Home Assistant daemon surface"
  },
  {
    "key": "surfaces.homeassistant.instanceUrl",
    "type": "string",
    "default": "",
    "description": "Home Assistant base URL, for example http://homeassistant.local:8123"
  },
  {
    "key": "surfaces.homeassistant.accessToken",
    "type": "string",
    "default": "",
    "description": "Home Assistant long-lived access token or goodvibes secret URI"
  },
  {
    "key": "surfaces.homeassistant.webhookSecret",
    "type": "string",
    "default": "",
    "description": "Shared secret used to verify inbound Home Assistant callbacks"
  },
  {
    "key": "surfaces.homeassistant.defaultConversationId",
    "type": "string",
    "default": "goodvibes",
    "description": "Default Home Assistant conversation id used for route binding"
  },
  {
    "key": "surfaces.homeassistant.deviceId",
    "type": "string",
    "default": "goodvibes-daemon",
    "description": "Stable Home Assistant device identifier for this daemon"
  },
  {
    "key": "surfaces.homeassistant.deviceName",
    "type": "string",
    "default": "GoodVibes Daemon",
    "description": "Home Assistant device display name for this daemon"
  },
  {
    "key": "surfaces.homeassistant.eventType",
    "type": "string",
    "default": "goodvibes_message",
    "description": "Home Assistant event type used for daemon-to-Home Assistant deliveries"
  },
  {
    "key": "surfaces.homeassistant.remoteSessionTtlMs",
    "type": "number",
    "default": 1200000,
    "description": "Idle TTL for Home Assistant remote conversation sessions before the daemon closes them",
    "validationHint": "integer in [60000, 86400000]"
  },
  {
    "key": "surfaces.telegram.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Telegram surface contract"
  },
  {
    "key": "surfaces.telegram.botToken",
    "type": "string",
    "default": "",
    "description": "Telegram bot token used for bot setup and delivery"
  },
  {
    "key": "surfaces.telegram.webhookSecret",
    "type": "string",
    "default": "",
    "description": "Telegram webhook secret token used to verify inbound callbacks"
  },
  {
    "key": "surfaces.telegram.defaultChatId",
    "type": "string",
    "default": "",
    "description": "Default Telegram chat, group, or channel id for delivery"
  },
  {
    "key": "surfaces.telegram.botUsername",
    "type": "string",
    "default": "",
    "description": "Telegram bot username used for targeting and setup hints"
  },
  {
    "key": "surfaces.telegram.mode",
    "type": "enum",
    "default": "webhook",
    "description": "Telegram ingress mode: webhook or polling",
    "enumValues": [
      "webhook",
      "polling"
    ]
  },
  {
    "key": "surfaces.googleChat.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Google Chat surface contract"
  },
  {
    "key": "surfaces.googleChat.webhookUrl",
    "type": "string",
    "default": "",
    "description": "Google Chat outbound webhook or app callback URL"
  },
  {
    "key": "surfaces.googleChat.verificationToken",
    "type": "string",
    "default": "",
    "description": "Google Chat verification token or shared secret"
  },
  {
    "key": "surfaces.googleChat.appId",
    "type": "string",
    "default": "",
    "description": "Google Chat app identifier used for setup and diagnostics"
  },
  {
    "key": "surfaces.googleChat.spaceId",
    "type": "string",
    "default": "",
    "description": "Default Google Chat space identifier for routing"
  },
  {
    "key": "surfaces.signal.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Signal bridge surface contract"
  },
  {
    "key": "surfaces.signal.bridgeUrl",
    "type": "string",
    "default": "",
    "description": "Signal bridge base URL used for health checks and delivery"
  },
  {
    "key": "surfaces.signal.account",
    "type": "string",
    "default": "",
    "description": "Signal account or device identifier paired with the bridge"
  },
  {
    "key": "surfaces.signal.token",
    "type": "string",
    "default": "",
    "description": "Signal bridge access token"
  },
  {
    "key": "surfaces.signal.defaultRecipient",
    "type": "string",
    "default": "",
    "description": "Default Signal recipient or group identifier for routing"
  },
  {
    "key": "surfaces.whatsapp.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the WhatsApp surface contract"
  },
  {
    "key": "surfaces.whatsapp.provider",
    "type": "enum",
    "default": "meta-cloud",
    "description": "WhatsApp provider mode: Meta Cloud API or bridge",
    "enumValues": [
      "meta-cloud",
      "bridge"
    ]
  },
  {
    "key": "surfaces.whatsapp.accessToken",
    "type": "string",
    "default": "",
    "description": "WhatsApp provider access token"
  },
  {
    "key": "surfaces.whatsapp.verifyToken",
    "type": "string",
    "default": "",
    "description": "WhatsApp webhook verify token or shared secret"
  },
  {
    "key": "surfaces.whatsapp.signingSecret",
    "type": "string",
    "default": "",
    "description": "WhatsApp inbound signing secret or bridge bearer token"
  },
  {
    "key": "surfaces.whatsapp.phoneNumberId",
    "type": "string",
    "default": "",
    "description": "WhatsApp phone number id used for provider setup"
  },
  {
    "key": "surfaces.whatsapp.businessAccountId",
    "type": "string",
    "default": "",
    "description": "WhatsApp business account id used for provider setup"
  },
  {
    "key": "surfaces.whatsapp.defaultRecipient",
    "type": "string",
    "default": "",
    "description": "Default WhatsApp recipient or chat id for routing"
  },
  {
    "key": "surfaces.telephony.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the telephony SMS, voice, or bridge surface contract"
  },
  {
    "key": "surfaces.telephony.provider",
    "type": "enum",
    "default": "twilio",
    "description": "Telephony provider mode: direct Twilio API or bridge",
    "enumValues": [
      "twilio",
      "bridge"
    ]
  },
  {
    "key": "surfaces.telephony.mode",
    "type": "enum",
    "default": "sms",
    "description": "Telephony delivery mode: SMS, voice call, or bridge",
    "enumValues": [
      "sms",
      "voice",
      "bridge"
    ]
  },
  {
    "key": "surfaces.telephony.bridgeUrl",
    "type": "string",
    "default": "",
    "description": "Telephony bridge base URL used for health checks, inbound callbacks, and delivery"
  },
  {
    "key": "surfaces.telephony.token",
    "type": "string",
    "default": "",
    "description": "Telephony bridge bearer token"
  },
  {
    "key": "surfaces.telephony.accountSid",
    "type": "string",
    "default": "",
    "description": "Twilio account SID for provider-direct SMS or voice delivery"
  },
  {
    "key": "surfaces.telephony.authToken",
    "type": "string",
    "default": "",
    "description": "Twilio auth token or goodvibes secret URI for provider-direct delivery"
  },
  {
    "key": "surfaces.telephony.fromNumber",
    "type": "string",
    "default": "",
    "description": "Default telephony caller or sender phone number"
  },
  {
    "key": "surfaces.telephony.defaultRecipient",
    "type": "string",
    "default": "",
    "description": "Default telephony recipient phone number for routing"
  },
  {
    "key": "surfaces.telephony.webhookSecret",
    "type": "string",
    "default": "",
    "description": "Shared secret used to verify inbound telephony callbacks"
  },
  {
    "key": "surfaces.telephony.voiceLanguage",
    "type": "string",
    "default": "en-US",
    "description": "BCP-47 language code for provider-direct voice call text-to-speech"
  },
  {
    "key": "surfaces.imessage.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the iMessage bridge surface contract"
  },
  {
    "key": "surfaces.imessage.bridgeUrl",
    "type": "string",
    "default": "",
    "description": "iMessage bridge base URL used for health checks and delivery"
  },
  {
    "key": "surfaces.imessage.account",
    "type": "string",
    "default": "",
    "description": "iMessage account identifier used by the bridge"
  },
  {
    "key": "surfaces.imessage.token",
    "type": "string",
    "default": "",
    "description": "iMessage bridge access token"
  },
  {
    "key": "surfaces.imessage.defaultChatId",
    "type": "string",
    "default": "",
    "description": "Default iMessage chat id for routing"
  },
  {
    "key": "surfaces.msteams.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Microsoft Teams surface contract"
  },
  {
    "key": "surfaces.msteams.appId",
    "type": "string",
    "default": "",
    "description": "Microsoft Teams bot application (client) id"
  },
  {
    "key": "surfaces.msteams.appPassword",
    "type": "string",
    "default": "",
    "description": "Microsoft Teams bot application password (client secret)"
  },
  {
    "key": "surfaces.msteams.tenantId",
    "type": "string",
    "default": "",
    "description": "Microsoft Entra tenant id the Teams bot authenticates against"
  },
  {
    "key": "surfaces.msteams.serviceUrl",
    "type": "string",
    "default": "",
    "description": "Bot Framework service URL for proactive Teams delivery"
  },
  {
    "key": "surfaces.msteams.botId",
    "type": "string",
    "default": "",
    "description": "Microsoft Teams bot id used in conversation references"
  },
  {
    "key": "surfaces.msteams.defaultConversationId",
    "type": "string",
    "default": "",
    "description": "Default Teams conversation id for routing"
  },
  {
    "key": "surfaces.msteams.defaultChannelId",
    "type": "string",
    "default": "",
    "description": "Default Teams channel id for routing"
  },
  {
    "key": "surfaces.bluebubbles.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the BlueBubbles (iMessage server) surface contract"
  },
  {
    "key": "surfaces.bluebubbles.serverUrl",
    "type": "string",
    "default": "",
    "description": "BlueBubbles server base URL used for health checks and delivery"
  },
  {
    "key": "surfaces.bluebubbles.password",
    "type": "string",
    "default": "",
    "description": "BlueBubbles server password"
  },
  {
    "key": "surfaces.bluebubbles.account",
    "type": "string",
    "default": "",
    "description": "BlueBubbles account identifier"
  },
  {
    "key": "surfaces.bluebubbles.defaultChatGuid",
    "type": "string",
    "default": "",
    "description": "Default BlueBubbles chat GUID for routing"
  },
  {
    "key": "surfaces.mattermost.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Mattermost surface contract"
  },
  {
    "key": "surfaces.mattermost.baseUrl",
    "type": "string",
    "default": "",
    "description": "Mattermost server base URL"
  },
  {
    "key": "surfaces.mattermost.botToken",
    "type": "string",
    "default": "",
    "description": "Mattermost bot access token"
  },
  {
    "key": "surfaces.mattermost.teamId",
    "type": "string",
    "default": "",
    "description": "Mattermost team id the bot operates in"
  },
  {
    "key": "surfaces.mattermost.defaultChannelId",
    "type": "string",
    "default": "",
    "description": "Default Mattermost channel id for routing"
  },
  {
    "key": "surfaces.matrix.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Matrix surface contract"
  },
  {
    "key": "surfaces.matrix.homeserverUrl",
    "type": "string",
    "default": "",
    "description": "Matrix homeserver base URL"
  },
  {
    "key": "surfaces.matrix.accessToken",
    "type": "string",
    "default": "",
    "description": "Matrix account access token"
  },
  {
    "key": "surfaces.matrix.userId",
    "type": "string",
    "default": "",
    "description": "Matrix user id (@user:server) the adapter acts as"
  },
  {
    "key": "surfaces.matrix.defaultRoomId",
    "type": "string",
    "default": "",
    "description": "Default Matrix room id for routing"
  },
  {
    "key": "watchers.enabled",
    "type": "boolean",
    "default": true,
    "description": "Enable managed watcher/listener services (checkpointing and recovery for long-running external sources). Default on: with no watchers configured the framework idles."
  },
  {
    "key": "watchers.pollIntervalMs",
    "type": "number",
    "default": 60000,
    "description": "Polling interval for watcher sources in milliseconds",
    "validationHint": "integer in [1000, 86400000]"
  },
  {
    "key": "watchers.heartbeatIntervalMs",
    "type": "number",
    "default": 15000,
    "description": "Heartbeat interval for watcher services in milliseconds",
    "validationHint": "integer in [1000, 3600000]"
  },
  {
    "key": "watchers.ciPollIntervalMs",
    "type": "number",
    "default": 60000,
    "description": "Cadence (ms) for the daemon's recurring CI-watch poll; the poller enforces a 15s floor to respect the status source's rate limits",
    "validationHint": "integer in [1000, 86400000]"
  },
  {
    "key": "watchers.recoveryWindowMinutes",
    "type": "number",
    "default": 10,
    "description": "Recovery window for watcher restart and missed-event catch-up",
    "validationHint": "integer in [0, 1440]"
  },
  {
    "key": "service.enabled",
    "type": "boolean",
    "default": true,
    "description": "Enable service-install and daemon-management features (install/start/stop/status/autostart verbs), including the standalone daemon's boot-time self-promotion to a supervised service at its first idle moment. Set false to keep spawned daemons session-only (nothing installed or promoted)."
  },
  {
    "key": "service.autostart",
    "type": "boolean",
    "default": false,
    "description": "Start Goodvibes automatically when the host boots or logs in"
  },
  {
    "key": "service.restartOnFailure",
    "type": "boolean",
    "default": true,
    "description": "Restart the service automatically after failure"
  },
  {
    "key": "service.platform",
    "type": "enum",
    "default": "auto",
    "description": "Target service manager platform",
    "enumValues": [
      "auto",
      "systemd",
      "launchd",
      "windows",
      "manual"
    ]
  },
  {
    "key": "service.serviceName",
    "type": "string",
    "default": "goodvibes",
    "description": "Service name used for host integration and install scripts"
  },
  {
    "key": "service.logPath",
    "type": "string",
    "default": "",
    "description": "File path for daemon/service logs (empty = platform default under the configured service directory)"
  },
  {
    "key": "network.outboundTls.mode",
    "type": "enum",
    "default": "bundled",
    "description": "Outbound HTTPS trust mode for Bun fetch-based network calls",
    "enumValues": [
      "bundled",
      "bundled+custom",
      "custom"
    ]
  },
  {
    "key": "network.outboundTls.customCaFile",
    "type": "string",
    "default": "",
    "description": "Additional PEM file to trust for outbound HTTPS when using bundled+custom or custom mode"
  },
  {
    "key": "network.outboundTls.customCaDir",
    "type": "string",
    "default": "",
    "description": "Directory of PEM/CRT/CER files to trust for outbound HTTPS when using bundled+custom or custom mode"
  },
  {
    "key": "network.outboundTls.allowInsecureLocalhost",
    "type": "boolean",
    "default": false,
    "description": "Allow self-signed HTTPS only for localhost/loopback outbound requests"
  },
  {
    "key": "network.remoteFetch.allowPrivateHosts",
    "type": "boolean",
    "default": false,
    "description": "Allow explicit admin-approved remote fetches from private, localhost, or metadata hosts for artifacts and ingest flows"
  },
  {
    "key": "relay.enabled",
    "type": "boolean",
    "default": true,
    "description": "Connect the daemon OUTBOUND to a zero-knowledge relay for reachability from outside the LAN. Default on, but no connection is ever made without an explicitly configured relay.url — leave the URL empty to keep the daemon LAN-only."
  },
  {
    "key": "relay.url",
    "type": "string",
    "default": "",
    "description": "Relay URL to dial (wss://…); empty disables the outbound relay connection"
  },
  {
    "key": "relay.rendezvousId",
    "type": "string",
    "default": "",
    "description": "Stable unguessable rendezvous id the daemon registers under; generated on first enable when empty"
  },
  {
    "key": "relay.label",
    "type": "string",
    "default": "",
    "description": "Human-facing daemon label carried in relay pairing payloads"
  },
  {
    "key": "relay.requireStepUpForMutations",
    "type": "boolean",
    "default": false,
    "description": "Require a recent WebAuthn step-up assertion on mutating operator calls arriving via relay (fails closed until a verifier is wired)"
  },
  {
    "key": "runtime.companionChatLimiter.perSessionLimit",
    "type": "number",
    "default": 10,
    "description": "Max companion chat messages per 60-second window per session. Overrides the GOODVIBES_CHAT_LIMITER_THRESHOLD env var (env is read once at daemon startup; this config key is read on each check() call and takes precedence when set to a positive integer)."
  },
  {
    "key": "runtime.eventBus.maxListeners",
    "type": "number",
    "default": 100,
    "description": "Maximum number of listeners per event channel (per-type and per-domain) before a warning is emitted in production or a RangeError is thrown in development mode. Raise this only if you have verified there is no subscriber leak.",
    "validationHint": "integer in [1, 100000]"
  },
  {
    "key": "telemetry.includeRawPrompts",
    "type": "boolean",
    "default": false,
    "description": "When false (default), turn emitters emit a redacted prompt summary {length, sha256, first100chars} instead of raw prompt/response content. Set to true ONLY for debugging in non-production environments — raw prompts may contain PII, secrets, or proprietary data. When true at startup, a WARN log is emitted to make the configuration visible to ops."
  },
  {
    "key": "telemetry.decisionOtlpEnabled",
    "type": "boolean",
    "default": false,
    "description": "Export permission/policy decision-log records to an OTLP endpoint (export-only, no ingestion). Requires telemetry.decisionOtlpEndpoint"
  },
  {
    "key": "telemetry.decisionOtlpEndpoint",
    "type": "string",
    "default": "",
    "description": "OTLP/HTTP JSON endpoint base for decision-log export (empty = disabled). Spans POST to <base>/v1/traces, logs to <base>/v1/logs"
  },
  {
    "key": "telemetry.decisionOtlpSignal",
    "type": "enum",
    "default": "span",
    "description": "Which OTLP record shape each decision is emitted as: span, log, or both",
    "enumValues": [
      "span",
      "log",
      "both"
    ]
  },
  {
    "key": "batch.mode",
    "type": "enum",
    "default": "off",
    "description": "Daemon provider Batch API mode: off, explicit per request, or eligible-by-default for batch-capable daemon requests",
    "enumValues": [
      "off",
      "explicit",
      "eligible-by-default"
    ]
  },
  {
    "key": "batch.fallback",
    "type": "enum",
    "default": "live",
    "description": "Fallback behavior when a batch-requested job is not eligible: live allows callers to choose live execution, fail rejects the batch job",
    "enumValues": [
      "live",
      "fail"
    ]
  },
  {
    "key": "batch.queueBackend",
    "type": "enum",
    "default": "local",
    "description": "Queue backend for daemon batch signals. local stores jobs under the daemon config directory; cloudflare requires cloudflare.enabled.",
    "enumValues": [
      "local",
      "cloudflare"
    ]
  },
  {
    "key": "batch.tickIntervalMs",
    "type": "number",
    "default": 60000,
    "description": "Daemon-local batch scheduler tick interval in milliseconds",
    "validationHint": "integer in [5000, 3600000]"
  },
  {
    "key": "batch.maxDelayMs",
    "type": "number",
    "default": 300000,
    "description": "Maximum time a queued local batch job should wait before the daemon submits its provider batch",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "batch.maxJobsPerProviderBatch",
    "type": "number",
    "default": 100,
    "description": "Maximum SDK jobs grouped into a single upstream provider batch submission",
    "validationHint": "integer in [1, 100000]"
  },
  {
    "key": "batch.maxQueuePayloadBytes",
    "type": "number",
    "default": 16384,
    "description": "Recommended maximum Cloudflare queue message payload size; queue messages should be signals, not full prompt archives",
    "validationHint": "integer in [1024, 131072]"
  },
  {
    "key": "batch.maxQueueMessagesPerDay",
    "type": "number",
    "default": 1000,
    "description": "SDK-side free-tier guardrail for Cloudflare queue message volume",
    "validationHint": "integer in [0, 10000000]"
  },
  {
    "key": "cloudflare.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable optional Cloudflare Worker/Queue integration points. The daemon does not require Cloudflare when this is false."
  },
  {
    "key": "cloudflare.freeTierMode",
    "type": "boolean",
    "default": true,
    "description": "Prefer Cloudflare usage patterns that fit the free tier: small queue signals, local daemon storage, and bounded daily queue volume"
  },
  {
    "key": "cloudflare.accountId",
    "type": "string",
    "default": "",
    "description": "Cloudflare account id used by SDK-owned Worker/Queue provisioning"
  },
  {
    "key": "cloudflare.apiTokenRef",
    "type": "string",
    "default": "",
    "description": "GoodVibes secret reference for the Cloudflare API token. If empty, the SDK falls back to CLOUDFLARE_API_TOKEN."
  },
  {
    "key": "cloudflare.zoneId",
    "type": "string",
    "default": "",
    "description": "Optional Cloudflare zone id selected for SDK-managed DNS and Zero Trust Access hostnames"
  },
  {
    "key": "cloudflare.zoneName",
    "type": "string",
    "default": "",
    "description": "Optional Cloudflare zone name selected during discovery/onboarding when zone id is not known yet"
  },
  {
    "key": "cloudflare.workerName",
    "type": "string",
    "default": "goodvibes-batch-worker",
    "description": "Cloudflare Worker script name managed by GoodVibes provisioning"
  },
  {
    "key": "cloudflare.workerSubdomain",
    "type": "string",
    "default": "",
    "description": "Cloudflare account workers.dev subdomain used to infer cloudflare.workerBaseUrl"
  },
  {
    "key": "cloudflare.workerHostname",
    "type": "string",
    "default": "",
    "description": "Optional custom hostname for the GoodVibes Cloudflare Worker when DNS automation is enabled"
  },
  {
    "key": "cloudflare.workerBaseUrl",
    "type": "string",
    "default": "",
    "description": "Optional deployed GoodVibes Cloudflare Worker base URL used by clients that proxy batch signals through Workers"
  },
  {
    "key": "cloudflare.daemonBaseUrl",
    "type": "string",
    "default": "",
    "description": "Daemon origin URL the Cloudflare Worker or Tunnel uses for Worker-to-daemon batch calls"
  },
  {
    "key": "cloudflare.daemonHostname",
    "type": "string",
    "default": "",
    "description": "Optional public daemon hostname managed through Cloudflare DNS, Tunnel, and Access provisioning"
  },
  {
    "key": "cloudflare.workerTokenRef",
    "type": "string",
    "default": "",
    "description": "Optional GoodVibes secret reference for the Worker-to-daemon bearer token"
  },
  {
    "key": "cloudflare.workerClientTokenRef",
    "type": "string",
    "default": "",
    "description": "Optional GoodVibes secret reference for the bearer token clients use when calling the Cloudflare Worker"
  },
  {
    "key": "cloudflare.workerCron",
    "type": "string",
    "default": "*/5 * * * *",
    "description": "Cron trigger installed on the GoodVibes Cloudflare Worker for batch scheduler ticks"
  },
  {
    "key": "cloudflare.queueName",
    "type": "string",
    "default": "goodvibes-batch",
    "description": "Cloudflare Queue binding/name for GoodVibes batch job signals"
  },
  {
    "key": "cloudflare.deadLetterQueueName",
    "type": "string",
    "default": "goodvibes-batch-dlq",
    "description": "Cloudflare dead-letter queue binding/name for failed GoodVibes batch job signals"
  },
  {
    "key": "cloudflare.tunnelName",
    "type": "string",
    "default": "goodvibes-daemon",
    "description": "Zero Trust Tunnel name managed by GoodVibes provisioning when tunnel integration is enabled"
  },
  {
    "key": "cloudflare.tunnelId",
    "type": "string",
    "default": "",
    "description": "Cloudflare Zero Trust Tunnel id selected or created by GoodVibes provisioning"
  },
  {
    "key": "cloudflare.tunnelTokenRef",
    "type": "string",
    "default": "",
    "description": "GoodVibes secret reference for the cloudflared tunnel token generated by provisioning"
  },
  {
    "key": "cloudflare.accessAppId",
    "type": "string",
    "default": "",
    "description": "Cloudflare Zero Trust Access application id protecting the GoodVibes daemon hostname"
  },
  {
    "key": "cloudflare.accessServiceTokenId",
    "type": "string",
    "default": "",
    "description": "Cloudflare Zero Trust Access service token id created for GoodVibes daemon access"
  },
  {
    "key": "cloudflare.accessServiceTokenRef",
    "type": "string",
    "default": "",
    "description": "GoodVibes secret reference storing Access service token client id/secret JSON"
  },
  {
    "key": "cloudflare.kvNamespaceName",
    "type": "string",
    "default": "goodvibes-runtime",
    "description": "Cloudflare KV namespace name used for optional edge runtime state"
  },
  {
    "key": "cloudflare.kvNamespaceId",
    "type": "string",
    "default": "",
    "description": "Cloudflare KV namespace id used for the GoodVibes Worker binding"
  },
  {
    "key": "cloudflare.durableObjectNamespaceName",
    "type": "string",
    "default": "GoodVibesCoordinator",
    "description": "Cloudflare Durable Object class/namespace name used for optional edge coordination"
  },
  {
    "key": "cloudflare.durableObjectNamespaceId",
    "type": "string",
    "default": "",
    "description": "Cloudflare Durable Object namespace id discovered after Worker migration"
  },
  {
    "key": "cloudflare.r2BucketName",
    "type": "string",
    "default": "goodvibes-artifacts",
    "description": "Cloudflare R2 Standard bucket name used for optional GoodVibes artifacts"
  },
  {
    "key": "cloudflare.secretsStoreName",
    "type": "string",
    "default": "goodvibes",
    "description": "Cloudflare Secrets Store name managed by optional GoodVibes provisioning"
  },
  {
    "key": "cloudflare.secretsStoreId",
    "type": "string",
    "default": "",
    "description": "Cloudflare Secrets Store id selected or created by GoodVibes provisioning"
  },
  {
    "key": "cloudflare.maxQueueOpsPerDay",
    "type": "number",
    "default": 10000,
    "description": "Free-tier queue operation budget used by clients to warn before Cloudflare queue usage exceeds the intended budget",
    "validationHint": "integer in [0, 10000000]"
  },
  {
    "key": "update.auto",
    "type": "boolean",
    "default": true,
    "description": "Daemon self-update: check for a new release hourly, download and checksum-verify it, swap at a no-active-work moment, and restart (owner-directed default; the previous binary is kept for one-command rollback)"
  },
  {
    "key": "update.intervalMinutes",
    "type": "number",
    "default": 60,
    "description": "Minutes between daemon update checks",
    "validationHint": "integer in [5, 1440]"
  },
  {
    "key": "update.releasesUrl",
    "type": "string",
    "default": "https://github.com/mgd34msu/goodvibes-tui/releases/latest",
    "description": "GitHub releases/latest URL the daemon resolves update tags and artifacts from"
  },
  {
    "key": "daemon.enabled",
    "type": "boolean",
    "default": true,
    "description": "Run the local session daemon (background service that hosts the shared session broker and companion chat). Default on; binds loopback (127.0.0.1) only. Set false to run fully local with no background service."
  },
  {
    "key": "daemon.embedInProcess",
    "type": "boolean",
    "default": false,
    "description": "NOT RECOMMENDED. When true, and no daemon is already running, host the daemon INSIDE this surface process instead of spawning it as a detached background process. In-process embedding couples the daemon lifetime to this one surface: exiting the surface kills the daemon and every other surface sharing it (single point of failure). Default false — the surface spawns a detached, reboot-independent daemon (install it as a system service via POST /api/service/install on the daemon HTTP API)."
  },
  {
    "key": "danger.httpListener",
    "type": "boolean",
    "default": false,
    "description": "Enable HTTP webhook listener for receiving external events"
  },
  {
    "key": "tools.llmEnabled",
    "type": "boolean",
    "default": false,
    "description": "Enable dedicated tool LLM for internal operations (off = tools use the main conversation model only when needed)"
  },
  {
    "key": "tools.llmProvider",
    "type": "string",
    "default": "",
    "description": "Provider for tool LLM calls (empty = use currently selected provider)"
  },
  {
    "key": "tools.llmModel",
    "type": "string",
    "default": "",
    "description": "Model for tool LLM calls (empty = fastest available for the provider)"
  },
  {
    "key": "tools.autoHeal",
    "type": "boolean",
    "default": false,
    "description": "Automatically fix syntax errors on precision write/edit operations"
  },
  {
    "key": "tools.defaultTokenBudget",
    "type": "number",
    "default": 5000,
    "description": "Default token budget for precision read operations",
    "validationHint": "number in [100, 100000]"
  },
  {
    "key": "tools.hooksFile",
    "type": "string",
    "default": "hooks.json",
    "description": "Hook configuration file name (relative to the host .goodvibes data directory)"
  },
  {
    "key": "tools.overflowSpillBackend",
    "type": "enum",
    "default": "file",
    "description": "Where large tool-output overflow content spills: file (on-disk .overflow, default), ledger (execution ledger), or diagnostics. An injected custom backend still takes precedence.",
    "enumValues": [
      "file",
      "ledger",
      "diagnostics"
    ]
  },
  {
    "key": "wrfc.scoreThreshold",
    "type": "number",
    "default": 9.9,
    "description": "Minimum review score to pass WRFC (0-10)",
    "validationHint": "number in [0, 10]"
  },
  {
    "key": "wrfc.maxFixAttempts",
    "type": "number",
    "default": 5,
    "description": "Maximum gate retry depth before aborting WRFC chain",
    "validationHint": "number in [1, 20]"
  },
  {
    "key": "wrfc.autoCommit",
    "type": "boolean",
    "default": true,
    "description": "Auto-commit when WRFC chain passes review and quality gates"
  },
  {
    "key": "wrfc.commitScope",
    "type": "enum",
    "default": "scoped",
    "description": "Scope of files staged on WRFC auto-commit: off (never commit), scoped (only chain-touched files, default), all (legacy full-tree git add -A)",
    "enumValues": [
      "off",
      "scoped",
      "all"
    ]
  },
  {
    "key": "wrfc.agentHeartbeatTimeoutMs",
    "type": "number",
    "default": 0,
    "description": "Watchdog timeout in ms for silent WRFC child agents. 0 = disabled."
  },
  {
    "key": "wrfc.transportRetryLimit",
    "type": "number",
    "default": 1,
    "description": "How many times a WRFC chain auto-retries a transport/network-classified child-agent failure (respawning the same role) before failing the chain. 0 disables the retry.",
    "validationHint": "number in [0, 5]"
  },
  {
    "key": "wrfc.transportRetryDelayMs",
    "type": "number",
    "default": 5000,
    "description": "Backoff delay in ms before respawning a WRFC child agent after a transport-classified failure.",
    "validationHint": "number in [0, 60000]"
  },
  {
    "key": "cache.enabled",
    "type": "boolean",
    "default": true,
    "description": "Enable prompt caching for eligible providers (Anthropic)"
  },
  {
    "key": "cache.stableTtl",
    "type": "enum",
    "default": "1h",
    "description": "Cache TTL for stable content (system prompt + tools): 5m (ephemeral) or 1h (persistent)",
    "enumValues": [
      "5m",
      "1h"
    ]
  },
  {
    "key": "cache.monitorHitRate",
    "type": "boolean",
    "default": true,
    "description": "Monitor cache hit rate and warn when below threshold"
  },
  {
    "key": "cache.hitRateWarningThreshold",
    "type": "number",
    "default": 0.3,
    "description": "Warn when cache hit rate falls below this fraction (0.0–1.0)",
    "validationHint": "number in [0, 1]"
  },
  {
    "key": "helper.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable helper model routing for grunt-work tasks"
  },
  {
    "key": "helper.globalProvider",
    "type": "string",
    "default": "",
    "description": "Provider for the global helper model (empty = disabled)"
  },
  {
    "key": "helper.globalModel",
    "type": "string",
    "default": "",
    "description": "Model ID for the global helper model (empty = disabled)"
  },
  {
    "key": "behavior.suggestAlternativeOnProviderFail",
    "type": "boolean",
    "default": false,
    "description": "Show alternative model suggestion when current provider fails non-transiently"
  },
  {
    "key": "behavior.hitlMode",
    "type": "enum",
    "default": "balanced",
    "description": "Notification verbosity mode applied to the notification router at startup and on change: off (baseline delivery policy, mode changes rejected), quiet (minimal verbosity, long batch windows), balanced (default), or operator (verbose, short batch windows)",
    "enumValues": [
      "off",
      "quiet",
      "balanced",
      "operator"
    ]
  },
  {
    "key": "fetch.sanitizeMode",
    "type": "enum",
    "default": "safe-text",
    "description": "Default response sanitization mode applied by the fetch tool when the per-call sanitize_mode is omitted: none (no content sanitization), safe-text (strip active/script content, default), or strict (aggressive text-only reduction). A per-call sanitize_mode always overrides this default. Private-IP and cloud-metadata host blocking applies regardless of mode.",
    "enumValues": [
      "none",
      "safe-text",
      "strict"
    ]
  },
  {
    "key": "fetch.allowLocalhost",
    "type": "boolean",
    "default": false,
    "description": "Allow the fetch tool to reach localhost/loopback dev servers for this project (e.g. http://localhost:3000). Set by the one-tap \"allow for this project\" answer to the localhost fetch ask and persisted in the project settings, so it never re-asks. Private-IP and cloud-metadata endpoint blocking is unaffected and absolute."
  },
  {
    "key": "fetch.trustedHosts",
    "type": "string",
    "default": "",
    "description": "Comma-separated default trusted hosts for fetch sanitization/trust-tier classification (e.g. docs.example.com, api.internal). Trusted hosts relax sanitization. Per-call trusted_hosts are added on top of this default; empty means no host is trusted by default."
  },
  {
    "key": "fetch.blockedHosts",
    "type": "string",
    "default": "",
    "description": "Comma-separated default blocked hosts for fetch trust-tier classification. Blocked hosts are always refused regardless of sanitize mode. Per-call blocked_hosts are added on top of this default. The built-in SSRF-risk block (private IPs, metadata endpoints, localhost variants) applies independently of this list."
  },
  {
    "key": "security.tokenAudit.enabled",
    "type": "boolean",
    "default": true,
    "description": "Audit API tokens for minimum-scope violations and overdue rotation, surfacing age, scope, and rotation warnings in diagnostics with typed security events. Default on in advisory mode: tokens are reported, never blocked, unless security.tokenAudit.managed is also true."
  },
  {
    "key": "security.tokenAudit.rotationCadenceDays",
    "type": "number",
    "default": 90,
    "description": "Default rotation cadence (days) for the token audit: a token older than this is reported overdue. Per-policy rotationCadenceMs overrides this default. Only enforced (blocking) when security.tokenAudit.managed is also true.",
    "validationHint": "integer in [1, 3650]"
  },
  {
    "key": "security.tokenAudit.rotationWarningDays",
    "type": "number",
    "default": 14,
    "description": "Default lead time (days) before the rotation-cadence due date at which a token is reported as a rotation warning. Per-policy rotationWarningThresholdMs overrides this default.",
    "validationHint": "integer in [0, 3650]"
  },
  {
    "key": "security.tokenAudit.managed",
    "type": "boolean",
    "default": false,
    "description": "When true (and security.tokenAudit.enabled is on), tokens with excess scopes or overdue rotation are BLOCKED from use rather than only reported. Default false = advisory reporting only."
  },
  {
    "key": "integrations.routeBinding",
    "type": "boolean",
    "default": true,
    "description": "Durably bind and resolve external conversation routes, thread contexts, and reply targets across channel surfaces. Default on; it is inert until a channel surface is configured."
  },
  {
    "key": "integrations.deliveryTracking",
    "type": "boolean",
    "default": true,
    "description": "Track integration deliveries first-class: retries, dead letters, and per-surface delivery outcomes. Default on; it is inert until a channel surface is configured."
  },
  {
    "key": "integrations.delivery.maxRetries",
    "type": "number",
    "default": 3,
    "description": "Maximum retry attempts for a retryable integration delivery (Slack/Discord/webhook) before it moves to the dead-letter queue. A per-queue maxRetries option overrides this default.",
    "validationHint": "integer in [0, 100]"
  },
  {
    "key": "integrations.delivery.initialDelayMs",
    "type": "number",
    "default": 1000,
    "description": "Initial exponential-backoff delay (ms) between integration delivery retries. Delay grows as initialDelayMs * 2^(attempt-1) with jitter, capped at integrations.delivery.maxDelayMs.",
    "validationHint": "integer in [0, 3600000]"
  },
  {
    "key": "integrations.delivery.maxDelayMs",
    "type": "number",
    "default": 30000,
    "description": "Upper cap (ms) on the exponential-backoff delay between integration delivery retries.",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "integrations.delivery.maxDlqSize",
    "type": "number",
    "default": 500,
    "description": "Maximum entries retained in the integration delivery dead-letter queue; oldest entries are evicted first past this size.",
    "validationHint": "integer in [1, 100000]"
  },
  {
    "key": "integrations.delivery.sloEnforced",
    "type": "boolean",
    "default": true,
    "description": "Enforce delivery service-level objectives for channel integrations: failures are classified retryable/terminal, retried with exponential backoff, and dead-letter events are logged at error level and surfaced in integration diagnostics (replayable via /notify replay). When false, dead letters are warn-level only. An explicit per-queue sloEnforced option still overrides this default."
  },
  {
    "key": "policy.registryEnabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the versioned policy bundle registry with promote/rollback semantics and the /policy load, simulate, diff, promote, and rollback commands. Enforcement requires passing divergence-gate evidence first; default off until that evidence exists."
  },
  {
    "key": "policy.requireSignedBundles",
    "type": "boolean",
    "default": false,
    "description": "Validate HMAC-SHA256 signatures when policy bundles load: managed mode rejects bundles with invalid or missing signatures; non-managed mode permits unsigned bundles with a warning. Restart to apply. Default off until divergence evidence clears the governance gate."
  },
  {
    "key": "policy.bundleSource",
    "type": "enum",
    "default": "none",
    "description": "Where the policy bundle registry loads its initial bundle from at startup: none (no bundle loaded; bundles supplied programmatically or via commands), or file (load policy.bundlePath). Only consulted when policy.registryEnabled is true.",
    "enumValues": [
      "none",
      "file"
    ]
  },
  {
    "key": "policy.bundlePath",
    "type": "string",
    "default": "",
    "description": "Filesystem path to the policy bundle JSON loaded at startup when policy.bundleSource is \"file\" and policy.registryEnabled is true. Empty disables file loading. The loaded bundle enters the registry as a candidate (subject to the divergence gate before promotion)."
  },
  {
    "key": "agents.passiveInjection.knowledge",
    "type": "boolean",
    "default": true,
    "description": "Re-retrieve project-memory knowledge each turn against the evolving conversation (steers, new sub-topics), under the hard token budget with a visible per-turn injection record on the agent record and session transcript. Default on: the block is hard-budgeted and every turn is honestly recorded. Turn off to revert to spawn-time-only injection."
  },
  {
    "key": "agents.passiveInjection.code",
    "type": "boolean",
    "default": false,
    "description": "Additionally inject similarity-ranked chunks from the repo source-code index each turn as untrusted reference pointers, sharing the knowledge-injection budget and relevance floor, each with an honest match label on the turn record. Default off: code chunks carry no review provenance, so this is deliberately opt-in. Also respects storage.codeIndexEnabled."
  },
  {
    "key": "agents.passiveInjection.budgetTokens",
    "type": "number",
    "default": 800,
    "description": "Default hard token budget for per-turn passive knowledge/code injection. The effective budget is min(this value, 3% of the model context window). Set 0 to disable injection. A per-run passiveKnowledgeInjectionBudgetTokens override still wins.",
    "validationHint": "integer in [0, 1000000]"
  },
  {
    "key": "agents.passiveInjection.relevanceFloor",
    "type": "number",
    "default": 95,
    "description": "Minimum relevance score (higher = stricter) a knowledge/code candidate must clear to be eligible for per-turn passive injection. Filters filler before the token budget is applied. A per-run passiveKnowledgeInjectionRelevanceFloor override still wins.",
    "validationHint": "integer in [0, 1000]"
  },
  {
    "key": "agents.passiveInjection.codeLimit",
    "type": "number",
    "default": 3,
    "description": "Maximum number of source-code chunks injected per turn by passive code injection (chunks share the passive-injection token budget and relevance floor).",
    "validationHint": "integer in [0, 100]"
  },
  {
    "key": "agents.contextWindowGuard",
    "type": "boolean",
    "default": true,
    "description": "Before each sub-agent provider call, estimate total token count (system prompt + messages + tool definitions) and compact the conversation past agents.contextCompactThreshold, with layered system-prompt assembly for small windows and a single compaction retry on context-size errors. Turn off to revert to unchecked provider calls."
  },
  {
    "key": "agents.contextCompactThreshold",
    "type": "number",
    "default": 0.85,
    "description": "Fraction of the model context window at which the agent context-window guard triggers sub-agent conversation compaction (estimated system + messages + tool tokens above this fraction compacts). Distinct from behavior.autoCompactThreshold, which governs main-session conversation compaction.",
    "validationHint": "number in [0.1, 0.99]"
  },
  {
    "key": "agents.maxTurns",
    "type": "number",
    "default": 50,
    "description": "Default per-agent turn budget: the hard cap on how many turns one agent run may take before it terminates as a max-turns failure (a machine-readable turn-budget-exhausted outcome, distinct from an infrastructure error). A per-spawn override may lower or raise this, but never past agents.maxTurnsCap. Prevents an unbounded agent loop.",
    "validationHint": "integer in [1, 10000]"
  },
  {
    "key": "agents.maxTurnsCap",
    "type": "number",
    "default": 200,
    "description": "The upper bound a per-spawn maxTurns override cannot exceed. When a spawn requests more turns than this, the cap wins and the applied budget is reported as policy-bound. Keeps a caller from lifting the turn ceiling without limit.",
    "validationHint": "integer in [1, 100000]"
  },
  {
    "key": "permissions.engine",
    "type": "enum",
    "default": "baseline",
    "description": "Permission evaluator: baseline (default) or policy-engine (the redesigned layered model with granular tool-level, path-level, and parameter-level rules). Restart to apply. Default baseline until divergence evidence from the shadow simulation clears the gate.",
    "enumValues": [
      "baseline",
      "policy-engine"
    ]
  },
  {
    "key": "permissions.simulation",
    "type": "boolean",
    "default": true,
    "description": "Run the candidate permission evaluator beside the active one, recording divergence without changing enforcement. Default on so divergence evidence accumulates before stricter enforcement is considered; it never blocks tool execution by itself. Restart to apply."
  },
  {
    "key": "permissions.divergenceDashboard",
    "type": "boolean",
    "default": true,
    "description": "Aggregate permission-evaluator divergence by tool/prefix/mode, expose trend history in diagnostics, and block enforce-mode transitions while the divergence rate exceeds permissions.divergenceThreshold. Turn off to fall back to warn mode (no gate enforcement)."
  },
  {
    "key": "permissions.commandParser",
    "type": "enum",
    "default": "ast",
    "description": "Compound shell command evaluation: ast (default — per-segment safe/unsafe verdicts with specific denial explanations, automatic fallback to flat on any parser failure) or flat (baseline segmentation). The frozen catastrophic command block is enforced identically in both modes.",
    "enumValues": [
      "ast",
      "flat"
    ]
  },
  {
    "key": "behavior.toolResultReconciliation",
    "type": "enum",
    "default": "reconcile",
    "description": "What happens to dangling tool-call state at turn end: reconcile (default — synthetic error results are injected and a reconciliation event emitted, preventing silent conversation corruption) or warn-only (log a warning without injecting results).",
    "enumValues": [
      "reconcile",
      "warn-only"
    ]
  },
  {
    "key": "provider.localContextIngestion",
    "type": "boolean",
    "default": true,
    "description": "Ingest max_context_length from local/custom provider /v1/models endpoints so local models use the provider-reported context window for token budgeting and compaction thresholds. Turn off to use only explicitly configured or static limits."
  },
  {
    "key": "planner.adaptive",
    "type": "boolean",
    "default": false,
    "description": "Score execution-strategy candidates (single/cohort/background/remote) on risk, latency, and capability inputs each turn and select the best one, with /plan mode, explain, and override commands. Default off until the routing-visibility UX lands; off means implicit single-call execution."
  },
  {
    "key": "tools.contractVerification",
    "type": "boolean",
    "default": true,
    "description": "Run registration-time contract checks on every registered tool: schema validity, timeout/cancellation semantics, permission-class mapping, output-policy alignment, and idempotency declarations. Invalid tools fail closed with actionable diagnostics. Turn off to let tools register unchecked."
  },
  {
    "key": "tools.outputSchemaFingerprints",
    "type": "boolean",
    "default": false,
    "description": "Append _meta.outputSchemaFingerprint (SHA-256 of sorted result key names) and _meta.schemaShapeId to results from the find, analyze, and inspect tools, enabling schema drift detection. Default off."
  },
  {
    "key": "telemetry.otelMode",
    "type": "enum",
    "default": "off",
    "description": "OpenTelemetry instrumentation: off (default — no OTel SDK initialization), in-process (span creation and in-process export only), or remote-export (additionally export spans over OTLP/gRPC to the configured collector). Switching away from off requires a restart; in-process <-> remote-export applies live.",
    "enumValues": [
      "off",
      "in-process",
      "remote-export"
    ]
  },
  {
    "key": "runtime.unifiedTasks",
    "type": "boolean",
    "default": false,
    "description": "Replace ad-hoc task tracking with the unified RuntimeTask interface across all subsystems. Restart to apply. Default off."
  },
  {
    "key": "runtime.pluginLifecycle",
    "type": "boolean",
    "default": false,
    "description": "Structured plugin lifecycle with init/teardown phases and health integration. Restart to apply. Default off until the plugin catalog work lands."
  },
  {
    "key": "runtime.mcpLifecycle",
    "type": "boolean",
    "default": false,
    "description": "Structured MCP server lifecycle with connect/disconnect phases and health integration. Restart to apply. Default off until the plugin catalog work lands."
  },
  {
    "key": "runtime.toolBudget.enforced",
    "type": "boolean",
    "default": false,
    "description": "Enforce per-phase runtime budgets on tool execution: wall-clock, token, and cost limits (runtime.toolBudget.maxMs/maxTokens/maxCostUsd) checked at phase entry and exit, terminating the pipeline on a hard breach with a typed diagnostic event. Default off until budget attribution wiring lands."
  },
  {
    "key": "runtime.toolBudget.maxMs",
    "type": "number",
    "default": 0,
    "description": "Default per-phase wall-clock budget (ms) for tool execution when runtime.toolBudget.enforced is true. 0 = unlimited. A per-call ToolRuntimeContext.budget.maxMs overrides this default.",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "runtime.toolBudget.maxTokens",
    "type": "number",
    "default": 0,
    "description": "Default token budget for a single tool execution when runtime.toolBudget.enforced is true (checked against a tool result tokenCount annotation at phase exit). 0 = unlimited. A per-call ToolRuntimeContext.budget.maxTokens overrides.",
    "validationHint": "integer in [0, 100000000]"
  },
  {
    "key": "runtime.toolBudget.maxCostUsd",
    "type": "number",
    "default": 0,
    "description": "Default cost budget (USD) for a single tool execution when runtime.toolBudget.enforced is true (checked against a tool result costUsd annotation at phase exit). 0 = unlimited. A per-call ToolRuntimeContext.budget.maxCostUsd overrides.",
    "validationHint": "number in [0, 1000000]"
  },
  {
    "key": "notifications.adaptiveSuppression",
    "type": "boolean",
    "default": true,
    "description": "Adaptive notification suppression: in quiet/minimal mode, operational churn is filtered before reaching the conversation or status bar, and rapid domain:level floods collapse into panel-only groups with a burst_collapsed reason code rendered by the notifications panel. Critical, milestone, and alert notifications are always exempt. Turn off to keep only the base delivery policies."
  },
  {
    "key": "notifications.burstWindowMs",
    "type": "number",
    "default": 1000,
    "description": "Observation window (ms) for the adaptive-suppression burst detector: rapid domain:level notifications arriving within this window count toward the burst threshold. Applied at NotificationRouter construction.",
    "validationHint": "integer in [1, 3600000]"
  },
  {
    "key": "notifications.burstThreshold",
    "type": "number",
    "default": 3,
    "description": "Number of notifications for one domain:level group within the burst window that trips adaptive suppression, collapsing further ones to panel_only with a burst_collapsed reason. Critical/milestone/alert notifications are always exempt.",
    "validationHint": "integer in [1, 10000]"
  },
  {
    "key": "notifications.burstCooldownMs",
    "type": "number",
    "default": 3000,
    "description": "Cooldown (ms) after a domain:level group trips the burst detector before it can trip again. Applied at NotificationRouter construction.",
    "validationHint": "integer in [0, 3600000]"
  },
  {
    "key": "notifications.pushApproval",
    "type": "boolean",
    "default": true,
    "description": "Device-push fan-out for the approval class: a pending approval pushes to every paired push target. On by default — the toggle exists to silence the class, never as a prerequisite for it to work. Read live per event."
  },
  {
    "key": "notifications.pushNeedsInput",
    "type": "boolean",
    "default": true,
    "description": "Device-push fan-out for the needs-input class: a fleet node blocked on the operator pushes to every paired push target (presence-suppressed when a surface is attached). On by default; the toggle only silences. Read live per event."
  },
  {
    "key": "notifications.pushCompletion",
    "type": "boolean",
    "default": true,
    "description": "Device-push fan-out for the completion class: a tracked run reaching a terminal state (done/failed/killed) pushes to every paired push target. On by default with zero setup; the toggle only silences. Read live per event."
  },
  {
    "key": "notifications.blockedEscalationGraceMs",
    "type": "number",
    "default": 300000,
    "description": "How long a fleet node blocked on the operator may wait for a HUMAN response before a device push is sent REGARDLESS of an attached surface. Presence (an open TUI, a heartbeat) suppresses only the immediate push, never this escalation — a process being attended is not a human answer. A real interaction that clears the block cancels the escalation. Read live when a block is first tracked.",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "notifications.blockedEscalationFollowUpMs",
    "type": "number",
    "default": 300000,
    "description": "Interval between the bounded follow-up reminders that fire after the first blocked-too-long escalation, while the block remains unanswered. Read live per reminder.",
    "validationHint": "integer in [0, 86400000]"
  },
  {
    "key": "notifications.blockedEscalationMaxFollowUps",
    "type": "number",
    "default": 2,
    "description": "Upper bound on follow-up reminders after the first blocked-too-long escalation (0 = escalate exactly once, no reminders). Keeps a long-unanswered block from becoming an unbounded stream of pushes.",
    "validationHint": "integer in [0, 100]"
  },
  {
    "key": "pricing.modelPrices",
    "type": "object",
    "default": {},
    "description": "Manual model prices, keyed provider:model (e.g. \"openrouter:deepseek/deepseek-chat\"). Each entry: { input, output, cacheRead?, cacheWrite? } in USD per 1M tokens. A manual price always wins over provider-served and catalog pricing and applies live (no restart). Set one when registering a custom provider/model, or to pin a negotiated rate for any model.",
    "validationHint": "record keyed \"provider:model\" of { input, output, cacheRead?, cacheWrite? } — finite numbers >= 0, USD per 1M tokens"
  }
];
