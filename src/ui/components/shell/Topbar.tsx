// Topbar: eyebrow (group label) + view title + a view-scoped actions slot.
// Views publish actions into the slot via ViewActionsProvider/useViewActions
// so the topbar itself never knows domain specifics.

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ViewId } from "../../lib/router.ts";
import { groupLabel, viewDef } from "../../views/registry.tsx";

interface ViewActionsContextValue {
  actions: ReactNode;
  setActions: (actions: ReactNode) => void;
}

const ViewActionsContext = createContext<ViewActionsContextValue | null>(null);

export function ViewActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ReactNode>(null);
  return (
    <ViewActionsContext.Provider value={{ actions, setActions }}>{children}</ViewActionsContext.Provider>
  );
}

/** Views call setActions(<buttons/>) on mount and setActions(null) on cleanup. */
export function useViewActions(): (actions: ReactNode) => void {
  const ctx = useContext(ViewActionsContext);
  if (!ctx) throw new Error("useViewActions must be used within a ViewActionsProvider");
  return ctx.setActions;
}

export function Topbar({ activeView }: { activeView: ViewId }) {
  const ctx = useContext(ViewActionsContext);
  const def = viewDef(activeView);

  return (
    <header className="topbar">
      <div className="topbar-title">
        <span className="eyebrow">{groupLabel(def.group)}</span>
        <h1>{def.title}</h1>
      </div>
      <div className="topbar-actions">{ctx?.actions}</div>
    </header>
  );
}
