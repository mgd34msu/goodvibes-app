// The honest-lineage view model for companion chat, ported from
// goodvibes-webui src/views/chat/lineage.ts. The daemon never deletes
// history: regenerate/edit mark messages SUPERSEDED (supersededAt +
// supersededReason, replacement user messages carry revisionOf) and RETAIN
// them in companion.chat.messages.list. This module folds a flat server list
// into active nodes with their retained runs attached, so nothing silently
// vanishes and the model survives reloads (derived purely from server truth).

import { asRecord, bestId, firstString } from "../../lib/wire.ts";
import { messageCreatedAt } from "./message-utils.ts";
import type { ChatMessage } from "./types.ts";

export type SupersededReason = "regenerate" | "edit" | "unknown";

export function isSuperseded(message: unknown): boolean {
  const value = asRecord(message)["supersededAt"];
  if (typeof value === "number") return value > 0;
  return typeof value === "string" && value.trim().length > 0;
}

export function supersededReason(message: unknown): SupersededReason {
  const raw = firstString(message, ["supersededReason"]).toLowerCase();
  if (raw === "regenerate") return "regenerate";
  if (raw === "edit") return "edit";
  return "unknown";
}

export function revisionOf(message: unknown): string {
  return firstString(message, ["revisionOf"]);
}

export interface LineageNode {
  readonly message: ChatMessage;
  /** Superseded messages retained behind the fork this node heads — oldest first. */
  readonly priorMessages: readonly ChatMessage[];
  readonly reason?: SupersededReason;
  readonly revisionOf?: string;
}

/**
 * Active messages become nodes in order; a contiguous superseded run is
 * attached to the next active node (the fork head). A trailing run with no
 * following active message is merged into the last node — or surfaced as its
 * own history-only node — so retained history is never dropped.
 */
export function buildLineage(messages: readonly ChatMessage[]): LineageNode[] {
  const nodes: LineageNode[] = [];
  let pending: ChatMessage[] = [];
  let pendingReason: SupersededReason | undefined;

  for (const message of messages) {
    if (isSuperseded(message)) {
      pending.push(message);
      const reason = supersededReason(message);
      if (reason !== "unknown") pendingReason = reason;
      continue;
    }
    nodes.push({
      message,
      priorMessages: pending,
      ...(pending.length ? { reason: pendingReason ?? "unknown" } : {}),
      ...(revisionOf(message) ? { revisionOf: revisionOf(message) } : {}),
    });
    pending = [];
    pendingReason = undefined;
  }

  if (pending.length) {
    const last = nodes.at(-1);
    if (last) {
      nodes[nodes.length - 1] = {
        ...last,
        priorMessages: [...last.priorMessages, ...pending],
        reason: last.reason ?? pendingReason ?? "unknown",
      };
    } else {
      const head = pending.at(-1);
      if (head) {
        nodes.push({
          message: head,
          priorMessages: pending.slice(0, -1),
          reason: pendingReason ?? "unknown",
        });
      }
    }
  }

  return nodes;
}

export function lineageNodeKey(node: LineageNode, index: number): string {
  return `${bestId(node.message) || index}-${index}`;
}

export function retainedHistoryLabel(reason: SupersededReason | undefined, count: number): string {
  const plural = count === 1 ? "" : "s";
  if (reason === "edit") return count <= 1 ? "Edited — view original" : `Edited — view ${count} retained message${plural}`;
  if (reason === "regenerate") {
    return count <= 1 ? "Regenerated — view previous response" : `Regenerated — view ${count} previous message${plural}`;
  }
  return `View ${count} retained message${plural}`;
}

export function sortByCreatedAt(messages: readonly ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => messageCreatedAt(left) - messageCreatedAt(right));
}
