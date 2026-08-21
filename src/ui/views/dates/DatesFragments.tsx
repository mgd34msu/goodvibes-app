// Pieces shared by more than one Dates panel: the unparsed-lines note, the
// propose-then-confirm preview block, and the small badges.

import type { FC, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { OccasionProposal, UnparsedLine } from "./dates-data.ts";

/**
 * Lines under the heading the reader could not type.
 *
 * Shown rather than swallowed, and shown with the owner's own text: the daemon
 * reports these instead of rewriting them, and a surface that hid them would
 * leave him believing a date is being watched when nothing is.
 */
export const UnparsedLinesNote: FC<{ lines: UnparsedLine[]; heading: string }> = ({ lines, heading }) => {
  if (lines.length === 0) return null;
  return (
    <div className="dates-unparsed" role="status">
      <p className="dates-unparsed__title">
        <AlertTriangle size={14} aria-hidden="true" /> {lines.length} line
        {lines.length === 1 ? "" : "s"} under {heading} could not be read
      </p>
      <ul className="dates-unparsed__list">
        {lines.map((line) => (
          <li key={`${line.lineIndex}-${line.text}`}>
            <code className="dates-unparsed__text">{line.text}</code>
            <span className="dates-unparsed__reason">{line.reason}</span>
          </li>
        ))}
      </ul>
      <p className="dates-unparsed__foot">
        These are left exactly as written. Nothing is watching them until they read as a date.
      </p>
    </div>
  );
};

export interface ProposalPreviewProps {
  proposal: OccasionProposal;
  /** Rendered under the confirmation: the Confirm button and any gate on it. */
  children?: ReactNode;
}

/**
 * What the daemon said it WOULD write, before anything is written.
 *
 * Both `reason` and `confirmation` are printed verbatim. A refusal here is an
 * answer in the daemon's own words ("August 27 is not a date I can read. Write
 * it as MM-DD for something annual, or YYYY-MM-DD."), and rewording it would
 * lose the instruction that fixes the input.
 */
export const ProposalPreview: FC<ProposalPreviewProps> = ({ proposal, children }) => {
  if (!proposal.ok) {
    return (
      <div className="dates-proposal dates-proposal--refused" role="status">
        <p className="dates-proposal__reason">{proposal.reason ?? "The daemon declined without giving a reason."}</p>
      </div>
    );
  }
  return (
    <div className="dates-proposal" role="status">
      <p className="dates-proposal__confirmation">{proposal.confirmation}</p>
      {proposal.line && (
        <p className="dates-proposal__line">
          This writes one line: <code>{proposal.line}</code>
        </p>
      )}
      {proposal.conflictsWith.length > 0 && (
        <p className="dates-proposal__conflict">
          <AlertTriangle size={14} aria-hidden="true" /> A different date is already recorded for this:{" "}
          {proposal.conflictsWith.join(", ")}. Confirming keeps both lines and raises a conflict, because only you
          can say which was right.
        </p>
      )}
      {children}
    </div>
  );
};
