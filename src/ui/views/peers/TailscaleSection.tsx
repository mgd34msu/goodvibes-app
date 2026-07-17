// Tailscale — strictly read-only detection (tailscale.get) renders NOTHING
// while unavailable or not logged in: no nag, no dead button — the daemon
// host simply not having Tailscale installed/signed-in is the overwhelmingly
// common case and deserves silence, not an empty-state card. Once usable
// (available && loggedIn) this shows the connected identity, the last serve
// receipt if any, and the ONE state-changing action here — confirm-gated,
// because it shells out to the real `tailscale serve` command on the
// daemon's host and the daemon never mints its own certificate for it.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { gv } from "../../lib/gv.ts";
import { formatError } from "../../lib/errors.ts";
import { formatRelative } from "../../lib/wire.ts";
import { useToast } from "../../lib/toast.ts";
import { ConfirmSurface } from "../../components/ConfirmSurface.tsx";
import { pairingKeys, readServeRunResult, readTailscale, type TailscaleServeReceipt } from "./pairing-model.ts";

function ReceiptLine({ receipt }: { receipt: TailscaleServeReceipt }) {
  return (
    <p className="peer-detail__note">
      Last serve {formatRelative(receipt.at)} —{" "}
      <span className={receipt.ok ? "badge ok" : "badge bad"}>{receipt.ok ? "ok" : "failed"}</span>
      {receipt.url && (
        <>
          {" · "}
          <code>{receipt.url}</code>
        </>
      )}
      {receipt.detail && <> · {receipt.detail}</>}
    </p>
  );
}

export function TailscaleSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);

  const status = useQuery({
    queryKey: pairingKeys.tailscale,
    queryFn: () => gv.tailscale.get(),
    select: readTailscale,
    retry: false,
  });

  const serve = useMutation({
    mutationFn: () => gv.tailscale.serveRun(),
    onSuccess: async (data) => {
      setConfirming(false);
      await queryClient.invalidateQueries({ queryKey: pairingKeys.tailscale });
      const result = readServeRunResult(data);
      if (result.receipt) {
        toast({
          title: result.receipt.ok ? "tailscale serve ran" : "tailscale serve failed",
          description: result.receipt.detail || result.receipt.url || undefined,
          tone: result.receipt.ok ? "success" : "danger",
        });
      }
    },
    onError: (error: unknown) => {
      setConfirming(false);
      toast({ title: "tailscale serve failed", description: formatError(error), tone: "danger" });
    },
  });

  if (!status.isSuccess || !status.data.available || !status.data.loggedIn) return null;

  const { magicDnsName, lastServe } = status.data;

  return (
    <section className="peers-section" aria-label="Tailscale">
      <div className="section-toolbar">
        <span className="section-toolbar__summary">
          <Radio size={14} aria-hidden="true" /> Tailscale
        </span>
      </div>
      <p className="peer-detail__note">Connected as {magicDnsName || "this tailnet"}.</p>
      {lastServe && <ReceiptLine receipt={lastServe} />}
      <div>
        <button
          type="button"
          className="peers-btn peers-btn--primary"
          onClick={() => setConfirming(true)}
          disabled={serve.isPending}
        >
          {serve.isPending ? "Serving…" : "Serve over tailscale"}
        </button>
      </div>
      <ConfirmSurface
        open={confirming}
        action="Serve over tailscale"
        target={magicDnsName || "this daemon"}
        blastRadius="Runs `tailscale serve` on the daemon's host — the daemon never mints its own certificate."
        confirmLabel={serve.isPending ? "Serving…" : "Serve over tailscale"}
        onConfirm={() => serve.mutate()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
