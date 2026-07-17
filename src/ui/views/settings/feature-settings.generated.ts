// GENERATED FILE — pinned snapshot of FEATURE_SETTINGS (platform/runtime/
// feature-flags) plus the CONFIG_SCHEMA entries every feature unit's
// enablement key and settings keys reference, from the installed
// @pellux/goodvibes-sdk@1.11.2. The dissolved-feature model (SDK 1.7.1+):
// every platform capability is a first-class domain settings key — there is
// no separate enablement namespace. This file is the FeatureSettingsSection
// counterpart to config-schema.generated.ts (which pins only CONFIG_SCHEMA
// and is stale relative to this SDK version — see settings/README notes in
// the integration report); FEATURE_SETTINGS_SNAPSHOT and
// FEATURE_SCHEMA_ENTRIES below are generated straight from the SDK's
// platform/runtime/feature-flags and platform/config barrels so every
// feature card renders a fully typed enablement control and settings
// fields regardless of that staleness. Pure data — no runtime functions
// cross the Bun/webview boundary. The daemon re-validates every config.set
// anyway; client-side hints are advisory only.
//
// Regenerate with a one-off Bun snippet that requires the SDK's
// platform/runtime/feature-flags and platform/config barrels, intersects
// FEATURE_SETTINGS's referenced keys against CONFIG_SCHEMA, and
// re-serializes both arrays — mirrors config-schema.generated.ts's own
// header instructions and scripts/generate-operator-routes.ts's pattern.

import type { ConfigSettingMeta } from "./config-schema.generated.ts";

export type FeatureEnablementKind = "boolean" | "enum" | "constant";

export interface FeatureSettingMeta {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly enablement: {
    readonly key: string;
    readonly kind: FeatureEnablementKind;
    readonly enabledValues?: readonly string[];
  };
  readonly settings: readonly string[];
  readonly restartRequired: boolean;
  readonly defaultEnabled: boolean;
}

/** Every platform capability the settings surface renders as a feature unit,
 *  ordered by the SDK registry declaration order (groups derive their order
 *  from first-appearance here, per feature.domain). */
