// Visibility signal for a keep-alive view's polling.
//
// AppShell mounts keepAlive views once and hides them with display:none + inert
// rather than unmounting them (AppShell.tsx:205-209), and React Query's
// refetchInterval only pauses on document/window visibility, never on an
// ancestor's display:none. Without this gate, a view that has been opened once
// keeps polling forever from behind every other view (checklist item 18: no
// polling loops while a view is hidden).
//
// Ported from the same observer ChatView.tsx uses, hoisted into a hook because
// Dates has four independently polling queries across four panels and one
// observer answering for all of them beats four watching the same element.

import { useEffect, useState, type RefObject } from "react";

export function useViewVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const frame = ref.current?.closest<HTMLElement>(".view-frame");
    if (!frame) return undefined;
    const update = () => setVisible(frame.style.display !== "none");
    update();
    const observer = new MutationObserver(update);
    observer.observe(frame, { attributes: true, attributeFilter: ["style", "inert"] });
    return () => observer.disconnect();
  }, [ref]);

  return visible;
}

/** The refetchInterval to hand React Query: the cadence while the view is on
 *  screen, and `false` (no polling at all) while it is hidden. */
export function pollWhileVisible(visible: boolean, intervalMs: number): number | false {
  return visible ? intervalMs : false;
}
