// One check-in receipt row. Every field renders verbatim and plainly — the
// UX bar's honesty rule: no outcome is ever collapsed to a bare status dot.

import { formatCheckinTimestamp, receiptOutcomeLabel, outcomeTone, type CheckinReceipt } from "./checkin-wire.ts";

export function CheckInReceiptRow({ receipt }: { receipt: CheckinReceipt }) {
  return (
    <li className="checkin-receipt">
      <div className="checkin-receipt__header">
        <span className={`badge ${outcomeTone(receipt.outcome)}`}>{receiptOutcomeLabel(receipt.outcome)}</span>
        <span className="badge neutral">{receipt.trigger}</span>
        <span className="checkin-receipt__meta">{formatCheckinTimestamp(receipt.ranAt)}</span>
      </div>
      {receipt.briefingSummary && <p className="checkin-receipt__summary">{receipt.briefingSummary}</p>}
      {receipt.decisionReason && <p className="checkin-receipt__detail">Reason: {receipt.decisionReason}</p>}
      {receipt.deliveredMessage && <p className="checkin-receipt__detail">Message: {receipt.deliveredMessage}</p>}
      {receipt.deliveryChannel && <p className="checkin-receipt__detail">Channel: {receipt.deliveryChannel}</p>}
      {receipt.error && <p className="checkin-receipt__detail checkin-receipt__detail--error">Error: {receipt.error}</p>}
    </li>
  );
}
