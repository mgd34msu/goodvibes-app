// Posture — the daemon's one honest origin-security notice
// (pairing.posture.get), rendered VERBATIM, at most once per mount. Never a
// dismiss-and-reappear nag: no toast, no repeated banner, and — since this is
// a small ambient aside rather than a load-bearing capability — no
// UnavailableState card either when the method is missing; a missing/absent
// notice here just means nothing to say, so this renders nothing at all
// rather than manufacturing a "capability gap" story for one status line.

import { useQuery } from "@tanstack/react-query";
import { ShieldQuestion } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { pairingKeys, readPosture } from "./pairing-model.ts";

export function PairingPostureSection() {
  const posture = useQuery({
    queryKey: pairingKeys.posture,
    queryFn: () => gv.pairing.posture(),
    select: readPosture,
    staleTime: Infinity, // a static fact about how this app reached the daemon — never re-nag
    retry: false,
  });

  if (!posture.isSuccess || !posture.data.notice) return null;

  return (
    <p className="pairing-posture-notice" role="status">
      <ShieldQuestion size={14} aria-hidden="true" /> {posture.data.notice}
    </p>
  );
}
