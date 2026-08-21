// Payments: the seven `payments.*` verbs, in one view.
//
// ── Why a view of its own, and why it sits in Assistant ──────────────────────
//
// The webui puts card entry inside Settings → Payments, one panel above the
// budget and address config keys, and that is the right shape for what it has:
// cards are the only payments surface it built, and a card on file reads as a
// setting. This app is wiring four things, and three of them are not settings.
// A budget posture is today's state, a purchase list is a ledger, and a
// checkout is an operation with steps and outcomes. Putting a ledger behind a
// settings modal is how it stops being read.
//
// So this follows the app's own precedent instead: Dates got a view because
// the occasions domain is a domain, not a preference, and payments is the same
// case. It sits in Assistant next to Dates, Check-in and Personal Ops, which is
// where the things the daemon does ON THE OWNER'S BEHALF live — and a purchase
// the daemon made while he was not looking is exactly that.
//
// The config half of payments (limits, windows, addresses, cvvHandling) stays
// where every other config key in this app lives, in Settings. This view reads
// and acts; it does not duplicate the settings form.
//
// The sections are ordered by what has to be true before the next one can be:
// a card, then the budget it draws on, then a checkout that spends it, then
// what was spent.

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { registerCommand, unregisterCommand } from "../../lib/commands.ts";
import { queryKeys } from "../../lib/queries.ts";
import { CardsPanel } from "./CardsPanel.tsx";
import { BudgetPanel } from "./BudgetPanel.tsx";
import { CheckoutPanel } from "./CheckoutPanel.tsx";
import { PurchasesPanel } from "./PurchasesPanel.tsx";

export function PaymentsView() {
  const queryClient = useQueryClient();

  useEffect(() => {
    registerCommand({
      id: "payments.refresh",
      title: "Payments: Refresh Everything",
      group: "assistant",
      keywords: ["payments", "cards", "budget", "purchases", "checkout", "spending", "refresh"],
      run: () => void queryClient.invalidateQueries({ queryKey: queryKeys.payments }),
    });
    return () => unregisterCommand("payments.refresh");
  }, [queryClient]);

  // No useViewVisible here, unlike Dates. This view is keepAlive:false, so the
  // shell unmounts it when it is hidden and its polls stop with it; a
  // visibility gate would be a second mechanism answering a question the mount
  // lifecycle already answers. The keep-alive choice is itself load-bearing —
  // see CARD_STATE_IS_NOT_KEPT_ALIVE in payments-data.ts.
  return (
    <div className="payments-view">
      <CardsPanel />
      <BudgetPanel />
      <CheckoutPanel />
      <PurchasesPanel />
    </div>
  );
}
