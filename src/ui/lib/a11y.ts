// Shared accessibility helpers.

import type React from "react";
import { useId } from "react";

/** Hydration-safe unique DOM id for aria-labelledby/aria-describedby pairs. */
export function useGenId(prefix: string): string {
  const reactId = useId();
  return `${prefix}-${reactId.replace(/:/g, "")}`;
}

/** Visually hides an element while keeping it readable by screen readers.
 * Defined in styles/components.css. */
export const SR_ONLY_CLASS = "sr-only";

export const srOnlyStyle: React.CSSProperties = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  borderWidth: 0,
};
