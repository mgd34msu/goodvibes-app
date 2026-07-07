// Defensive readers over companion-chat wire messages + the turn state
// machine vocabulary. Ported from goodvibes-webui src/views/chat/
// message-utils.ts, extended with usage extraction for the context meter.

import { asRecord, bestId, firstArray, firstNumber, firstString, formatRelative, readPath } from "../../lib/wire.ts";
import type { TurnUsage } from "./types.ts";

export function messageText(message: unknown): string {
  const direct = firstString(message, ["content", "body", "text", "message", "delta"]);
  if (direct) return direct;
  const parts = firstArray(message, ["parts", "content"]);
  return parts
    .map((part) => firstString(part, ["text", "content", "body"]))
    .filter(Boolean)
    .join("\n");
}

export function messageAttachments(message: unknown): unknown[] {
  const record = asRecord(message);
  if (Array.isArray(record["attachments"])) return record["attachments"];
  if (Array.isArray(record["artifacts"])) return record["artifacts"];
  return [];
}

export function attachmentLabel(attachment: unknown): string {
  return firstString(attachment, ["label", "filename", "name", "artifactId", "id"]) || "Attachment";
}

export function attachmentArtifactId(attachment: unknown): string {
  return firstString(attachment, ["artifactId", "id"]);
}

export function attachmentMeta(attachment: unknown): string {
  const record = asRecord(attachment);
  const mimeType = firstString(attachment, ["mimeType", "type"]);
  const sizeBytes = Number(record["sizeBytes"] ?? record["size"]);
  const size =
    Number.isFinite(sizeBytes) && sizeBytes > 0
      ? sizeBytes > 1024 * 1024
        ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
        : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
      : "";
  return [mimeType, size].filter(Boolean).join(" · ");
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      resolve(value.includes(",") ? (value.split(",").pop() ?? "") : value);
    };
    reader.readAsDataURL(file);
  });
}

export function uploadedArtifactId(uploaded: unknown): string {
  return firstString(asRecord(uploaded)["artifact"], ["id", "artifactId"]) || firstString(uploaded, ["artifactId", "id"]);
}

export function roleOf(message: unknown): string {
  return firstString(message, ["role", "author", "kind", "source"]) || "message";
}

export function messageTone(message: unknown): string {
  const role = roleOf(message).toLowerCase();
  if (role.includes("user")) return "user";
  if (role.includes("assistant") || role.includes("agent") || role.includes("model")) return "assistant";
  if (role.includes("system")) return "system";
  return "neutral";
}

export function messageTimestamp(message: unknown): string {
  const record = asRecord(message);
  return formatRelative(record["createdAt"] ?? record["timestamp"] ?? record["time"]);
}

export function messageCreatedAt(message: unknown): number {
  const record = asRecord(message);
  for (const key of ["createdAt", "timestamp", "time"]) {
    const value = record[key];
    if (typeof value === "number") return value;
  }
  return 0;
}

export function assistantContentFromCompletedTurn(payload: unknown, fallback: string): string {
  const envelope = asRecord(asRecord(payload)["envelope"]);
  return (
    firstString(envelope, ["body", "content", "text", "message"]) ||
    firstString(payload, ["body", "content", "text", "message", "response"]) ||
    fallback
  );
}

export function companionEventType(eventName: string, payload: unknown): string {
  return firstString(payload, ["type"]) || eventName.replace(/^companion-chat\./, "");
}

/** Wire-reported token usage on a completed turn, when the daemon sends any.
 * Read from every plausible location; undefined when nothing is reported —
 * the context meter then stays honest-hidden instead of showing estimates. */
export function usageFromPayload(payload: unknown): TurnUsage | undefined {
  const candidates = [
    readPath(payload, ["usage"]),
    readPath(payload, ["envelope", "usage"]),
    readPath(payload, ["envelope", "metadata", "usage"]),
    readPath(payload, ["metadata", "usage"]),
  ];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    if (!Object.keys(record).length) continue;
    const usage: TurnUsage = {};
    const input = firstNumber(record, ["inputTokens", "input_tokens", "promptTokens"]);
    const output = firstNumber(record, ["outputTokens", "output_tokens", "completionTokens"]);
    const cached = firstNumber(record, ["cachedTokens", "cacheReadTokens", "cache_read_input_tokens"]);
    const context = firstNumber(record, ["contextTokens", "totalTokens", "total_tokens"]);
    const max = firstNumber(record, ["maxContextTokens", "contextWindow", "maxTokens"]);
    if (input !== undefined) usage.inputTokens = input;
    if (output !== undefined) usage.outputTokens = output;
    if (cached !== undefined) usage.cachedTokens = cached;
    if (context !== undefined) usage.contextTokens = context;
    if (max !== undefined) usage.maxContextTokens = max;
    if (Object.keys(usage).length) return usage;
  }
  return undefined;
}

/**
 * States for which a turn is genuinely in flight (drives the streaming
 * indicator, the Stop control, and the 1s message-poll fallback).
 * 'reconnecting' / 'sending while reconnecting' are deliberate: an SSE drop
 * mid-turn means the live channel is down while the daemon keeps working —
 * STREAM_END is NOT terminal, only turn.completed/error (docs/UX.md §4).
 */
export const ACTIVE_TURN_STATES = [
  "sending",
  "submitted",
  "running",
  "streaming",
  "tooling",
  "reconnecting",
  "sending while reconnecting",
];

/**
 * Client-side auto-title from the first user message (there is deliberately
 * no server auto-title verb; this feeds companion.chat.sessions.update).
 */
export function deriveChatTitle(text: string, maxLength = 52): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";
  if (collapsed.length <= maxLength) return collapsed.replace(/[\s.,;:!?-]+$/, "");
  const clipped = collapsed.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const onWordBoundary = lastSpace > maxLength * 0.5 ? clipped.slice(0, lastSpace) : clipped;
  return `${onWordBoundary.replace(/[\s.,;:!?-]+$/, "")}…`;
}

export function deliveryState(message: unknown): "sent" | "failed" | "local" | "" {
  const state = firstString(message, ["deliveryState"]).toLowerCase();
  if (state.includes("fail") || state.includes("error")) return "failed";
  if (state.includes("local") || state.includes("pending")) return "local";
  if (state.includes("sent")) return "sent";
  if (messageTone(message) === "user") return "sent";
  return "";
}

/** Rough token estimate for the thinking strip — always labelled "~". */
export function estimateTokens(chars: number): number {
  return Math.max(0, Math.round(chars / 4));
}

export { bestId };
