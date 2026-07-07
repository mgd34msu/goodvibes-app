// GENERATED FILE — pinned snapshot of CONFIG_SCHEMA from
// @pellux/goodvibes-sdk@1.3.3 (platform/config, Bun-only subpath the
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
  readonly type: "boolean" | "number" | "string" | "enum";
  readonly default: unknown;
  readonly description: string;
  readonly enumValues?: readonly string[];
  readonly validationHint?: string;
}

export const CONFIG_SCHEMA_SNAPSHOT: readonly ConfigSettingMeta[] = [
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
    "description": "Permission approval mode: prompt (default), allow-all, or custom",
    "enumValues": [
      "prompt",
      "allow-all",
      "custom"
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
    "key": "orchestration.maxActiveAgents",
    "type": "number",
    "default": 8,
    "description": "Total active agents allowed across the orchestration tree",
    "validationHint": "number in [1, 20]"
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
    "default": false,
    "description": "Enable the automation subsystem"
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
    "key": "controlPlane.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the shared gateway/control-plane service"
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
    "default": false,
    "description": "Enable the browser-based operator surface"
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
    "key": "watchers.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable managed watcher/listener services"
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
    "key": "watchers.recoveryWindowMinutes",
    "type": "number",
    "default": 10,
    "description": "Recovery window for watcher restart and missed-event catch-up",
    "validationHint": "integer in [0, 1440]"
  },
  {
    "key": "service.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable service-install and daemon-management features"
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
    "description": "HITL UX mode: controls notification verbosity and burst batching (quiet/balanced/operator)",
    "enumValues": [
      "quiet",
      "balanced",
      "operator"
    ]
  }
];
