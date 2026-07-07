// Toast card + viewport + overflow drawer. Max 3 floating cards; older
// toasts move to the drawer behind a "+N more" button — the drawer is a real
// notification list, nothing silently dropped (docs/UX.md §4).

import { useToastContext, useAutoDismiss, splitVisible, TOAST_EXIT_DURATION_MS } from "../lib/toast.ts";
import type { ToastEntry, ToastTone } from "../lib/toast.ts";
import { Presence } from "./motion.tsx";

/** alert (assertive) for warning/danger; status (polite) for info/success. */
export function roleForTone(tone: ToastTone): "alert" | "status" {
  return tone === "warning" || tone === "danger" ? "alert" : "status";
}

interface ToastProps {
  toast: ToastEntry;
  onDismiss: (id: string) => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  const { handleMouseEnter, handleMouseLeave, handleFocus, handleBlur } = useAutoDismiss({
    id: toast.id,
    durationMs: toast.durationMs,
    onDismiss,
  });

  return (
    <div
      role={roleForTone(toast.tone)}
      aria-atomic="true"
      data-tone={toast.tone}
      className="toast"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      <div className="toast__body">
        <p className="toast__title">{toast.title}</p>
        {toast.description && <p className="toast__description">{toast.description}</p>}
      </div>
      <div className="toast__actions">
        {toast.action && (
          <button
            type="button"
            className="toast__action-btn"
            onClick={() => {
              toast.action?.onClick();
              onDismiss(toast.id);
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button
          type="button"
          className="toast__dismiss-btn"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(toast.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}

/** Floating stack (bottom-right) + overflow counter + drawer. Mount once
 * inside ToastProvider near the root. */
export function ToastViewport() {
  const { toasts, leavingIds, drawerOpen, dismiss, dismissAll, setDrawerOpen } = useToastContext();
  const { visible, overflow } = splitVisible(toasts);

  return (
    <>
      <div className="toast-viewport" aria-label="Notifications" role="region">
        {overflow.length > 0 && (
          <button
            type="button"
            className="toast-overflow"
            onClick={() => setDrawerOpen(true)}
            aria-label={`${overflow.length} more notifications — open notification drawer`}
          >
            +{overflow.length} more
          </button>
        )}
        {visible.map((t) => (
          <Presence key={t.id} present={!leavingIds.has(t.id)} exitDurationMs={TOAST_EXIT_DURATION_MS}>
            <div className="toast-presence-wrapper">
              <Toast toast={t} onDismiss={dismiss} />
            </div>
          </Presence>
        ))}
      </div>

      {drawerOpen && (
        <div className="toast-drawer" role="dialog" aria-label="Notification drawer">
          <div className="toast-drawer__header">
            <h2 className="toast-drawer__title">Notifications ({toasts.length})</h2>
            <div className="toast-drawer__header-actions">
              <button type="button" className="toast-drawer__clear" onClick={dismissAll}>
                Clear all
              </button>
              <button
                type="button"
                className="toast-drawer__close"
                aria-label="Close notification drawer"
                onClick={() => setDrawerOpen(false)}
              >
                ×
              </button>
            </div>
          </div>
          <div className="toast-drawer__list">
            {toasts.length === 0 ? (
              <p className="toast-drawer__empty">No notifications.</p>
            ) : (
              [...toasts].reverse().map((t) => (
                <div key={t.id} className="toast-drawer__row" data-tone={t.tone}>
                  <div className="toast__body">
                    <p className="toast__title">{t.title}</p>
                    {t.description && <p className="toast__description">{t.description}</p>}
                  </div>
                  <div className="toast__actions">
                    {t.action && (
                      <button
                        type="button"
                        className="toast__action-btn"
                        onClick={() => {
                          t.action?.onClick();
                          dismiss(t.id);
                        }}
                      >
                        {t.action.label}
                      </button>
                    )}
                    <button
                      type="button"
                      className="toast__dismiss-btn"
                      aria-label="Dismiss notification"
                      onClick={() => dismiss(t.id)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
