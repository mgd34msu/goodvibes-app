// Left sidebar — six groups (docs/UX.md §2), collapsible to a 60px icon
// rail, lucide icons, aria-labels on every icon-only control. Collapse state
// persists to localStorage.

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ViewId } from "../../lib/router.ts";
import { VIEW_GROUPS, VIEW_REGISTRY } from "../../views/registry.tsx";

export const SIDEBAR_COLLAPSED_KEY = "goodvibes.app.sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // localStorage unavailable — collapse state just won't persist.
  }
}

export interface SidebarProps {
  activeView: ViewId;
  collapsed: boolean;
  onNavigate: (view: ViewId) => void;
  onToggleCollapsed: () => void;
}

export function Sidebar({ activeView, collapsed, onNavigate, onToggleCollapsed }: SidebarProps) {
  return (
    <aside className={collapsed ? "sidebar collapsed" : "sidebar"} aria-label="Primary navigation">
      <div className="brand">
        <div className="brand-copy">
          <strong>GoodVibes</strong>
          <span>operator desktop</span>
        </div>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={16} aria-hidden="true" />
          )}
        </button>
      </div>

      <nav className="sidebar-nav">
        {VIEW_GROUPS.map((group) => (
          <div key={group.id} className="nav-group">
            <div className="nav-group-label" aria-hidden={collapsed}>
              {group.label}
            </div>
            <div className="nav-list" role="list">
              {group.views.map((viewId) => {
                const def = VIEW_REGISTRY[viewId];
                const Icon = def.icon;
                const active = activeView === viewId;
                return (
                  <button
                    key={viewId}
                    type="button"
                    role="listitem"
                    className={active ? "nav-item active" : "nav-item"}
                    aria-current={active ? "page" : undefined}
                    aria-label={def.title}
                    title={collapsed ? def.title : undefined}
                    onClick={() => onNavigate(viewId)}
                  >
                    <span className="nav-icon" aria-hidden="true">
                      <Icon size={16} />
                    </span>
                    <span className="nav-copy">{def.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
