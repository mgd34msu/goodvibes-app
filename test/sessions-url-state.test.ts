// URL-state composition for the Sessions view's two tabs.
//
// The Sessions view writes the URL from two places that do not know about each
// other: the union tab stamps the selected ?session= through replaceState
// (deliberately, since picking a row is not a history-worthy step), and the tab
// rail writes ?filter[stab]=. useUrlState's state is a snapshot updated only by
// its own setters and by popstate, so it never sees the first write. Rebuilding
// the URL from that snapshot dropped ?session= on every tab switch, which is
// both the deep link and the selection to come back to.
//
// withFilters composes from a state read fresh instead, and these tests walk the
// exact sequence: select a session, switch to hosted, switch back.

import { describe, expect, test } from "bun:test";
import { decodeUrlState, encodeUrlState, withFilters, type AppUrlState } from "../src/ui/lib/router.ts";

/** One hop of the real flow: decode what is in the bar, merge, re-encode. */
function applyTab(search: string, tab: "all" | "hosted"): string {
  return encodeUrlState(withFilters(decodeUrlState(search), { stab: tab === "all" ? undefined : tab }));
}

describe("withFilters", () => {
  test("leaves view and session alone while setting a filter", () => {
    const next = withFilters(decodeUrlState("?view=sessions&session=hosted-abc"), { stab: "hosted" });
    expect(next.view).toBe("sessions");
    expect(next.session).toBe("hosted-abc");
    expect(next.filters).toEqual({ stab: "hosted" });
  });

  test("undefined removes a key and keeps every other filter", () => {
    const state = decodeUrlState("?view=sessions&session=s1&filter[stab]=hosted&filter[kind]=tui");
    const next = withFilters(state, { stab: undefined });
    expect(next.filters).toEqual({ kind: "tui" });
    expect(next.session).toBe("s1");
  });

  test("does not mutate the state it was given", () => {
    const state: AppUrlState = decodeUrlState("?view=sessions&filter[kind]=tui");
    withFilters(state, { stab: "hosted" });
    expect(state.filters).toEqual({ kind: "tui" });
  });
});

describe("selecting a session then switching tabs", () => {
  test("the selection survives the round trip, so returning restores it", () => {
    // 1. The union tab stamps the picked row.
    const selected = "view=sessions&session=hosted-abc";
    expect(decodeUrlState(`?${selected}`).session).toBe("hosted-abc");

    // 2. Switch to Hosted.
    const onHosted = applyTab(`?${selected}`, "hosted");
    expect(onHosted).toContain("session=hosted-abc");
    expect(onHosted).toContain("filter%5Bstab%5D=hosted");

    // 3. Switch back. Both the selection and a clean tab key survive.
    const backOnAll = applyTab(`?${onHosted}`, "all");
    const final = decodeUrlState(`?${backOnAll}`);
    expect(final.session).toBe("hosted-abc");
    expect(final.view).toBe("sessions");
    expect(final.filters["stab"]).toBeUndefined();
  });

  test("other filters set by the union tab also survive a tab switch", () => {
    const start = "?view=sessions&session=s1&filter[kind]=tui&filter[project]=goodvibes";
    const onHosted = decodeUrlState(`?${applyTab(start, "hosted")}`);
    expect(onHosted.filters).toEqual({ kind: "tui", project: "goodvibes", stab: "hosted" });
    expect(onHosted.session).toBe("s1");
  });

  test("the stale-snapshot composition this replaces is what dropped the session", () => {
    // The old path rebuilt from useUrlState's mount snapshot, which predates the
    // union tab's replaceState. Modelled here as the state at mount time:
    // no session, because none had been picked yet.
    const mountSnapshot = decodeUrlState("?view=sessions");
    const fromStaleSnapshot = encodeUrlState(withFilters(mountSnapshot, { stab: "hosted" }));
    expect(fromStaleSnapshot).not.toContain("session=");

    // Composing from what is actually in the bar keeps it.
    const fresh = applyTab("?view=sessions&session=hosted-abc", "hosted");
    expect(fresh).toContain("session=hosted-abc");
  });
});
