# App-side request: companion-chat turn cancel verb

For the SDK/daemon session designing the server-side stop verb. Everything below is
extracted from goodvibes-app's real consuming code (file:line cited), not from memory.
Closes docs/GAPS.md §1 row 39 (the app's last wire-blocked partial) once served.

## 1. Method id + shape the app wants to call

**Preferred id: `companion.chat.turns.cancel`** — the app's route table groups companion
chat under `companion.chat.*` (`companion.chat.messages.create`,
`companion.chat.events.stream` — see `src/ui/lib/gv.ts:189`), and the `sessions.*`
namespace carries operator-session semantics that companion turns deliberately don't
share (see §4 dead-end). `chat.turns.cancel` also works; just keep it OUT of
`sessions.inputs.*`.

Input:
```json
{ "sessionId": "<companion session id>", "turnId": "<optional guard>" }
```
- `sessionId`-scoped: cancels THE active turn for that session. This must work with no
  `turnId`, because a client can want to stop before the `turn.started` event (which is
  what delivers `turnId`, `useChatStream.ts:146`) has reached it.
- `turnId` optional guard: if provided and it is NOT the active turn, refuse (409) rather
  than cancel a newer turn — protects a stale stop click racing a fresh send.

Response (success):
```json
{ "cancelled": true, "turnId": "...", "partialPersisted": true }
```

Refusal semantics the app will code against (machine-readable `error.code` strings,
please — the app matches codes, not message text):
- No turn in flight → **404 `NO_ACTIVE_TURN`** — treated as benign ("finished naturally
  before the stop landed"), rendered quietly, never as a scary error.
- `turnId` guard mismatch → **409 `TURN_MISMATCH`**.
- Second cancel of the same turn → idempotent success (`{cancelled: true,
  alreadyCancelled: true}`) or the same benign 404 — either is fine, just don't 500.

## 2. Terminal SSE event shape the app's stream handler expects

The app consumes the existing per-session stream `companion.chat.events.stream`
(`useChatStream.ts:125`). Envelope contract it already parses
(`message-utils.ts:97` `companionEventType`): SSE event name `message` or
`companion-chat.*`, with the specific type in `payload.type` (falling back to the event
name with the `companion-chat.` prefix stripped). Dispatch is on that type
(`useChatStream.ts:147-215`): `turn.started`, `turn.delta`, `turn.tool_call`,
`turn.tool_result`, `turn.completed`, `turn.error`.

So the new terminal event is simply:
```
payload.type = "turn.cancelled"
```
with payload fields the app will read:
- `sessionId` — client-side filter (`useChatStream.ts:142`).
- `turnId`.
- The partial assistant content **under the same keys `turn.completed` uses**, so the
  cancelled partial renders through the existing code path
  (`assistantContentFromCompletedTurn`, reads `body|content|text|message` at top level
  or under `envelope`; message id from `assistantMessageId|messageId`).
- Real token usage if available, same locations `usageFromPayload` probes
  (`usage`, `envelope.usage`, `envelope.metadata.usage`, `metadata.usage`) — billing
  honesty for a turn that burned provider tokens before stopping.
- A reason marker, e.g. `stoppedBy: "user"`.

**Terminal semantics are the critical part for multi-client convergence**: the app
treats STREAM_END as NON-terminal by design — its SSE layer reconnects forever and
shows "reconnecting" (`useChatStream.ts:1-9` header comment). Only
`turn.completed`/`turn.error` (and now `turn.cancelled`) end a turn. Without the event,
a cancel issued from client A leaves client B spinning in `streaming` state forever.
Emit it to every subscriber of the session's stream, including the client that called
cancel.

## 3. Persistence of the partial

The app refetches message history after terminal events (`invalidateChatState`). The
persisted partial assistant message MUST carry an explicit stopped marker or it will
read as a complete reply — dishonest transcript. The app reads
`deliveryState` via `firstString(message, ["deliveryState"])` (`message-utils.ts:163`);
a distinct value (e.g. `"cancelled"`) or a `metadata.stoppedByUser: true` both work —
name it and the app will badge it.

## 4. Edge cases hit while probing (daemon v1.3.3, live)

- **The `sessions.inputs.list` dead end (the reason this verb must exist):** a
  companion-chat session IS visible through the operator union — `sessions.get` on its
  id succeeds with `kind: "companion-chat"`. But driving a real send through
  `companion.chat.messages.create` and polling `sessions.inputs.list` on that same id
  every 400 ms for the full duration of the turn never surfaced an entry: `inputs`
  stayed `[]`, `pendingInputCount` stayed `0`, while the reply streamed and landed. The
  operator inputs read model never observes companion turns, so `sessions.inputs.cancel`
  has nothing to target. Full probe notes in `useChatStream.ts:52-66`.
- **Cancel racing natural completion** → the benign 404 above.
- **Cancel mid-tool-call:** the abort signal is checked between chunks — spec what
  happens to an in-flight tool execution (aborted vs allowed to finish), and make the
  transcript reflect which. The app renders tool blocks live (`turn.tool_call` /
  `turn.tool_result`); a tool block left dangling forever would look wedged, so either
  emit its `turn.tool_result` (with `isError` or a cancelled marker) before
  `turn.cancelled`, or document that `turn.cancelled` implicitly closes open tool blocks
  (the app can close them client-side on the terminal event if told to).
- **Very-early cancel** (before `turn.started` is broadcast): sessionId-only cancel must
  still find the turn.

## 5. App-side commitment once the verb ships

The app's `stop()` inverts its current behavior: call the cancel method FIRST and keep
the stream OPEN to await `turn.cancelled` (today it disconnects and marks locally —
`useChatStream.ts:93-105`). `isMethodUnavailableError` on older daemons falls back to
the current honest local-render stop. GAPS §1 row 39 flips to SHIPPED with the daemon
version noted.

Landed: daemon 1.11.0 serves companion.chat.turns.cancel + companion.chat.messages.steer
to this spec (2026-07-07).
