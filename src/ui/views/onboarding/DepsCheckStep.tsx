// Dependency-check step (docs/GAPS.md §22 row 6, PARTIAL → closed). The
// three live daemon/auth/provider checks stay exactly as they were — this is
// a fourth, purely additive, skippable section (same doctrine as
// PermissionsStep/ImportStep/PairingStep) that surfaces the one thing those
// three checks never covered: gtk/webkit/tooling dependencies. Backed by
// GET /app/local/deps (src/bun/local-tools.ts) — Bun.which / ldconfig -p
// probes, honest {ok: null} on non-Linux platforms where a check does not
// apply. Re-runnable any time via the same "Retry" affordance the three
// live checks use.

import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Wrench } from "lucide-react";
import { appJson } from "../../lib/http.ts";
import { errorStatus, formatError } from "../../lib/errors.ts";
import { CONTRACT_STATE_GLYPHS, type ContractStatusState } from "../../lib/generated/presentation-tokens.ts";
import { UnavailableState } from "../../components/feedback.tsx";
import { onboardingKeys } from "./keys.ts";

interface DepCheck {
  id: string;
  label: string;
  ok: boolean | null;
  detail: string;
}

const FIX_HINTS: Record<string, string> = {
  webkit2gtk: "Install libwebkit2gtk (e.g. `sudo pacman -S webkit2gtk-4.1` on Arch, `sudo apt install libwebkit2gtk-4.1-0` on Debian/Ubuntu).",
  gtk3: "Install GTK 3 (e.g. `sudo pacman -S gtk3` on Arch, `sudo apt install libgtk-3-0` on Debian/Ubuntu).",
  "notify-send": "Install libnotify (e.g. `sudo pacman -S libnotify` on Arch, `sudo apt install libnotify-bin` on Debian/Ubuntu) for desktop notifications.",
  git: "Install git (e.g. `sudo pacman -S git`, `sudo apt install git`) — needed for the Coding/Dev views.",
  setsid: "Install util-linux (usually already present) for session-leader process spawning.",
  script: "Install util-linux's `script` (PTY capture) — usually preinstalled on Linux/macOS.",
};

function stateFor(ok: boolean | null): ContractStatusState {
  if (ok === null) return "info";
  return ok ? "good" : "bad";
}

async function fetchDeps(): Promise<{ checks: DepCheck[] }> {
  return appJson<{ checks: DepCheck[] }>("/app/local/deps");
}

export function DepsCheckStep() {
  // Dependency checks are app-local (Bun.which/ldconfig), independent of the
  // daemon connection — unlike PermissionsStep/ReasoningEffortStep, this
  // needs no `daemonUp` gate.
  const deps = useQuery({
    queryKey: onboardingKeys.deps,
    queryFn: fetchDeps,
    retry: false,
  });

  const unavailable = deps.isError && (errorStatus(deps.error) === 404 || errorStatus(deps.error) === 501);

  return (
    <div className="onboarding-section">
      <h3 className="onboarding-section__title">
        <Wrench size={14} aria-hidden="true" /> System dependencies
      </h3>
      <p className="onboarding-section__hint">
        WebKit/GTK, notifications, and the small tools GoodVibes shells out to. Every failure names a fix.
      </p>

      {deps.isPending && (
        <p className="onboarding-section__hint">
          <RefreshCw size={12} className="spinning" aria-hidden="true" /> Checking…
        </p>
      )}

      {deps.isError && (
        unavailable ? (
          <UnavailableState capability="/app/local/deps" description="dependency checks are not part of this build." />
        ) : (
          <p className="onboarding-fix__error">{formatError(deps.error)}</p>
        )
      )}

      {deps.isSuccess && (
        <ol className="onboarding-checks">
          {deps.data.checks.map((check) => {
            const state = stateFor(check.ok);
            return (
              <li key={check.id} className={`onboarding-check onboarding-check--${check.ok === false ? "fail" : check.ok ? "pass" : "unavailable"}`}>
                <span className="onboarding-check__glyph" data-state={state} aria-hidden="true">
                  {CONTRACT_STATE_GLYPHS[state]}
                </span>
                <div className="onboarding-check__body">
                  <div className="onboarding-check__head">
                    <span className="onboarding-check__title">{check.label}</span>
                    <span className="onboarding-check__summary">{check.detail}</span>
                  </div>
                  {check.ok === false && FIX_HINTS[check.id] && (
                    <p className="onboarding-check__detail">{FIX_HINTS[check.id]}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <button type="button" className="onboarding-fix__action" onClick={() => void deps.refetch()} disabled={deps.isFetching}>
        {deps.isFetching ? "Checking…" : "Re-check dependencies"}
      </button>
    </div>
  );
}
