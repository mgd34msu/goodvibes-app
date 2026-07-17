// Hand-off — mints a scoped pairing link (pairing.handoff.create) and
// renders it as a deep link plus a client-rendered QR computed locally by
// generateQrMatrix (./qr-generator.ts — a same-algorithm mirror of the
// pinned goodvibes SDK's "platform" pairing export; see that file's
// docblock for why it is duplicated here rather than imported: scripts/
// check-boundaries.ts forbids any import of that SDK's "platform" subpath
// from src/ui, and this desktop app cannot ask its Bun main process to
// compute one either, since that would mean editing src/bun/**, outside this
// agent's file ownership — flagged for the integration gate). No extra
// daemon round-trip either way: the matrix is pure client-side arithmetic.
//
// This app is always the pairing INITIATOR: pairing.handoff.complete is the
// RECEIVING device's own WebAuthn/push/relay ceremony and has no surface
// here (see pairing-model.ts's docblock) — no `offers` are requested when
// minting, since this app doesn't complete any of them itself.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { generateQrMatrix, type QrMatrix } from "./qr-generator.ts";
import { Copy, Link2 } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError, isMethodUnavailableError, isWsBridgeUnavailableError } from "../../lib/errors.ts";
import { useToast } from "../../lib/toast.ts";
import { UnavailableState } from "../../components/feedback.tsx";
import { readHandoffResult } from "./pairing-model.ts";

function QrSvg({ qr }: { qr: QrMatrix }) {
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
    <svg className="peers-qr" viewBox={`0 0 ${total} ${total}`} role="img" aria-label="Pairing hand-off QR code" shapeRendering="crispEdges">
      <rect width={total} height={total} className="peers-qr__bg" />
      <path d={rects.join("")} className="peers-qr__fg" />
    </svg>
  );
}

function isCapabilityGap(error: unknown): boolean {
  return isMethodUnavailableError(error) || isWsBridgeUnavailableError(error);
}

export function PairingHandoffSection() {
  const { toast } = useToast();
  const [name, setName] = useState("New device");

  const create = useMutation({
    mutationFn: (deviceName: string) => gv.pairing.handoff.create({ name: deviceName }),
  });

  async function copyLink(link: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Link copied", description: "Treat it like a password.", tone: "info" });
    } catch (error) {
      toast({ title: "Copy failed", description: formatError(error), tone: "danger" });
    }
  }

  const result = create.data !== undefined ? readHandoffResult(create.data) : null;
  const qr = result?.deepLink ? generateQrMatrix(result.deepLink) : null;
  const unavailable = create.isError && isCapabilityGap(create.error);

  return (
    <section className="peers-section" aria-label="Pairing hand-off">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Link2 size={14} aria-hidden="true" /> Hand-off link
        </span>
      </div>

      <form
        className="pairing-handoff-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending) create.mutate(name.trim() || "New device");
        }}
      >
        <label className="visually-hidden" htmlFor="handoff-device-name">
          Device name
        </label>
        <input
          id="handoff-device-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Device name"
          disabled={create.isPending}
        />
        <button type="submit" className="peers-btn peers-btn--primary" disabled={create.isPending}>
          {create.isPending ? "Minting…" : "Create hand-off link"}
        </button>
      </form>

      {unavailable && (
        <UnavailableState capability="pairing.handoff.create" description="a scoped pairing link cannot be minted here." />
      )}

      {create.isError && !unavailable && (
        <p className="peers-error" role="alert">
          {formatError(create.error)}
        </p>
      )}

      {result && qr && (
        <div className="pairing-handoff-result">
          <div className="peers-qr-frame">
            <QrSvg qr={qr} />
          </div>
          <p className="peer-detail__note">
            Scan with the new device, or share the link below. It carries a fresh, single-device
            token — treat it like a password.
          </p>
          <div className="pairing-handoff-result__link">
            <code>{result.deepLink}</code>
            <button type="button" className="peers-btn" onClick={() => void copyLink(result.deepLink)}>
              <Copy size={13} aria-hidden="true" /> Copy
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
