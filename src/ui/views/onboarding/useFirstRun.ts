// First-run auto-show decision (docs/UX.md §5 + FEATURES §22): the onboarding
// overlay appears automatically ONLY when the daemon was just spawned by this
// app for the first time, or when no provider/model is configured. A machine
// that already runs the TUI/agent with a configured provider sails straight
// into the workspace and the flag is set silently — zero friction.

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AppHealth } from "../../../shared/app-contract.ts";
import { queryKeys } from "../../lib/queries.ts";
import { gv } from "../../lib/gv.ts";
import { configuredModelFrom, isOnboarded, providerOptionsFrom, setOnboarded } from "./checks.ts";

export function useFirstRunOnboarding(health: AppHealth | undefined, onAutoOpen: () => void): void {
  const queryClient = useQueryClient();
  const decidedRef = useRef(false);

  useEffect(() => {
    if (decidedRef.current) return;
    const mode = health?.daemon.mode;
    if (mode !== "external" && mode !== "spawned") return; // wait for a live daemon
    decidedRef.current = true;

    if (isOnboarded()) return;
    if (mode === "spawned") {
      // Fresh daemon spawned by us — first time on this machine.
      onAutoOpen();
      return;
    }

    void (async () => {
      try {
        const [providers, config] = await Promise.all([
          queryClient.fetchQuery({ queryKey: queryKeys.providers, queryFn: () => gv.providers.list() }),
          queryClient.fetchQuery({ queryKey: queryKeys.configAll, queryFn: () => gv.config.get() }),
        ]);
        const ready = providerOptionsFrom(providers).length > 0 && configuredModelFrom(config) !== "";
        if (ready) setOnboarded(); // inferred from existing TUI/agent setup — never ask
        else onAutoOpen();
      } catch {
        onAutoOpen(); // cannot verify → show the checks with their honest failures
      }
    })();
  }, [health, onAutoOpen, queryClient]);
}
