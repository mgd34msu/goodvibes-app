// UI-layer message shape: a union of local optimistic messages and the
// server's CompanionChatMessage (plus whatever extra fields a newer daemon
// sends — the index signature admits them without `any`). Ported from
// goodvibes-webui src/views/chat/types.ts.

export interface ChatMessage {
  id?: string;
  messageId?: string;
  sessionId?: string;
  role?: string;
  author?: string;
  kind?: string;
  source?: string;
  content?: string;
  text?: string;
  body?: string;
  message?: string;
  delta?: string;
  parts?: readonly { text?: string; content?: string; body?: string; [key: string]: unknown }[];
  attachments?: readonly {
    artifactId?: string;
    id?: string;
    label?: string;
    filename?: string;
    name?: string;
    mimeType?: string;
    type?: string;
    sizeBytes?: number;
    size?: number;
    [key: string]: unknown;
  }[];
  artifacts?: readonly Record<string, unknown>[];
  deliveryState?: string;
  status?: string;
  state?: string;
  createdAt?: number;
  timestamp?: number;
  time?: number;
  supersededAt?: number | string;
  supersededReason?: string;
  revisionOf?: string;
  [key: string]: unknown;
}

/** One tool invocation observed on the live turn stream. */
export interface ToolCallBlock {
  toolCallId: string;
  toolName: string;
  input: unknown;
  result?: unknown;
  /** running → the call was announced; completed/error → its result arrived. */
  status: "running" | "completed" | "error";
}

/** Live metrics for the in-flight (or just-finished) turn. */
export interface TurnMetrics {
  turnId: string;
  startedAt: number;
  /** Streamed delta characters so far (token count is estimated from this). */
  deltaChars: number;
  /** Wire-reported usage from the completed event, when the daemon sends it. */
  usage?: TurnUsage;
}

export interface TurnUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  contextTokens?: number;
  maxContextTokens?: number;
}
