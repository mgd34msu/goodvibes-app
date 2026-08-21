// The daemon's CURRENT MODEL, over the canonical pair (models.current.get /
// models.current.set).
//
// ── Why this replaced the config path ──────────────────────────────────────
// The app used to read and write the main-chat model as the shared config key
// `provider.model`, because an older SDK pin carried no models.* verbs. This
// contract does, and they are not a rename of the same write:
//
//   - `models.current.set` applies the switch to the LIVE registry (the next
//     turn on every surface this daemon serves) and then persists
//     `provider.model`, reporting whether that write landed as `persisted`.
//     `config.set` only ever did the second half, so a running daemon kept
//     serving turns on the old model until something restarted it.
//   - It VALIDATES: an unknown key is refused MODEL_NOT_FOUND and a provider
//     with no usable credentials PROVIDER_NOT_CONFIGURED, naming the
//     environment variables it looked for. `config.set` accepted any string,
//     so a typo became a daemon-wide default nothing could route.
//   - `models.current.get` is `authenticated`, while `config.get` is `admin`.
//     Reading which model is in force no longer needs an admin principal.
//
// So there is one path, not two: nothing in this app writes `provider.model`
// through `config.set` any more.
//
// `model: null` is a real state (nothing is selected) and is deliberately
// distinguishable from a selection whose provider has lost its credentials.
// A picker has to tell those apart.

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { gv } from "./gv.ts";
import { queryKeys } from "./queries.ts";
import { errorCode, errorStatus, formatError, isMethodUnavailableError } from "./errors.ts";
import { asArray, asRecord, firstString } from "./wire.ts";

/** Under the ["providers"] prefix so the `providers` SSE domain refreshes it. */
export const currentModelKey = [...queryKeys.providers, "current-model"] as const;

/** One authentication route the daemon can reach this model's provider by. */
export interface CurrentModelRoute {
  route: string;
  label: string;
  configured: boolean;
  usable: boolean;
  /** healthy | expiring | expired | pending | unconfigured, verbatim. */
  freshness: string;
  detail: string;
  envVars: string[];
  repairHints: string[];
}

export interface CurrentModel {
  /** "" when nothing is selected, which is a state and not a failure. */
  registryKey: string;
  provider: string;
  id: string;
  /** True when the selected model's provider actually has usable credentials. */
  configured: boolean;
  /** env | secrets | subscription | anonymous; "" when nothing is configured. */
  configuredVia: string;
  routes: CurrentModelRoute[];
  /** models.current.set only: whether the settings write landed. */
  persisted: boolean | undefined;
}

function readStringArray(value: unknown): string[] {
  return asArray(value).filter((entry): entry is string => typeof entry === "string");
}

export function parseCurrentModel(value: unknown): CurrentModel {
  const record = asRecord(value);
  const model = asRecord(record["model"]);
  const persisted = record["persisted"];
  return {
    registryKey: firstString(model, ["registryKey"]),
    provider: firstString(model, ["provider"]),
    id: firstString(model, ["id"]),
    configured: record["configured"] === true,
    configuredVia: firstString(record, ["configuredVia"]),
    routes: asArray(record["routes"]).map((raw) => {
      const route = asRecord(raw);
      return {
        route: firstString(route, ["route"]),
        label: firstString(route, ["label"]),
        configured: route["configured"] === true,
        usable: route["usable"] === true,
        freshness: firstString(route, ["freshness"]),
        detail: firstString(route, ["detail"]),
        envVars: readStringArray(route["envVars"]),
        repairHints: readStringArray(route["repairHints"]),
      };
    }),
    persisted: typeof persisted === "boolean" ? persisted : undefined,
  };
}

/** True when the daemon reports no selection at all (as opposed to a broken one). */
export function hasNoModelSelected(model: CurrentModel): boolean {
  return model.registryKey === "";
}

export function useCurrentModel(enabled = true): UseQueryResult<unknown> {
  return useQuery({
    queryKey: currentModelKey,
    queryFn: () => gv.invoke("models.current.get"),
    retry: false,
    enabled,
  });
}

/** Switch the daemon's current model. Accepts the registry key models.list returns. */
export function setCurrentModel(registryKey: string): Promise<unknown> {
  return gv.invoke("models.current.set", { body: { registryKey } });
}

export interface CurrentModelRefusal {
  kind: "model-not-found" | "provider-not-configured" | "unavailable" | "admin-required";
  title: string;
  description: string;
}

/**
 * Triage a models.current.set rejection.
 *
 * MODEL_NOT_FOUND and PROVIDER_NOT_CONFIGURED are separated because the fix is
 * different and the daemon went to the trouble of distinguishing them: one is
 * "that key is not in the registry", the other is "the key is fine, the
 * provider has no credentials", with the environment variables it looked for
 * carried through so the reader does not have to guess which one to set.
 */
export function currentModelRefusal(error: unknown): CurrentModelRefusal | null {
  if (!error) return null;
  const code = errorCode(error);
  if (code === "MODEL_NOT_FOUND") {
    return {
      kind: "model-not-found",
      title: "That model is not in the daemon's registry",
      description: formatError(error),
    };
  }
  if (code === "PROVIDER_NOT_CONFIGURED") {
    return {
      kind: "provider-not-configured",
      title: "That model's provider has no usable credentials",
      description: formatError(error),
    };
  }
  if (isMethodUnavailableError(error)) {
    return {
      kind: "unavailable",
      title: "This daemon does not serve model switching",
      description: "models.current.set is absent from the connected daemon; set provider.model with the TUI instead.",
    };
  }
  const status = errorStatus(error);
  if (status === 401 || status === 403) {
    return {
      kind: "admin-required",
      title: "Not permitted",
      description: "The connected principal may not switch the daemon's model.",
    };
  }
  return null;
}

/** Post-switch line: the switch is live either way, `persisted` is about restart survival. */
export function describeSwitch(result: CurrentModel): string {
  if (result.persisted === false) {
    return "Live on the next turn everywhere, but the settings write failed, so a daemon restart reverts it.";
  }
  return "Live on the next turn for every surface this daemon serves, and persisted across restarts.";
}