export const FEATURE_SETTINGS_SNAPSHOT: readonly FeatureSettingMeta[] = [
  {
    "id": "permissions-policy-engine",
    "name": "Permissions Policy Engine",
    "description": "Activates the redesigned permission model with granular tool-level and path-level rules.",
    "domain": "permissions",
    "enablement": {
      "key": "permissions.engine",
      "kind": "enum",
      "enabledValues": [
        "policy-engine"
      ]
    },
    "settings": [
      "permissions.engine",
      "permissions.mode",
      "permissions.backgroundAgents",
      "permissions.tools.read",
      "permissions.tools.write",
      "permissions.tools.edit",
      "permissions.tools.exec",
      "permissions.tools.find",
      "permissions.tools.fetch",
      "permissions.tools.analyze",
      "permissions.tools.inspect",
      "permissions.tools.agent",
      "permissions.tools.state",
      "permissions.tools.workflow",
      "permissions.tools.registry",
      "permissions.tools.delegate",
      "permissions.tools.mcp"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "permissions-simulation",
    "name": "Permissions Simulation Mode",
    "description": "Enables the dual-evaluator simulation pipeline for the permissions policy engine. Tracks divergence between actual and candidate evaluators without changing enforcement behaviour until switched to enforce mode. On by default so divergence evidence accumulates before any stricter enforcement is considered; it never blocks tool execution by itself.",
    "domain": "permissions",
    "enablement": {
      "key": "permissions.simulation",
      "kind": "boolean"
    },
    "settings": [
      "permissions.simulation"
    ],
    "restartRequired": true,
    "defaultEnabled": true
  },
  {
    "id": "hitl-ux-modes",
    "name": "HITL UX Modes",
    "description": "Enables the HITL UX mode system (quiet/balanced/operator) for notification verbosity control. When enabled, ModeManager applies the configured HITL preset to the notification router at startup and on mode change. Set behavior.hitlMode to off to keep the router on its baseline delivery policy and reject HITL mode changes.",
    "domain": "behavior",
    "enablement": {
      "key": "behavior.hitlMode",
      "kind": "enum",
      "enabledValues": [
        "quiet",
        "balanced",
        "operator"
      ]
    },
    "settings": [
      "behavior.hitlMode"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "unified-runtime-task",
    "name": "Unified RuntimeTask",
    "description": "Replaces ad-hoc task tracking with the unified RuntimeTask interface across all subsystems.",
    "domain": "runtime",
    "enablement": {
      "key": "runtime.unifiedTasks",
      "kind": "boolean"
    },
    "settings": [
      "runtime.unifiedTasks"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "plugin-lifecycle",
    "name": "Plugin Lifecycle",
    "description": "Enables the plugin lifecycle with structured init/teardown phases and health integration.",
    "domain": "runtime",
    "enablement": {
      "key": "runtime.pluginLifecycle",
      "kind": "boolean"
    },
    "settings": [
      "runtime.pluginLifecycle"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "mcp-lifecycle",
    "name": "MCP Lifecycle",
    "description": "Enables the MCP server lifecycle with structured connect/disconnect phases and health integration.",
    "domain": "runtime",
    "enablement": {
      "key": "runtime.mcpLifecycle",
      "kind": "boolean"
    },
    "settings": [
      "runtime.mcpLifecycle"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "otel-foundation",
    "name": "OTel Foundation",
    "description": "Enables the OpenTelemetry instrumentation foundation: SDK init, span creation, and in-process export.",
    "domain": "telemetry",
    "enablement": {
      "key": "telemetry.otelMode",
      "kind": "enum",
      "enabledValues": [
        "in-process",
        "remote-export"
      ]
    },
    "settings": [
      "telemetry.otelMode"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "otel-remote-export",
    "name": "OTel Remote Export",
    "description": "Enables OTLP/gRPC remote export of spans to a configured collector endpoint. Requires otel-foundation.",
    "domain": "telemetry",
    "enablement": {
      "key": "telemetry.otelMode",
      "kind": "enum",
      "enabledValues": [
        "remote-export"
      ]
    },
    "settings": [
      "telemetry.otelMode",
      "telemetry.decisionOtlpEnabled",
      "telemetry.decisionOtlpEndpoint",
      "telemetry.decisionOtlpSignal"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "tool-result-reconciliation",
    "name": "Tool Result Reconciliation",
    "description": "Detects and reconciles unresolved tool calls at turn end. When enabled, dangling tool-call state causes synthetic error results to be injected and a reconciliation event to be emitted, preventing silent conversation corruption. Disable to keep warning-only logging without synthetic result injection.",
    "domain": "behavior",
    "enablement": {
      "key": "behavior.toolResultReconciliation",
      "kind": "enum",
      "enabledValues": [
        "reconcile"
      ]
    },
    "settings": [
      "behavior.toolResultReconciliation"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "policy-signing",
    "name": "Policy Signing",
    "description": "Enables HMAC-SHA256 signature validation on policy bundle load. When enabled, managed mode rejects bundles with invalid or missing signatures. In non-managed mode, unsigned bundles are permitted with a warning status.",
    "domain": "policy",
    "enablement": {
      "key": "policy.requireSignedBundles",
      "kind": "boolean"
    },
    "settings": [
      "policy.requireSignedBundles"
    ],
    "restartRequired": true,
    "defaultEnabled": false
  },
  {
    "id": "session-compaction",
    "name": "Session Compaction",
    "description": "Activates structured session compaction with semantic chunking and relevance scoring. On by default: long sessions compact at behavior.autoCompactThreshold with a receipt on every compaction. Set behavior.compactionStrategy to off to run uncompacted.",
    "domain": "behavior",
    "enablement": {
      "key": "behavior.compactionStrategy",
      "kind": "enum",
      "enabledValues": [
        "structured",
        "distiller"
      ]
    },
    "settings": [
      "behavior.compactionStrategy",
      "behavior.autoCompactThreshold",
      "behavior.staleContextWarnings"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "compaction-distiller-strategy",
    "name": "Fresh-Context Distiller Compaction",
    "description": "Enables the fresh-context DISTILLER compaction strategy as an alternative to the default in-place structured summarization. When on AND behavior.compactionStrategy is set to \"distiller\", one fresh model call distills the conversation into a structured continuation brief (task state, decisions, open threads, key file/symbol references) that seeds a fresh context, instead of assembling a handoff from many targeted extraction calls. The distillation is scored through the SAME quality scorer as the structured strategy and falls back to structured when it scores below the floor or the fresh call is unavailable — the receipt names the strategy used and any fallback. Standing instruction-chain / active-skill re-injection at the boundary applies to both strategies. Not the default: structured remains the default strategy until quality-score evidence earns distiller the default slot; choose it via behavior.compactionStrategy.",
    "domain": "behavior",
    "enablement": {
      "key": "behavior.compactionStrategy",
      "kind": "enum",
      "enabledValues": [
        "distiller"
      ]
    },
    "settings": [
      "behavior.compactionStrategy"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "fetch-sanitization",
    "name": "Fetch Response Sanitization",
    "description": "Enables fetch response sanitization and host trust tier classification. Sanitizes HTTP response content (none/safe-text/strict modes, default safe-text). Requests to private IPs, cloud metadata endpoints, and encoded private-IP forms are always refused with an honest tool-result reason. Fetches to localhost dev servers ask once and can be allowed per project (fetch.allowLocalhost). Set fetch.sanitizeMode to none to skip content sanitization for trusted flows.",
    "domain": "fetch",
    "enablement": {
      "key": "fetch.sanitizeMode",
      "kind": "constant"
    },
    "settings": [
      "fetch.sanitizeMode",
      "fetch.trustedHosts",
      "fetch.blockedHosts",
      "fetch.allowLocalhost"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "runtime-tools-budget-enforcement",
    "name": "Runtime Budget Enforcement",
    "description": "Enables per-phase runtime budget enforcement for tool execution pipelines. Checks wall-clock time (BUDGET_EXCEEDED_MS), token consumption (BUDGET_EXCEEDED_TOKENS), and cost (BUDGET_EXCEEDED_COST) limits at phase entry and exit. Terminates the pipeline immediately on hard budget breach and emits a typed diagnostic event. Disable to revert to unlimited execution.",
    "domain": "runtime",
    "enablement": {
      "key": "runtime.toolBudget.enforced",
      "kind": "boolean"
    },
    "settings": [
      "runtime.toolBudget.enforced",
      "runtime.toolBudget.maxMs",
      "runtime.toolBudget.maxTokens",
      "runtime.toolBudget.maxCostUsd"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "overflow-spill-backends",
    "name": "Overflow Spill Backends",
    "description": "Enables the pluggable spill backend system for overflow content. When enabled, spillBackend can be set to file|ledger|diagnostics via config. When disabled, overflow content uses the file spill backend.",
    "domain": "tools",
    "enablement": {
      "key": "tools.overflowSpillBackend",
      "kind": "enum",
      "enabledValues": [
        "ledger",
        "diagnostics"
      ]
    },
    "settings": [
      "tools.overflowSpillBackend"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "permission-divergence-dashboard",
    "name": "Divergence Dashboard and Enforce Gate",
    "description": "Enables the divergence dashboard and enforcement gate for permissions simulation. Aggregates divergence by tool/prefix/mode, exposes trend history in diagnostics, and blocks enforce mode transitions when the divergence rate exceeds the configured threshold. Disable to fall back to warn mode (no gate enforcement).",
    "domain": "permissions",
    "enablement": {
      "key": "permissions.divergenceDashboard",
      "kind": "boolean"
    },
    "settings": [
      "permissions.divergenceDashboard",
      "permissions.divergenceThreshold",
      "permissions.maxDivergenceRecords"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "shell-ast-normalization",
    "name": "Shell AST Normalization",
    "description": "Enables the Shell AST parser for compound command verdict evaluation. Produces per-segment verdicts (safe/unsafe) with user-facing denial explanations that are strictly more specific than the baseline. Default-on: the AST path is safe to default because a parser failure falls back automatically to the baseline flat segmentation matcher (never a hard error, never a blanket allow), and the frozen catastrophic block is enforced identically in both modes. Disable at runtime to force the baseline flat segmentation mode for every command.",
    "domain": "permissions",
    "enablement": {
      "key": "permissions.commandParser",
      "kind": "enum",
      "enabledValues": [
        "ast"
      ]
    },
    "settings": [
      "permissions.commandParser"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "local-provider-context-ingestion",
    "name": "Local Provider Context Window Ingestion",
    "description": "Enables dynamic ingestion of max_context_length from local/custom provider /v1/models endpoints. When enabled, local models use the provider-reported context window (provenance: provider_api) for token budgeting and compaction thresholds instead of the statically-configured contextWindow value. Disable to revert to explicit configured or static limits (configured_cap / fallback).",
    "domain": "provider",
    "enablement": {
      "key": "provider.localContextIngestion",
      "kind": "boolean"
    },
    "settings": [
      "provider.localContextIngestion"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "agent-context-window-awareness",
    "name": "Agent Context Window Awareness",
    "description": "Enables context window validation and compaction in the AgentOrchestrator. Before each provider.chat() call, estimates total token count (system prompt + messages + tool definitions) and compacts the conversation when usage exceeds 85% of the model context window. Also applies layered system prompt assembly (drops conventions then project context for small windows) and catches \"context size exceeded\" errors from the provider with a single compaction retry. Disable to revert to unchecked provider.chat() calls.",
    "domain": "agents",
    "enablement": {
      "key": "agents.contextWindowGuard",
      "kind": "boolean"
    },
    "settings": [
      "agents.contextWindowGuard",
      "agents.contextCompactThreshold"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "agent-passive-knowledge-injection",
    "name": "Agent Passive Knowledge Injection",
    "description": "Enables per-turn re-retrieval of project-memory knowledge against the EVOLVING main-session conversation (steers, new sub-topics), not just the frozen spawn-time task. Re-runs retrieval only when a new user/steer message arrived this turn, applies a relevance floor to filter filler, and holds the injected block to a hard token budget (min ~800 tokens or 3% of the model context window) with a visible per-turn record (candidates considered, ids injected, ids dropped for budget, token cost, embeddings backend) stored on AgentRecord.turnInjections and the session transcript. Default-on is safe specifically because the block is hard-budgeted and every turn is honestly recorded, never silently eating context. Disable or set the budget to 0 to revert to spawn-time-only injection (base system prompt byte-identical).",
    "domain": "agents",
    "enablement": {
      "key": "agents.passiveInjection.knowledge",
      "kind": "boolean"
    },
    "settings": [
      "agents.passiveInjection.knowledge",
      "agents.passiveInjection.budgetTokens",
      "agents.passiveInjection.relevanceFloor"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "agent-passive-code-injection",
    "name": "Agent Passive Code Injection",
    "description": "Enables per-turn passive retrieval from the repo SOURCE-TREE CODE INDEX (CodeIndexStore) alongside project-memory knowledge, sharing the SAME token budget and relevance floor. When the query would benefit and the index is built, similarity-ranked code chunks are injected as untrusted reference pointers, each recorded on the turn injection record with source=code-index and its honest match label (semantic/lexical). Never injects from an empty or provider-mismatched index, or from a hashed-only (no real semantic) provider — the store exposes each of those and the turn record states which. DEFAULT OFF (unlike agent-passive-knowledge-injection, which defaults on): code injection is a newer, higher-variance signal than reviewed project memory — code chunks carry no review/trust provenance and a weak similarity match can pull in a plausibly-worded but wrong chunk — so this first landing is opt-in, earned on by the same hard-budget + honest-record discipline before it becomes a default. Also respects the embedder’s storage.codeIndexEnabled setting; disable either to revert to memory-only injection.",
    "domain": "agents",
    "enablement": {
      "key": "agents.passiveInjection.code",
      "kind": "boolean"
    },
    "settings": [
      "agents.passiveInjection.code",
      "agents.passiveInjection.codeLimit",
      "agents.passiveInjection.budgetTokens",
      "agents.passiveInjection.relevanceFloor"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "output-schema-fingerprint",
    "name": "Output Schema Fingerprints",
    "description": "Appends `_meta.outputSchemaFingerprint` (SHA-256 of sorted result key names) and `_meta.schemaShapeId` (canonical mode identifier) to tool results from the find, analyze, and inspect tools. Enables schema drift detection and diagnostic fingerprint surfaces. Disable to omit fingerprint metadata.",
    "domain": "tools",
    "enablement": {
      "key": "tools.outputSchemaFingerprints",
      "kind": "boolean"
    },
    "settings": [
      "tools.outputSchemaFingerprints"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "policy-as-code",
    "name": "Policy-as-Code",
    "description": "Enables the versioned policy bundle registry with promote/rollback semantics. Requires simulation evidence (divergence gate passing) before enforcement. Exposes /policy load, /policy simulate, /policy diff, /policy promote, and /policy rollback commands. Divergence trends visible by command class/prefix via the diagnostics panel.",
    "domain": "policy",
    "enablement": {
      "key": "policy.registryEnabled",
      "kind": "boolean"
    },
    "settings": [
      "policy.registryEnabled",
      "policy.bundleSource",
      "policy.bundlePath"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "adaptive-execution-planner",
    "name": "Adaptive Execution Planner",
    "description": "Enables the Adaptive Execution Planner, which scores strategy candidates (single/cohort/background/remote) using risk, latency, and capability inputs and selects the best execution strategy each turn. Exposes /plan mode, /plan explain, and /plan override commands. Disable to revert to implicit single-call execution.",
    "domain": "planner",
    "enablement": {
      "key": "planner.adaptive",
      "kind": "boolean"
    },
    "settings": [
      "planner.adaptive"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "provider-optimizer",
    "name": "Provider Optimizer",
    "description": "Enables the capability-contract-driven provider routing optimizer. In auto mode, selects the best capable provider for each request profile using ProviderCapabilityRegistry contracts. Supports manual, auto, and pinned routing modes with deterministic, fully-explainable route decisions. Exposes /provider route, /provider explain-route, /provider pin, and /provider fallback test commands.",
    "domain": "provider",
    "enablement": {
      "key": "provider.optimizerMode",
      "kind": "enum",
      "enabledValues": [
        "manual",
        "auto",
        "pinned"
      ]
    },
    "settings": [
      "provider.optimizerMode",
      "provider.optimizerPinnedModel"
    ],
    "restartRequired": false,
    "defaultEnabled": false
  },
  {
    "id": "integration-delivery-slo",
    "name": "Integration Delivery SLO",
    "description": "Enforces delivery service-level objectives for the enabled channel surfaces (Slack, Discord, webhooks): failures are classified as retryable or terminal, retried with exponential backoff, and dead-letter events are logged at error level and surfaced in integration diagnostics. Dead-letter entries are exposed via /notify dlq and replayable via /notify replay. Enabled by default alongside the channel family it belongs to; disable to keep warn-level logging without DLQ tracking.",
    "domain": "integrations",
    "enablement": {
      "key": "integrations.delivery.sloEnforced",
      "kind": "boolean"
    },
    "settings": [
      "integrations.delivery.sloEnforced",
      "integrations.delivery.maxRetries",
      "integrations.delivery.initialDelayMs",
      "integrations.delivery.maxDelayMs",
      "integrations.delivery.maxDlqSize"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "adaptive-notification-suppression",
    "name": "Adaptive Notification Suppression",
    "description": "Enables mode-context and burst-detection policies in the NotificationRouter. In quiet/minimal mode, operational churn is suppressed before reaching the conversation or status bar. Burst detection collapses rapid domain:level floods into panel_only with a burst_collapsed reason code. On by default now that collapsed groups have a visible home: the notifications panel renders burst-collapsed groups with their reason codes. Disable to revert to base default + quiet-typing + batch-window policies only.",
    "domain": "notifications",
    "enablement": {
      "key": "notifications.adaptiveSuppression",
      "kind": "boolean"
    },
    "settings": [
      "notifications.adaptiveSuppression",
      "notifications.burstWindowMs",
      "notifications.burstThreshold",
      "notifications.burstCooldownMs"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "token-scope-rotation-audit",
    "name": "Token Scope and Rotation Audit",
    "description": "Enables minimum scope principle checks and rotation cadence audits for API tokens. In managed mode, tokens with excess scopes or overdue rotation are blocked from use. Diagnostics panel surfaces token age, scope violations, and rotation warnings. Emits TOKEN_SCOPE_VIOLATION, TOKEN_ROTATION_WARNING, TOKEN_ROTATION_EXPIRED, and TOKEN_BLOCKED events via the security event domain. On by default in advisory mode (security.tokenAudit.managed false): tokens are reported, never blocked, until managed enforcement is opted into.",
    "domain": "security",
    "enablement": {
      "key": "security.tokenAudit.enabled",
      "kind": "boolean"
    },
    "settings": [
      "security.tokenAudit.enabled",
      "security.tokenAudit.rotationCadenceDays",
      "security.tokenAudit.rotationWarningDays",
      "security.tokenAudit.managed"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "tool-contract-verification",
    "name": "Tool Contract Verification",
    "description": "Enables registration-time contract checks for all registered tools. Validates schema validity, timeout/cancellation semantics, permission class mapping, output policy alignment, and idempotency declarations. Invalid tools fail closed with actionable diagnostics. Exposes /tool verify <name>, /tool verify-all, and /tool contract show <name> commands.",
    "domain": "tools",
    "enablement": {
      "key": "tools.contractVerification",
      "kind": "boolean"
    },
    "settings": [
      "tools.contractVerification"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "automation-domain",
    "name": "Automation Domain",
    "description": "Enables the first-class automation job/run domain used by the shared scheduling engine. This is the top-level switch for durable automation records, schedule evaluation, and run history. On by default: with no routines defined it idles and surfaces a how-to-create-your-first-routine empty state instead of requiring setup.",
    "domain": "automation",
    "enablement": {
      "key": "automation.enabled",
      "kind": "boolean"
    },
    "settings": [
      "automation.enabled",
      "automation.maxConcurrentRuns",
      "automation.runHistoryLimit",
      "automation.defaultTimeoutMs",
      "automation.catchUpWindowMinutes",
      "automation.failureCooldownMs",
      "automation.deleteAfterRun"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "control-plane-gateway",
    "name": "Control-Plane Gateway",
    "description": "Enables the shared gateway/control-plane host that serves state snapshots, live streams, and authenticated automation control APIs to terminal hosts and remote clients.",
    "domain": "controlPlane",
    "enablement": {
      "key": "controlPlane.gateway",
      "kind": "boolean"
    },
    "settings": [
      "controlPlane.gateway",
      "controlPlane.enabled",
      "controlPlane.hostMode",
      "controlPlane.host",
      "controlPlane.port",
      "controlPlane.baseUrl",
      "controlPlane.streamMode",
      "controlPlane.allowRemote",
      "controlPlane.trustProxy",
      "controlPlane.openaiCompatible.enabled",
      "controlPlane.openaiCompatible.pathPrefix",
      "controlPlane.webui.serve",
      "controlPlane.webui.bundleDir",
      "controlPlane.cors.enabled",
      "controlPlane.cors.allowedOrigins",
      "controlPlane.tls.mode",
      "controlPlane.tls.certFile",
      "controlPlane.tls.keyFile"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "route-binding",
    "name": "Route Binding",
    "description": "Enables durable binding and resolution of external conversation routes, thread contexts, and reply targets across surfaces.",
    "domain": "integrations",
    "enablement": {
      "key": "integrations.routeBinding",
      "kind": "boolean"
    },
    "settings": [
      "integrations.routeBinding"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "delivery-engine",
    "name": "Delivery Engine",
    "description": "Enables first-class delivery tracking for automation results, retries, dead letters, and surface-specific delivery outcomes.",
    "domain": "integrations",
    "enablement": {
      "key": "integrations.deliveryTracking",
      "kind": "boolean"
    },
    "settings": [
      "integrations.deliveryTracking"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "slack-surface",
    "name": "Slack Surface",
    "description": "Enables the Slack client adapter for interactive command ingress, threaded replies, and notification delivery. Inbound messages are gated by the per-surface owner allowlist (seeded from the first identified sender; unknown senders are ignored).",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.slack.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.slack.enabled",
      "surfaces.slack.signingSecret",
      "surfaces.slack.botToken",
      "surfaces.slack.appToken",
      "surfaces.slack.defaultChannel",
      "surfaces.slack.workspaceId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "discord-surface",
    "name": "Discord Surface",
    "description": "Enables the Discord client adapter for interaction handling, message replies, and notification delivery. Inbound messages are gated by the per-surface owner allowlist (seeded from the first identified sender; unknown senders are ignored).",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.discord.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.discord.enabled",
      "surfaces.discord.publicKey",
      "surfaces.discord.botToken",
      "surfaces.discord.applicationId",
      "surfaces.discord.defaultChannelId",
      "surfaces.discord.guildId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "ntfy-surface",
    "name": "ntfy Surface",
    "description": "Enables the ntfy notification surface for push-style delivery and deep links back into the control-plane UI. Inbound messages are gated by the per-surface owner allowlist when the sender carries an identity (unknown senders are ignored).",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.ntfy.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.ntfy.enabled",
      "surfaces.ntfy.baseUrl",
      "surfaces.ntfy.topic",
      "surfaces.ntfy.chatTopic",
      "surfaces.ntfy.agentTopic",
      "surfaces.ntfy.remoteTopic",
      "surfaces.ntfy.token",
      "surfaces.ntfy.defaultPriority"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "webhook-surface",
    "name": "Webhook Surface",
    "description": "Enables the generic webhook surface for machine-to-machine ingress and egress. Ingress requires the configured webhook verification; sender-identified messages are additionally gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.webhook.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.webhook.enabled",
      "surfaces.webhook.defaultTarget",
      "surfaces.webhook.timeoutMs",
      "surfaces.webhook.secret"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "homeassistant-surface",
    "name": "Home Assistant Surface",
    "description": "Enables the Home Assistant surface for daemon/device integration, Home Assistant event delivery, service-call tools, and Home Assistant-originated prompts. Inbound prompts are gated by the per-surface owner allowlist when the sender carries an identity (unknown senders are ignored).",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.homeassistant.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.homeassistant.enabled",
      "surfaces.homeassistant.instanceUrl",
      "surfaces.homeassistant.accessToken",
      "surfaces.homeassistant.webhookSecret",
      "surfaces.homeassistant.defaultConversationId",
      "surfaces.homeassistant.deviceId",
      "surfaces.homeassistant.deviceName",
      "surfaces.homeassistant.eventType",
      "surfaces.homeassistant.remoteSessionTtlMs"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "telegram-surface",
    "name": "Telegram Surface",
    "description": "Enables the Telegram client adapter for command ingress, threaded replies, and notification delivery. Activation needs surfaces.telegram.enabled plus bot credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.telegram.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.telegram.enabled",
      "surfaces.telegram.mode",
      "surfaces.telegram.botToken",
      "surfaces.telegram.botUsername",
      "surfaces.telegram.defaultChatId",
      "surfaces.telegram.webhookSecret"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "whatsapp-surface",
    "name": "WhatsApp Surface",
    "description": "Enables the WhatsApp client adapter for command ingress, interactive actions, and notification delivery. Activation needs surfaces.whatsapp.enabled plus API credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.whatsapp.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.whatsapp.enabled",
      "surfaces.whatsapp.provider",
      "surfaces.whatsapp.accessToken",
      "surfaces.whatsapp.phoneNumberId",
      "surfaces.whatsapp.businessAccountId",
      "surfaces.whatsapp.defaultRecipient",
      "surfaces.whatsapp.signingSecret",
      "surfaces.whatsapp.verifyToken"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "signal-surface",
    "name": "Signal Surface",
    "description": "Enables the Signal client adapter for command ingress and notification delivery. Activation needs surfaces.signal.enabled plus a linked signal-cli endpoint; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.signal.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.signal.enabled",
      "surfaces.signal.bridgeUrl",
      "surfaces.signal.account",
      "surfaces.signal.token",
      "surfaces.signal.defaultRecipient"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "msteams-surface",
    "name": "Microsoft Teams Surface",
    "description": "Enables the Microsoft Teams client adapter for command ingress, threaded replies, and notification delivery. Activation needs surfaces.msteams.enabled plus bot credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.msteams.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.msteams.enabled",
      "surfaces.msteams.appId",
      "surfaces.msteams.appPassword",
      "surfaces.msteams.botId",
      "surfaces.msteams.tenantId",
      "surfaces.msteams.serviceUrl",
      "surfaces.msteams.defaultChannelId",
      "surfaces.msteams.defaultConversationId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "matrix-surface",
    "name": "Matrix Surface",
    "description": "Enables the Matrix client adapter for command ingress, threaded replies, and notification delivery. Activation needs surfaces.matrix.enabled plus homeserver credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.matrix.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.matrix.enabled",
      "surfaces.matrix.homeserverUrl",
      "surfaces.matrix.userId",
      "surfaces.matrix.accessToken",
      "surfaces.matrix.defaultRoomId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "mattermost-surface",
    "name": "Mattermost Surface",
    "description": "Enables the Mattermost client adapter for command ingress, threaded replies, and notification delivery. Activation needs surfaces.mattermost.enabled plus server credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.mattermost.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.mattermost.enabled",
      "surfaces.mattermost.baseUrl",
      "surfaces.mattermost.botToken",
      "surfaces.mattermost.teamId",
      "surfaces.mattermost.defaultChannelId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "imessage-surface",
    "name": "iMessage Surface",
    "description": "Enables the iMessage client adapter for command ingress and notification delivery. Activation needs surfaces.imessage.enabled plus a bridge endpoint; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.imessage.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.imessage.enabled",
      "surfaces.imessage.bridgeUrl",
      "surfaces.imessage.account",
      "surfaces.imessage.token",
      "surfaces.imessage.defaultChatId"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "bluebubbles-surface",
    "name": "BlueBubbles Surface",
    "description": "Enables the BlueBubbles client adapter for iMessage command ingress and notification delivery via a BlueBubbles server. Activation needs surfaces.bluebubbles.enabled plus server credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.bluebubbles.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.bluebubbles.enabled",
      "surfaces.bluebubbles.serverUrl",
      "surfaces.bluebubbles.password",
      "surfaces.bluebubbles.account",
      "surfaces.bluebubbles.defaultChatGuid"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "google-chat-surface",
    "name": "Google Chat Surface",
    "description": "Enables the Google Chat client adapter for command ingress, threaded replies, and notification delivery. Activation needs surfaces.googleChat.enabled plus app credentials; inbound messages are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.googleChat.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.googleChat.enabled",
      "surfaces.googleChat.appId",
      "surfaces.googleChat.spaceId",
      "surfaces.googleChat.verificationToken",
      "surfaces.googleChat.webhookUrl"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "telephony-surface",
    "name": "Telephony Surface",
    "description": "Enables the telephony adapter for delivery-oriented voice/SMS notification egress and webhook ingress. Activation needs surfaces.telephony.enabled plus provider credentials; inbound events are gated by the per-surface owner allowlist.",
    "domain": "surfaces",
    "enablement": {
      "key": "surfaces.telephony.enabled",
      "kind": "constant"
    },
    "settings": [
      "surfaces.telephony.enabled",
      "surfaces.telephony.provider",
      "surfaces.telephony.mode",
      "surfaces.telephony.accountSid",
      "surfaces.telephony.authToken",
      "surfaces.telephony.fromNumber",
      "surfaces.telephony.bridgeUrl",
      "surfaces.telephony.token",
      "surfaces.telephony.defaultRecipient",
      "surfaces.telephony.voiceLanguage",
      "surfaces.telephony.webhookSecret"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "web-surface",
    "name": "Web Surface",
    "description": "Enables the browser-based operator surface backed by the shared control plane. On by default, bound to loopback (web.hostMode local, 127.0.0.1): a stock install serves the web surface on this machine only and announces its URL once at start. Widen deliberately via web.hostMode network/custom.",
    "domain": "web",
    "enablement": {
      "key": "web.enabled",
      "kind": "boolean"
    },
    "settings": [
      "web.enabled",
      "web.hostMode",
      "web.host",
      "web.port",
      "web.publicBaseUrl",
      "web.staticAssetsDir"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "watcher-framework",
    "name": "Watcher Framework",
    "description": "Enables managed watcher/listener services, checkpointing, and recovery semantics for long-running external sources. On by default: with no watchers configured the framework idles and consumes nothing.",
    "domain": "watchers",
    "enablement": {
      "key": "watchers.enabled",
      "kind": "boolean"
    },
    "settings": [
      "watchers.enabled",
      "watchers.pollIntervalMs",
      "watchers.heartbeatIntervalMs",
      "watchers.recoveryWindowMinutes"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "service-management",
    "name": "Service Management",
    "description": "Enables install/start/stop/status/autostart management for running Goodvibes as a durable host service. On by default: the management verbs become available, but nothing is installed or started until explicitly requested (service.autostart stays false).",
    "domain": "service",
    "enablement": {
      "key": "service.enabled",
      "kind": "boolean"
    },
    "settings": [
      "service.enabled",
      "service.autostart",
      "service.restartOnFailure",
      "service.platform",
      "service.serviceName",
      "service.logPath"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "daemon-auto-update",
    "name": "Daemon Auto-Update",
    "description": "The daemon checks for a new release hourly, downloads and checksum-verifies it, swaps binaries at a no-active-work moment (never mid-turn), keeps the previous binary for one-command rollback, and restarts via the service manager. On by default per the owner directive; update.auto turns it off, update.intervalMinutes tunes the cadence.",
    "domain": "update",
    "enablement": {
      "key": "update.auto",
      "kind": "boolean"
    },
    "settings": [
      "update.auto",
      "update.intervalMinutes",
      "update.releasesUrl"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "exec-sandbox",
    "name": "Per-Command Exec Sandbox",
    "description": "Enables the per-command OS-level exec boundary (bubblewrap on Linux): the workspace is writable, the rest of the filesystem read-only, /tmp isolated, and network disabled unless a command is on sandbox.egressAllowlist. When active, boundary-safe commands that would otherwise prompt can auto-allow, and commands needing host access (network, host-privilege escalation, package installs) surface as named escalation asks. The frozen catastrophic command block stays in force identically inside the boundary. On by default where the host probe passes (Linux with bubblewrap available); the first auto-allow announces once that commands now run contained and escalations will ask. When bubblewrap is absent (or on non-Linux hosts) the feature reports honestly unavailable and the exec path is byte-for-byte unchanged. Set sandbox.enabled false to revert to unsandboxed exec.",
    "domain": "sandbox",
    "enablement": {
      "key": "sandbox.enabled",
      "kind": "boolean"
    },
    "settings": [
      "sandbox.enabled",
      "sandbox.replIsolation",
      "sandbox.mcpIsolation",
      "sandbox.windowsMode",
      "sandbox.vmBackend",
      "sandbox.qemuBinary",
      "sandbox.qemuImagePath",
      "sandbox.qemuExecWrapper",
      "sandbox.qemuGuestHost",
      "sandbox.qemuGuestPort",
      "sandbox.qemuGuestUser",
      "sandbox.qemuWorkspacePath",
      "sandbox.qemuSessionMode",
      "sandbox.replJavaScriptCommand"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "sandbox-model-judgment",
    "name": "Sandbox Model-Judgment Tier",
    "description": "Enables an optional model-judgment pass on the residual sandbox ask-tail: when the per-command exec sandbox is active and a command still lands on ask (a boundary needing host access — network, host-privilege escalation), a provider call over the command, its sandbox plan, workspace context, and the policy reasons produces a PROPOSED verdict with stated reasons. The tier NEVER converts allow→deny and NEVER touches the frozen catastrophic-only exec block (rm -rf /, dd to devices, mkfs, fork bomb…); it can only ANNOTATE the human ask (\"model judgment: looks safe because… / flags risk because…\") or, ONLY when the operator opted into sandbox.judgment auto-approve, auto-approve a looks-safe verdict. A flags-risk verdict never auto-denies — it annotates the ask the human still decides; a judgment failure degrades to a plain ask. Every judgment leaves a receipt. On by default in annotate-only mode (sandbox.judgment annotate); auto-approval is a separate explicit opt-in (sandbox.judgment auto-approve).",
    "domain": "sandbox",
    "enablement": {
      "key": "sandbox.judgment",
      "kind": "enum",
      "enabledValues": [
        "annotate",
        "auto-approve"
      ]
    },
    "settings": [
      "sandbox.judgment"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  },
  {
    "id": "relay-connect",
    "name": "Outbound Zero-Knowledge Relay",
    "description": "Lets the daemon connect OUTBOUND to a self-hostable, zero-knowledge relay and register under an unguessable rendezvous id so surfaces can reach it from outside the LAN. An end-to-end channel (ECDH P-256 → HKDF → AES-256-GCM) terminates INSIDE the daemon before any application byte, so the relay operator only ever sees ciphertext plus connection metadata; the daemon is authenticated to surfaces by static-key pinning from the pairing payload. Relay, channel, and OAuth credentials at rest are encrypted under the random secrets keyfile (never host-derived identity). No connection is made without explicit configuration: the relay.enabled config switch and a configured relay.url still gate every connection — leave either unset to keep the daemon LAN-only.",
    "domain": "relay",
    "enablement": {
      "key": "relay.enabled",
      "kind": "boolean"
    },
    "settings": [
      "relay.enabled",
      "relay.url",
      "relay.rendezvousId",
      "relay.label",
      "relay.requireStepUpForMutations"
    ],
    "restartRequired": false,
    "defaultEnabled": true
  }
];

/** CONFIG_SCHEMA entries for every key referenced by FEATURE_SETTINGS_SNAPSHOT
 *  (enablement keys + owned settings keys) — a superset of
 *  config-schema.generated.ts's CONFIG_SCHEMA_SNAPSHOT for these specific
 *  keys, since several (permissions.engine, policy.requireSignedBundles,
 *  fetch.sanitizeMode, telemetry.otelMode, runtime.unifiedTasks, ...) postdate
 *  that pinned snapshot's SDK version. */
export const FEATURE_SCHEMA_ENTRIES: readonly ConfigSettingMeta[] = [
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
    "key": "permissions.simulation",
    "type": "boolean",
    "default": true,
    "description": "Run the candidate permission evaluator beside the active one, recording divergence without changing enforcement. Default on so divergence evidence accumulates before stricter enforcement is considered; it never blocks tool execution by itself. Restart to apply."
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
    "key": "policy.requireSignedBundles",
    "type": "boolean",
    "default": false,
    "description": "Validate HMAC-SHA256 signatures when policy bundles load: managed mode rejects bundles with invalid or missing signatures; non-managed mode permits unsigned bundles with a warning. Restart to apply. Default off until divergence evidence clears the governance gate."
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
    "key": "fetch.allowLocalhost",
    "type": "boolean",
    "default": false,
    "description": "Allow the fetch tool to reach localhost/loopback dev servers for this project (e.g. http://localhost:3000). Set by the one-tap \"allow for this project\" answer to the localhost fetch ask and persisted in the project settings, so it never re-asks. Private-IP and cloud-metadata endpoint blocking is unaffected and absolute."
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
    "key": "permissions.divergenceDashboard",
    "type": "boolean",
    "default": true,
    "description": "Aggregate permission-evaluator divergence by tool/prefix/mode, expose trend history in diagnostics, and block enforce-mode transitions while the divergence rate exceeds permissions.divergenceThreshold. Turn off to fall back to warn mode (no gate enforcement)."
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
    "key": "provider.localContextIngestion",
    "type": "boolean",
    "default": true,
    "description": "Ingest max_context_length from local/custom provider /v1/models endpoints so local models use the provider-reported context window for token budgeting and compaction thresholds. Turn off to use only explicitly configured or static limits."
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
    "key": "agents.passiveInjection.knowledge",
    "type": "boolean",
    "default": true,
    "description": "Re-retrieve project-memory knowledge each turn against the evolving conversation (steers, new sub-topics), under the hard token budget with a visible per-turn injection record on the agent record and session transcript. Default on: the block is hard-budgeted and every turn is honestly recorded. Turn off to revert to spawn-time-only injection."
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
    "key": "agents.passiveInjection.code",
    "type": "boolean",
    "default": false,
    "description": "Additionally inject similarity-ranked chunks from the repo source-code index each turn as untrusted reference pointers, sharing the knowledge-injection budget and relevance floor, each with an honest match label on the turn record. Default off: code chunks carry no review provenance, so this is deliberately opt-in. Also respects storage.codeIndexEnabled."
  },
  {
    "key": "agents.passiveInjection.codeLimit",
    "type": "number",
    "default": 3,
    "description": "Maximum number of source-code chunks injected per turn by passive code injection (chunks share the passive-injection token budget and relevance floor).",
    "validationHint": "integer in [0, 100]"
  },
  {
    "key": "tools.outputSchemaFingerprints",
    "type": "boolean",
    "default": false,
    "description": "Append _meta.outputSchemaFingerprint (SHA-256 of sorted result key names) and _meta.schemaShapeId to results from the find, analyze, and inspect tools, enabling schema drift detection. Default off."
  },
  {
    "key": "policy.registryEnabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the versioned policy bundle registry with promote/rollback semantics and the /policy load, simulate, diff, promote, and rollback commands. Enforcement requires passing divergence-gate evidence first; default off until that evidence exists."
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
    "key": "planner.adaptive",
    "type": "boolean",
    "default": false,
    "description": "Score execution-strategy candidates (single/cohort/background/remote) on risk, latency, and capability inputs each turn and select the best one, with /plan mode, explain, and override commands. Default off until the routing-visibility UX lands; off means implicit single-call execution."
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
    "key": "integrations.delivery.sloEnforced",
    "type": "boolean",
    "default": true,
    "description": "Enforce delivery service-level objectives for channel integrations: failures are classified retryable/terminal, retried with exponential backoff, and dead-letter events are logged at error level and surfaced in integration diagnostics (replayable via /notify replay). When false, dead letters are warn-level only. An explicit per-queue sloEnforced option still overrides this default."
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
    "key": "tools.contractVerification",
    "type": "boolean",
    "default": true,
    "description": "Run registration-time contract checks on every registered tool: schema validity, timeout/cancellation semantics, permission-class mapping, output-policy alignment, and idempotency declarations. Invalid tools fail closed with actionable diagnostics. Turn off to let tools register unchecked."
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
    "key": "controlPlane.gateway",
    "type": "boolean",
    "default": true,
    "description": "The shared gateway/control-plane host serving state snapshots, live streams (SSE/WS), and authenticated control APIs to terminal hosts and remote clients. Default on so a stock daemon can stream companion chat; every streaming endpoint stays auth-gated and the default bind stays loopback. Turn off for a request/response-only daemon."
  },
  {
    "key": "controlPlane.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the standalone control-plane HTTP server"
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
    "key": "surfaces.telegram.botToken",
    "type": "string",
    "default": "",
    "description": "Telegram bot token used for bot setup and delivery"
  },
  {
    "key": "surfaces.telegram.botUsername",
    "type": "string",
    "default": "",
    "description": "Telegram bot username used for targeting and setup hints"
  },
  {
    "key": "surfaces.telegram.defaultChatId",
    "type": "string",
    "default": "",
    "description": "Default Telegram chat, group, or channel id for delivery"
  },
  {
    "key": "surfaces.telegram.webhookSecret",
    "type": "string",
    "default": "",
    "description": "Telegram webhook secret token used to verify inbound callbacks"
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
    "key": "surfaces.whatsapp.signingSecret",
    "type": "string",
    "default": "",
    "description": "WhatsApp inbound signing secret or bridge bearer token"
  },
  {
    "key": "surfaces.whatsapp.verifyToken",
    "type": "string",
    "default": "",
    "description": "WhatsApp webhook verify token or shared secret"
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
    "key": "surfaces.msteams.botId",
    "type": "string",
    "default": "",
    "description": "Microsoft Teams bot id used in conversation references"
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
    "key": "surfaces.msteams.defaultChannelId",
    "type": "string",
    "default": "",
    "description": "Default Teams channel id for routing"
  },
  {
    "key": "surfaces.msteams.defaultConversationId",
    "type": "string",
    "default": "",
    "description": "Default Teams conversation id for routing"
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
    "key": "surfaces.matrix.userId",
    "type": "string",
    "default": "",
    "description": "Matrix user id (@user:server) the adapter acts as"
  },
  {
    "key": "surfaces.matrix.accessToken",
    "type": "string",
    "default": "",
    "description": "Matrix account access token"
  },
  {
    "key": "surfaces.matrix.defaultRoomId",
    "type": "string",
    "default": "",
    "description": "Default Matrix room id for routing"
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
    "key": "surfaces.googleChat.enabled",
    "type": "boolean",
    "default": false,
    "description": "Enable the Google Chat surface contract"
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
    "key": "surfaces.googleChat.verificationToken",
    "type": "string",
    "default": "",
    "description": "Google Chat verification token or shared secret"
  },
  {
    "key": "surfaces.googleChat.webhookUrl",
    "type": "string",
    "default": "",
    "description": "Google Chat outbound webhook or app callback URL"
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
    "key": "surfaces.telephony.defaultRecipient",
    "type": "string",
    "default": "",
    "description": "Default telephony recipient phone number for routing"
  },
  {
    "key": "surfaces.telephony.voiceLanguage",
    "type": "string",
    "default": "en-US",
    "description": "BCP-47 language code for provider-direct voice call text-to-speech"
  },
  {
    "key": "surfaces.telephony.webhookSecret",
    "type": "string",
    "default": "",
    "description": "Shared secret used to verify inbound telephony callbacks"
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
    "key": "sandbox.enabled",
    "type": "boolean",
    "default": true,
    "description": "Master switch for the per-command exec sandbox (bubblewrap on Linux): the workspace is writable, the rest of the filesystem is read-only, /tmp is isolated, and network is disabled unless a command is on sandbox.egressAllowlist. Default ON where the host probe passes; honestly reported unavailable when bubblewrap is not present, leaving the exec path unchanged."
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
    "enumValues": [
      "attach",
      "launch-per-command"
    ],
    "default": "attach",
    "description": "Whether the QEMU wrapper attaches to an already running guest or launches a guest per command"
  },
  {
    "key": "sandbox.replJavaScriptCommand",
    "type": "string",
    "default": "bun",
    "description": "Guest command used for JavaScript-family REPL runtimes inside QEMU, including JavaScript, TypeScript, SQL, and GraphQL"
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
  }
];
