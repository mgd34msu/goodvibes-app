// Gift history for one occasion, opened as a peek from an Upcoming row.
// Crib: goodvibes-webui src/views/dates/DatesGiftHistoryPeek.tsx.
//
// READ ONLY. There is deliberately no write here: a gift record is written by
// closing an interview with what the owner landed on, and nowhere else. The
// history outlives the answers on purpose (the answers expire with their date
// so next year asks fresh; the history does not), which is exactly what stops
// year three steering where year one already did.

import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { queryKeys } from "../../lib/queries.ts";
import { EmptyState, ErrorState, SkeletonBlock, UnavailableState } from "../../components/feedback.tsx";
import { datesApi, datesRefusal, formatEpoch } from "./dates-data.ts";

export interface GiftHistoryPeekProps {
  occasionId: string;
  title: string;
}

export function GiftHistoryPeek({ occasionId, title }: GiftHistoryPeekProps) {
  const gifts = useQuery({
    queryKey: queryKeys.occasionsGifts(occasionId),
    queryFn: () => datesApi.gifts(occasionId),
    retry: false,
  });

  const refusal = gifts.isError ? datesRefusal(gifts.error, "occasions.gifts") : null;
  const records = gifts.data?.gifts ?? [];

  return (
    <div className="dates-gift-peek">
      <p className="dates-gift-peek__lead">What you landed on for {title} in previous years, newest first.</p>

      {gifts.isPending && <SkeletonBlock variant="text" lines={4} />}
      {refusal && <UnavailableState capability={refusal.capability} description={refusal.description} />}
      {gifts.isError && !refusal && (
        <ErrorState error={gifts.error} onRetry={() => void gifts.refetch()} title="Failed to load gift history" />
      )}
      {gifts.isSuccess && records.length === 0 && (
        <EmptyState
          icon={<Gift size={20} aria-hidden="true" />}
          title="No gift history yet"
          description="A record is written when a gift interview is closed with what you settled on. Answering yes alone does not write one."
        />
      )}
      {records.length > 0 && (
        <ul className="dates-gift-peek__list">
          {records.map((record) => (
            <li key={`${record.occasionId}-${record.occurrence}-${record.recordedAt}`} className="dates-gift-record">
              <div className="dates-gift-record__head">
                <span className="dates-gift-record__occurrence">{record.occurrence}</span>
                <span className="dates-gift-record__recorded">recorded {formatEpoch(record.recordedAt)}</span>
              </div>
              <p className="dates-gift-record__landed">{record.landedOn}</p>
              {record.notes && <p className="dates-gift-record__notes">{record.notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
