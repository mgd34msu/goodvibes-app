# goodvibes-app: UX specification

UI/UX is the forefront criterion for every decision in this app. This document is the
contract every view is built against: duplicated status widgets that disagree with each
other, empty states indistinguishable from broken states, and silent data loss are the
class of failure every rule below exists to rule out.

## 1. Principles

1. **Zero friction.** First launch lands you in a working chat within seconds, with the
   daemon auto-detected or auto-spawned, the token auto-resolved from the shared store,
   and the model defaulted from existing TUI/agent settings when present. Onboarding
   asks questions only when no answer can be inferred, and never blocks surfaces that
   already work.
2. **Never lie, never lose work.** Every number has a label and a frame of reference.
   Every failure has a visible, specific error state distinct from "empty". Drafts
   survive daemon outages (gate overlays render *over* the still-mounted workspace, never
   remount it). Destructive actions get typed confirmations; closing the app never kills
   daemon-side work.
3. **Keyboard-first.** Command palette (Ctrl+K) reaches every action; `g`-chords navigate
   views; every shortcut shown in the UI comes from the single live keybinding registry,
   never a hardcoded hint string. Full focus-trap discipline in modals; ARIA labels on all
   icon buttons; reduced-motion honored.
4. **Observability ambient, not buried.** The status strip is always present (daemon
   three-axis health, latency, SSE state, active turns, live cost of the current
   session). Cost/token/health surfaces are one palette-jump away from anywhere.
5. **Progressive disclosure.** Pages are observability; modals are configuration (webui
   doctrine). Dense master/detail lists with a right peek panel for drill-in; fullscreen
   only for chat and genuinely immersive surfaces (model workspace, documents editor).

## 2. Information architecture

The left sidebar (collapsible to icon rail, 264px/60px) groups the app's 31 views into
six named groups, in binding order. Every view listed here is a distinct sidebar entry
with its own route:

| Group | View | What it is |
|---|---|---|
| Work | Chat | The primary companion-chat surface: streaming replies, tool-call blocks, attachments |
| Work | Sessions | The cross-surface session union, plus a "Hosted" tab for sessions this daemon actually runs |
| Work | Fleet | The live process tree for agents, workflows, watchers, schedules, and code-index runs |
| Work | Approvals | Human-in-the-loop approvals (whole and per-hunk) plus fire-and-forget tasks |
| Automate | Automation | Jobs, schedules, and their run history |
| Automate | Watchers | File- and event-triggered watchers that feed automation |
| Automate | Channels | Omnichannel inbox, accounts, actions, and delivery receipts |
| Know | Knowledge | The wiki, knowledge graph, ingestion pipeline, and project planning surfaces |
| Know | Memory | The canonical cross-surface record store, with review queues |
| Know | Artifacts | The durable file and object store, with inline preview |
| Know | Research | Web search, checkpointable research runs, and source triage |
| Know | Documents | Versioned drafts, review packets, and blind model comparison |
| Assistant | Home | Daily briefing, away-digest, and the coming-up rail |
| Assistant | Routines | Reusable step sequences, promotable to a daemon schedule |
| Assistant | Personas | Named operating profiles, importable from VIBE.md |
| Assistant | Skills | Importable skill bundles with readiness checks |
| Assistant | Personal Ops | Email, calendar, and the unified inbox |
| Assistant | Check-in | Proactive check-in configuration (cadence, channel, quiet hours) |
| Assistant | Dates | Important dates, gift interviews, and plans |
| Assistant | Payments | Cards, budget, checkout, and the purchase ledger |
| Code | Git | Workspace git status, log, stage, commit, branches, stash |
| Code | Diff | The unified diff viewer, working/staged/HEAD/arbitrary refs |
| Code | Worktrees | Worktree snapshot and list |
| Code | Checkpoints | Checkpoint create, list, diff, and restore |
| Code | CI Watches | CI status lookups and persistent watches |
| Code | Terminal | Embedded PTY terminal tabs |
| System | Observability | Telemetry, cost analytics, health, and daemon control snapshots |
| System | Providers & Models | Provider list, model catalog, and OAuth subscriptions |
| System | MCP | MCP server and tool management |
| System | Remote & Peers | Peer connections, pair requests, and the work queue |
| System | Settings | Schema-driven config, secrets, keybindings, devices, owner profile |

Layout:
- **Top bar**: view eyebrow + title, view-scoped actions, global search.
- **Bottom**: status strip (32px).
- **Right**: peek panel slide-over.
- **Overlay**: command palette.

Every view URL-addressable via internal route state (`?view=…&…`) so palette jumps,
notifications, and deep links compose.

