import type { AuthenticatedFetch, DebriefItem } from '@language-drill/api-client';
import { ReviewItemCard } from './review-item-card';

// ---------------------------------------------------------------------------
// ReviewTab — vertical list of `ReviewItemCard`s in manifest order. The
// parent (debrief page) is responsible for ordering — items are rendered
// 1-to-1 in the order received (Req 5.1).
// ---------------------------------------------------------------------------

export interface ReviewTabProps {
  items: DebriefItem[];
  fetchFn: AuthenticatedFetch;
}

export function ReviewTab({ items, fetchFn }: ReviewTabProps) {
  return (
    <div className="fade-in mt-s-6 flex flex-col gap-s-3">
      {items.map((item, index) => (
        <ReviewItemCard key={item.exerciseId} index={index} item={item} fetchFn={fetchFn} />
      ))}
    </div>
  );
}
