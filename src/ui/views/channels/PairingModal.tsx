// "Pair companion" modal (docs/FEATURES.md §13 Companion pairing (QR)).
// Fetches GET /app/pairing/connection (Bun-side src/bun/pairing.ts — the SDK
// pairing helpers are platform-only, so the QR matrix arrives pre-computed)
// and renders it as an SVG QR. The raw payload embeds the daemon bearer token,
// so it is masked by default with an explicit reveal + copy (docs/UX.md
// secrets rule); the QR itself IS the pairing feature and always shows.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Eye, EyeOff, RefreshCw } from "lucide-react";
import { appJson } from "../../lib/http.ts";
import { formatError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { Modal } from "../../components/Modal.tsx";
import { ErrorState, SkeletonBlock } from "../../components/feedback.tsx";
import { channelsKeys } from "./keys.ts";

interface PairingConnection {
  payload: string;
  url: string;
  username: string;
  surface: string;
  version: string;
  qr: { size: number; modules: boolean[][] };
}

/** Render the Bun-computed QR matrix as a crisp SVG (1 module = 1 unit). */
function QrSvg({ qr }: { qr: PairingConnection["qr"] }) {
  const quiet = 4; // standard quiet zone, in modules
  const total = qr.size + quiet * 2;
  const rects: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    const row = qr.modules[y];
    if (!row) continue;
    // Merge horizontal runs into single rects to keep the SVG small.
    let runStart = -1;
    for (let x = 0; x <= qr.size; x++) {
      const dark = x < qr.size && row[x] === true;
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        rects.push(`M${runStart + quiet} ${y + quiet}h${x - runStart}v1h-${x - runStart}z`);
        runStart = -1;
      }
    }
  }
  return (
    <svg
      className="pairing-qr"
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label="Companion pairing QR code"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} className="pairing-qr__bg" />
      <path d={rects.join("")} className="pairing-qr__fg" />
    </svg>
  );
}

export function PairingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [revealed, setRevealed] = useState(false);

  const connection = useQuery({
    queryKey: channelsKeys.pairing,
    queryFn: () => appJson<PairingConnection>("/app/pairing/connection"),
    enabled: open,
    // The payload embeds a live token — never keep it warm in the cache.
    gcTime: 0,
    staleTime: 0,
    retry: false,
  });

  async function copyPayload(): Promise<void> {
    if (!connection.data) return;
    try {
      await navigator.clipboard.writeText(connection.data.payload);
      toast({ title: "Pairing payload copied", description: "Treat it like a password.", tone: "info" });
    } catch (err) {
      toast({ title: "Copy failed", description: formatError(err), tone: "danger" });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Pair companion" size="md">
      <div className="pairing-modal">
        {connection.isPending && <SkeletonBlock height={220} />}
        {connection.isError && (
          <ErrorState
            error={connection.error}
            onRetry={() => void connection.refetch()}
            title="Could not build the pairing payload"
          />
        )}
        {connection.isSuccess && (
          <>
            <p className="pairing-modal__lede">
              Scan with a GoodVibes companion app to connect it to this daemon. The code carries the
              daemon address and an access token — anyone who scans it can operate the daemon, so
              share it like a password.
            </p>
            <div className="pairing-modal__qr-frame">
              <QrSvg qr={connection.data.qr} />
            </div>
            <dl className="pairing-modal__facts">
              <dt>Daemon</dt>
              <dd className="pairing-modal__mono">{connection.data.url}</dd>
              <dt>User</dt>
              <dd className="pairing-modal__mono">{connection.data.username}</dd>
              <dt>Version</dt>
              <dd className="pairing-modal__mono">{connection.data.version || "unknown"}</dd>
            </dl>
            <p className="pairing-modal__note" role="note">
              The address above is what the companion will dial — a device on another machine must be
              able to reach it (a loopback 127.0.0.1 address only works on this computer).
            </p>
            <div className="pairing-modal__payload">
              <code className="pairing-modal__payload-text">
                {revealed ? connection.data.payload : "•".repeat(48)}
              </code>
              <div className="pairing-modal__payload-actions">
                <button
                  type="button"
                  className="pairing-modal__btn"
                  onClick={() => setRevealed((v) => !v)}
                  aria-label={revealed ? "Hide pairing payload" : "Reveal pairing payload"}
                >
                  {revealed ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                  {revealed ? "Hide" : "Reveal"}
                </button>
                <button type="button" className="pairing-modal__btn" onClick={() => void copyPayload()}>
                  <Copy size={14} aria-hidden="true" /> Copy payload
                </button>
                <button
                  type="button"
                  className="pairing-modal__btn"
                  onClick={() => void connection.refetch()}
                  aria-label="Refresh pairing payload"
                >
                  <RefreshCw size={14} aria-hidden="true" className={connection.isFetching ? "spinning" : undefined} />
                  Refresh
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
