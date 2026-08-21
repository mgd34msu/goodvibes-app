// Dates: the occasions surface, all 17 verbs.
// Crib: goodvibes-webui src/views/dates/DatesView.tsx, which is where the flat
// four-section split comes from (no tabs: each section answers a different
// question and they are read together, not switched between).
//
// The split is not cosmetic. Upcoming carries dates because the owner asked
// his own system what it holds; Open items carries proximity words because a
// nudge never names a date; Plans never prompts at all; and the store
// disclosure carries counts and nothing else. Keeping them apart is what keeps
// each one honest about what it is allowed to say.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { queryKeys } from "../../lib/queries.ts";
import { UpcomingDatesPanel } from "./UpcomingDatesPanel.tsx";
import { OpenItemsPanel } from "./OpenItemsPanel.tsx";
import { PlansPanel } from "./PlansPanel.tsx";
import { OccasionsStatePanel } from "./OccasionsStatePanel.tsx";
import { useViewVisible } from "./use-view-visible.ts";

export function DatesView() {
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);

  // This view is keep-alive, so it stays mounted behind whatever the owner
  // looks at next and its four polls would otherwise run forever against
  // personal data. One observer answers for all four panels.
  const visible = useViewVisible(rootRef);

  useEffect(() => {
    registerCommand({
      id: "dates.refresh",
      title: "Dates: Refresh Everything",
      group: "assistant",
      keywords: ["dates", "occasions", "birthday", "anniversary", "gifts", "plans", "refresh"],
      run: () => void queryClient.invalidateQueries({ queryKey: queryKeys.occasions }),
    });
    return () => unregisterCommand("dates.refresh");
  }, [queryClient]);

  return (
    <div className="dates-view" ref={rootRef}>
      <UpcomingDatesPanel visible={visible} />
      <OpenItemsPanel visible={visible} />
      <PlansPanel visible={visible} />
      <OccasionsStatePanel visible={visible} />
    </div>
  );
}
