// Pure logic for the first-run UI tour (docs/GAPS.md §22 row 7): step
// content + the localStorage "seen" flag. No React, no fetch — WelcomeTour.tsx
// owns rendering.

export const TOUR_SEEN_STORAGE_KEY = "goodvibes.app.onboarding.tourSeen";

export function hasTourBeenSeen(): boolean {
  try {
    return window.localStorage.getItem(TOUR_SEEN_STORAGE_KEY) === "true";
  } catch {
    return true; // storage unavailable — never nag
  }
}

export function markTourSeen(): void {
  try {
    window.localStorage.setItem(TOUR_SEEN_STORAGE_KEY, "true");
  } catch {
    // best-effort
  }
}

export interface TourStop {
  id: string;
  title: string;
  body: string;
  /**
   * CSS selector for the shell element to spotlight. Left undefined renders
   * a centered card instead of a spotlight — used for the command palette
   * stop, which (by design, docs/UX.md §23) has no persistent on-screen
   * trigger to point at; the coach mark names its keyboard shortcut instead
   * of pointing at a fake target.
   */
  selector?: string;
}

export const TOUR_STOPS: readonly TourStop[] = [
  {
    id: "welcome",
    title: "A 30-second tour",
    body: "Three quick stops — sidebar, command palette, status strip — then you're done. Skip anytime.",
  },
  {
    id: "sidebar",
    title: "Sidebar",
    body: "Every view lives here, grouped by domain. Collapse it to an icon rail from the toggle at the top, or the palette.",
    selector: ".sidebar",
  },
  {
    id: "palette",
    title: "Command palette",
    body: 'Press Ctrl+K (Cmd+K on Mac) from anywhere to jump to any view or run a command by name — nothing on screen marks it, the shortcut is the trigger.',
  },
  {
    id: "status",
    title: "Status strip",
    body: "Connection, auth, and approval state live here at all times — honest at a glance, no separate dashboard to check.",
    selector: ".status-strip",
  },
  {
    id: "done",
    title: "That's it",
    body: 'Replay this anytime from Doctor (palette → "Doctor" → Replay tour).',
  },
];
