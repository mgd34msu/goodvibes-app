# goodvibes-app — UX Specification

UI/UX is the forefront criterion for every decision in this app. This document is the
contract implementation agents build against. The failure catalog it must never repeat is
`docs/research/desktop-prior-art.md` §3 (83 audited findings); the visual language it
extends is `docs/research/webui-map.md` §3.

## 1. Principles

1. **Zero friction.** First launch lands you in a working chat within seconds: daemon
   auto-detected or auto-spawned, token auto-resolved from the shared store, model
   defaulted from existing TUI/agent settings when present. Onboarding asks questions
   only when no answer can be inferred — and never blocks surfaces that already work.
2. **Never lie, never lose work.** Every number has a label and a frame of reference.
   Every failure has a visible, specific error state distinct from "empty". Drafts
   survive daemon outages (gate overlays render *over* the still-mounted workspace, never
   remount it). Destructive actions get typed confirmations; closing the app never kills
   daemon-side work.
3. **Keyboard-first.** Command palette (Ctrl+K) reaches every action; `g`-chords navigate
   views; every shortcut shown in the UI comes from the single live keybinding registry
   (no hardcoded hint strings — autopsy Theme 2). Full focus-trap discipline in modals;
   ARIA labels on all icon buttons; reduced-motion honored.
4. **Observability ambient, not buried.** The status strip is always present (daemon
   three-axis health, latency, SSE state, active turns, live cost of the current
   session). Cost/token/health surfaces are one palette-jump away from anywhere.
5. **Progressive disclosure.** Pages are observability; modals are configuration (webui
   doctrine). Dense master/detail lists with a right peek panel for drill-in; fullscreen
   only for chat and genuinely immersive surfaces (model workspace, documents editor).

## 2. Information architecture

Left sidebar (collapsible to icon rail, 264px/60px), grouped:

- **Work**: Chat · Sessions · Fleet · Approvals
- **Automate**: Automation (jobs/schedules/runs) · Watchers · Channels
- **Know**: Knowledge · Memory · Artifacts · Research · Documents
- **Assistant**: Home (briefing/away-digest/coming-up) · Routines · Personas · Skills · Personal Ops
- **Code**: Git · Diff · Worktrees · Checkpoints · Terminal
- **System**: Observability · Providers & Models · MCP · Settings

Top bar: view eyebrow + title, view-scoped actions, global search. Bottom: status strip
(32px). Right: peek panel slide-over. Overlay: command palette.

Every view URL-addressable via internal route state (`?view=…&…`) so palette jumps,
notifications, and deep links compose.

## 3. Visual language

Port the webui token sheet (`docs/research/webui-map.md` §3) as `src/ui/styles/tokens.css`:
dark-first neon-cyan operator aesthetic — base `#08080f`, cyan-alpha borders, accent
`#00dede`→`#00ffff`, status `#38ff8b`/`#ffcc66`/`#ff6ac8`/`#8da2ff` with `-soft` fills;
brand neon reserved for glow/accents, never large fills. Light theme = the webui desaturated
remap. 4px spacing scale, radius 6/8/12/999, Inter/Space Mono (bundled locally, no network
fonts), motion 120/180/260ms, z ladder nav10/peek40/overlay50/palette60/toast70.

Status semantics come from the **SDK presentation contract** (16 glyphs, 4 severity
buckets) via a generated `presentation-tokens.css` + bridge module, so states render
identically to TUI/agent/webui. Theme: dark default, light opt-in, compact density toggle,
`prefers-reduced-motion` collapses motion to 0.

## 4. Interaction patterns (binding rules)

- **Streaming chat**: deltas paint as they arrive; a thinking strip shows live token
  count; tool calls render as collapsible blocks with status glyphs; a visible turn state
  machine (queued → streaming → completed/error/cancelled) — `STREAM_END` is not
  terminal, only `TURN_COMPLETED/ERROR/CANCEL` are.
- **Optimistic sends** with `local/sent/failed` states and explicit retry affordance.
- **Approvals**: actionable from anywhere (toast → jump); per-hunk edit approval renders
  real diffs with per-hunk checkboxes; deny requires a note.
- **Confirm-gated daemon methods**: one shared ConfirmSurface component that names the
  exact action, target, and blast radius, and emits `confirm:true` + explicitUserRequest.
- **Empty vs error vs loading vs unavailable** are four visually distinct states; every
  list view implements all four (`EmptyState`, `ErrorState` with cause + retry,
  `SkeletonBlock`, `UnavailableState` naming the missing daemon capability).
- **Toasts** max 3 with overflow counter ("+2 more" opens a notification drawer that is
  actually fed — autopsy Theme 3).
- **No native `alert()`/`confirm()` ever.** RPC native dialogs for file pickers only.
- **Long-running turns** trigger desktop notifications (configurable threshold) with
  deep links back to the exact session.
- **View switches never destroy state** — views keep-alive (display:none, not unmount)
  for Chat, Terminal, and any view holding a draft or scrollback.

## 5. Zero-friction onboarding (first run)

One screen, three live checks with real-time status: (1) daemon found/spawned/adopted —
shows which; (2) auth token resolved; (3) provider+model available (imported from
existing TUI/agent settings when present; otherwise inline key entry with a provider
picker and validation-on-blur). A "Start chatting" button enables the moment checks pass
— every check repairable inline, none modal-blocking, all skippable to a degraded but
honest workspace. Re-runnable anytime as Settings → Doctor.

## 6. Performance budgets

- Window paints < 1s from launch; first interactive chat < 2.5s on this machine.
- Never serialize window creation behind network calls (autopsy Theme 5): the window
  opens immediately with the shell skeleton; data hydrates in.
- Virtualize every list that can exceed ~200 rows (sessions, telemetry, knowledge).
- SSE-first freshness; polling only where no wire event exists (fleet: 5s while visible).

## 7. Accessibility

Focus traps in all overlays; `aria-label` on every icon button; a live announcer for
async completions; visible focus rings (token-defined); WCAG AA contrast in both themes;
keyboard path to every mouse action; reduced-motion.