## 3. Visual language

The token sheet lives in `src/ui/styles/tokens.css`, a dark-first neon-cyan operator
aesthetic shared with the wider GoodVibes UI family. The surface base is `#08080f` with
cyan-alpha borders and an accent that ranges `#00dede` to `#00ffff`; brand neon is
reserved for glow and accents, never large fills. The four status colors, each with a
`-soft` fill variant, carry their own fixed meaning:

| Status | Color | Meaning |
|---|---|---|
| Success | `#38ff8b` | Completed, healthy, reachable |
| Warning | `#ffcc66` | Degraded, needs attention, stale |
| Danger | `#ff6ac8` | Failed, unreachable, destructive-confirm |
| Info | `#8da2ff` | Neutral status, informational |

Light theme is the webui desaturated remap of the same tokens. Spacing runs on a 4px
scale; radii are 6/8/12/999; type is Inter and Space Mono, bundled locally with no
network fonts; motion runs 120/180/260ms; the z-index ladder is
nav10/peek40/overlay50/palette60/toast70.

Status semantics come from the **SDK presentation contract** (16 glyphs, 4 severity
buckets) via a generated `presentation-tokens.css` + bridge module, so states render
identically to TUI/agent/webui. Theme defaults to dark, with light opt-in, a compact
density toggle, and `prefers-reduced-motion` collapsing motion to 0.

## 4. Interaction patterns (binding rules)

- **Streaming chat**: deltas paint as they arrive; a thinking strip shows live token
  count; tool calls render as collapsible blocks with status glyphs; a visible turn state
  machine (queued → streaming → completed/error/cancelled). `STREAM_END` is not
  terminal. Only `TURN_COMPLETED/ERROR/CANCEL` are.
- **Optimistic sends** with `local/sent/failed` states and explicit retry affordance.
- **Approvals**: actionable from anywhere (toast → jump); per-hunk edit approval renders
  real diffs with per-hunk checkboxes; deny requires a note.
- **Confirm-gated daemon methods**: one shared ConfirmSurface component that names the
  exact action, target, and blast radius, and emits `confirm:true` + explicitUserRequest.
- **Four visually distinct states, implemented by every list view:**

  | State | Component | What it shows |
  |---|---|---|
  | Empty | `EmptyState` | Nothing exists yet, distinct from a failure |
  | Error | `ErrorState` | The cause and a retry affordance |
  | Loading | `SkeletonBlock` | Content is on its way |
  | Unavailable | `UnavailableState` | The specific daemon capability that's missing |
- **Toasts** max 3 with overflow counter ("+2 more" opens a notification drawer that is
  actually fed with the overflowed items, not a dead affordance).
- **No native `alert()`/`confirm()` ever.** RPC native dialogs for file pickers only.
- **Long-running turns** trigger desktop notifications (configurable threshold) with
  deep links back to the exact session.
- **View switches never destroy state, except where holding state would itself be the
  risk.** Chat, Terminal, and Dates keep-alive (display:none, not unmount) because each
  holds something nothing else can reproduce: chat's in-flight stream, terminal
  scrollback, or Dates' typed draft and in-progress gift-interview reply. Payments is the
  deliberate exception: its card panel does NOT keep-alive, because a keep-alive view
  stays mounted behind whatever opens next for as long as the app runs, and a typed card
  number, expiry, and verification code are not state the shell should ever hold that
  long. Unmounting on view switch is what makes "no card value survives navigation" a
  property of the shell itself rather than a promise a component has to keep; it also
  stops the budget and purchases polls at the same time.

## 5. Zero-friction onboarding (first run)

One screen, three live checks with real-time status:
1. Daemon found/spawned/adopted, shows which.
2. Auth token resolved.
3. Provider+model available (imported from existing TUI/agent settings when present;
   otherwise inline key entry with a provider picker and validation-on-blur).

A "Start chatting" button enables the moment checks pass.
Every check is repairable inline, none modal-blocking, all skippable to a degraded but
honest workspace. Re-runnable anytime as Settings → Doctor.

## 6. Performance budgets

- Window paints < 1s from launch; first interactive chat < 2.5s on this machine.
- Never serialize window creation behind network calls. The window opens immediately with
  the shell skeleton; data hydrates in.
- Virtualize every list that can exceed ~200 rows (sessions, telemetry, knowledge).
- SSE-first freshness; polling only where no wire event exists (fleet: 5s while visible).

## 7. Accessibility

Focus traps in all overlays; `aria-label` on every icon button; a live announcer for
async completions; visible focus rings (token-defined); WCAG AA contrast in both themes;
keyboard path to every mouse action; reduced-motion.
