// Status badge — tone classified by lib/presentation-bridge.ts; the leading
// glyph comes from the SDK presentation contract (same vocabulary the
// TUI/agent render) and is painted via a data-attribute + ::before rule
// (styles/components.css) so `.textContent` stays exactly the label.

import { classifyBadgeTone, contractGlyphForBadgeTone } from "../lib/presentation-bridge.ts";

interface StatusBadgeProps {
  value: string;
}

export function StatusBadge({ value }: StatusBadgeProps) {
  const tone = classifyBadgeTone(value);
  return (
    <span className={`badge ${tone}`} data-contract-glyph={contractGlyphForBadgeTone(tone)}>
      {value}
    </span>
  );
}
