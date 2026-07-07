// Coach-mark renderer for the first-run UI tour (docs/GAPS.md §22 row 7).
// Renders OVER the real, still-mounted shell (no dark full-screen backdrop —
// that would hide the very sidebar/status-strip it's pointing at): a small
// spotlight ring around the target element plus a positioned card. Pure
// client-side; the "seen" flag is the only persistence (tour.ts).

import { useEffect, useState, type CSSProperties } from "react";
import { useFocusTrap } from "../../lib/focus-trap.ts";
import { announce } from "../../lib/announcer.ts";
import { TOUR_STOPS, markTourSeen } from "./tour.ts";

const CARD_WIDTH = 320;

export function WelcomeTour({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const panelRef = useFocusTrap<HTMLDivElement>(true);
  const stop = TOUR_STOPS[index]!;
  const last = index === TOUR_STOPS.length - 1;

  useEffect(() => {
    announce(`Tour: ${stop.title}`);
    if (!stop.selector) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(stop.selector!);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [stop]);

  function finish(): void {
    markTourSeen();
    onDone();
  }

  function next(): void {
    if (last) {
      finish();
      return;
    }
    setIndex((i) => i + 1);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      finish();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cardStyle: CSSProperties = rect
    ? {
        position: "fixed",
        top: Math.min(rect.bottom + 12, window.innerHeight - 220),
        left: Math.min(Math.max(rect.left, 16), Math.max(16, window.innerWidth - CARD_WIDTH - 16)),
        width: CARD_WIDTH,
      }
    : { width: CARD_WIDTH };

  return (
    <div className="tour-layer" role="dialog" aria-modal="true" aria-label={`Tour: ${stop.title}`}>
      {rect && (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}
      <div ref={panelRef} className={rect ? "tour-card" : "tour-card tour-card--centered"} style={cardStyle}>
        <p className="tour-card__step">
          {index + 1} / {TOUR_STOPS.length}
        </p>
        <h3 className="tour-card__title">{stop.title}</h3>
        <p className="tour-card__body">{stop.body}</p>
        <div className="tour-card__actions">
          <button type="button" className="tour-card__skip" onClick={finish}>
            Skip tour
          </button>
          <button type="button" className="tour-card__next" onClick={next}>
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
