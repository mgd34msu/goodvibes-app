// Store scope for the Knowledge view (docs/FEATURES.md §6 "Agent-scoped
// knowledge"): the operator store is the daemon's shared knowledge base;
// the agent store is the isolated per-agent store behind the
// /api/goodvibes-agent/knowledge/* routes, which MAY be absent on this
// daemon — availability is probed at runtime, never assumed.

export type KnowledgeScope = "operator" | "agent";

export const AGENT_KNOWLEDGE_BASE = "/api/goodvibes-agent/knowledge";

export function agentKnowledgePath(suffix: string): string {
  return `${AGENT_KNOWLEDGE_BASE}${suffix}`;
}
