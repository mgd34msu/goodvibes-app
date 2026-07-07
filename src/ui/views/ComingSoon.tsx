// Honest placeholder for views whose wave has not landed yet (wire-or-delete:
// a stub must SAY it is a stub and name when it arrives). Replaced per view
// as waves B/C/D land — see views/registry.tsx.

import { EmptyState } from "../components/feedback.tsx";

export interface ComingSoonProps {
  title: string;
  /** The build wave that delivers this view (docs/FEATURES.md waves). */
  wave: string;
  /** One line of what the view will do. */
  description?: string;
}

export function ComingSoon({ title, wave, description }: ComingSoonProps) {
  return (
    <div className="coming-soon">
      <EmptyState
        title={`${title} is not built yet`}
        description={`${description ? `${description} ` : ""}This surface ships in ${wave}. Nothing here is wired — no silent stubs.`}
      />
    </div>
  );
}
