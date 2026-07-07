// Mount/unmount transition wrapper + reduced-motion hook.
// Ported from goodvibes-webui src/components/motion/*.

import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

/** True when the user requested reduced motion — via the OS media query or
 * the app's own motion preference (data-motion="reduced" on :root). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.getAttribute("data-motion") === "reduced"
    );
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const recompute = () =>
      setReduced(mq.matches || document.documentElement.getAttribute("data-motion") === "reduced");
    mq.addEventListener("change", recompute);
    const observer = new MutationObserver(recompute);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => {
      mq.removeEventListener("change", recompute);
      observer.disconnect();
    };
  }, []);

  return reduced;
}

type Phase = "unmounted" | "entering" | "visible" | "leaving";

interface PresenceProps {
  present: boolean;
  /** Exit animation duration (ms); child unmounts after. */
  exitDurationMs?: number;
  children: ReactNode;
}

/**
 * Adds data-state="entering"|"visible"|"leaving" to the direct child so CSS
 * drives the animation; unmounts after the exit duration (immediately under
 * reduced motion).
 */
export function Presence({ present, exitDurationMs = 180, children }: PresenceProps) {
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(present ? "visible" : "unmounted");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    clearTimer();
    if (present) {
      if (phase === "unmounted") {
        setPhase("entering");
        timerRef.current = setTimeout(() => setPhase("visible"), 16);
      } else {
        setPhase("visible");
      }
    } else {
      if (phase === "unmounted") return;
      if (reducedMotion) {
        setPhase("unmounted");
      } else {
        setPhase("leaving");
        timerRef.current = setTimeout(() => setPhase("unmounted"), exitDurationMs);
      }
    }
    return clearTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present, reducedMotion]);

  if (phase === "unmounted") return null;

  const child = Children.only(children);
  if (!isValidElement(child)) return null;

  return cloneElement(child as ReactElement<Record<string, unknown>>, { "data-state": phase });
}
