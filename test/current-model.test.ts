// Pure-logic coverage for src/ui/lib/current-model.ts and the main-target half
// of src/ui/views/providers/model-catalog.ts, after the migration from
// config.get/config.set of `provider.model` to models.current.get/set.
//
// The payloads are VERBATIM captures from a locally spawned daemon
// (@pellux/goodvibes-daemon 1.28.19 / sdk 2.0.17), including the MODEL_NOT_FOUND
// refusal a bogus registry key actually produced.

import { describe, expect, test } from "bun:test";
import { HttpError } from "../src/ui/lib/http.ts";
import {
  currentModelRefusal,
  describeSwitch,
  hasNoModelSelected,
  parseCurrentModel,
} from "../src/ui/lib/current-model.ts";
import { buildTargetWriteEntries, qualifiedRegistryKey, readTargetRouting } from "../src/ui/views/providers/model-catalog.ts";

const LIVE_CURRENT_MODEL = {
  model: { registryKey: "openrouter:openrouter/free", provider: "openrouter", id: "openrouter/free" },
  configured: true,
  configuredVia: "env",
  routes: [
    {
      route: "api-key",
      label: "Ambient API key",
      configured: true,
      usable: true,
      freshness: "healthy",
      detail: "Environment-backed API key is available.",
      envVars: ["OPENROUTER_API_KEY"],
      secretKeys: ["OPENROUTER_API_KEY"],
      repairHints: ["Set OPENROUTER_API_KEY or store one of those keys in /secrets."],
    },
    {
      route: "secret-ref",
      label: "SecretRef-backed API key",
      configured: false,
      usable: false,
      freshness: "unconfigured",
      detail: "No SecretRef-backed credential is configured.",
      secretKeys: ["OPENROUTER_API_KEY"],
      repairHints: ["Use /secrets link <KEY> <secret-ref> to attach Bitwarden, Vaultwarden, BWS, or another supported SecretRef."],
    },
  ],
};

function gatewayError(status: number, code: string, message: string): HttpError {
  return new HttpError(status, "/api/models/current", JSON.stringify({ error: message, code, status }));
}

describe("parseCurrentModel", () => {
  test("reads the live payload", () => {
    const model = parseCurrentModel(LIVE_CURRENT_MODEL);
    expect(model.registryKey).toBe("openrouter:openrouter/free");
    expect(model.provider).toBe("openrouter");
    expect(model.id).toBe("openrouter/free");
    expect(model.configured).toBe(true);
    expect(model.configuredVia).toBe("env");
    expect(model.routes).toHaveLength(2);
    expect(model.routes[0]?.envVars).toEqual(["OPENROUTER_API_KEY"]);
    expect(model.routes[0]?.repairHints[0]).toContain("OPENROUTER_API_KEY");
  });

  test("model:null is no selection, which is a state and not an error", () => {
    const model = parseCurrentModel({ model: null, configured: false });
    expect(hasNoModelSelected(model)).toBe(true);
    expect(model.configured).toBe(false);
  });

  test("a selection whose provider lost its credentials is NOT no-selection", () => {
    const model = parseCurrentModel({ ...LIVE_CURRENT_MODEL, configured: false, configuredVia: undefined });
    expect(hasNoModelSelected(model)).toBe(false);
    expect(model.registryKey).toBe("openrouter:openrouter/free");
    expect(model.configured).toBe(false);
  });

  test("persisted is only read off a set response", () => {
    expect(parseCurrentModel(LIVE_CURRENT_MODEL).persisted).toBeUndefined();
    expect(parseCurrentModel({ ...LIVE_CURRENT_MODEL, persisted: false }).persisted).toBe(false);
  });

  test("an empty payload does not throw", () => {
    const model = parseCurrentModel({});
    expect(model.registryKey).toBe("");
    expect(model.routes).toEqual([]);
  });
});

describe("describeSwitch", () => {
  test("a persisted switch says it survives a restart", () => {
    const line = describeSwitch(parseCurrentModel({ ...LIVE_CURRENT_MODEL, persisted: true }));
    expect(line).toContain("persisted across restarts");
  });

  test("persisted:false says the switch is live but will revert", () => {
    // The switch DID apply to the live registry; only the settings write failed,
    // and conflating the two would report a failure that did not happen.
    const line = describeSwitch(parseCurrentModel({ ...LIVE_CURRENT_MODEL, persisted: false }));
    expect(line).toContain("Live on the next turn");
    expect(line).toContain("restart reverts it");
  });
});

describe("currentModelRefusal", () => {
  test("MODEL_NOT_FOUND is reported as an unknown key", () => {
    // The exact refusal a live daemon gave for registryKey "definitely:not-a-real-model".
    const refusal = currentModelRefusal(
      gatewayError(400, "MODEL_NOT_FOUND", "Model 'definitely:not-a-real-model' not in registry"),
    );
    expect(refusal?.kind).toBe("model-not-found");
    expect(refusal?.description).toContain("not in registry");
  });

  test("PROVIDER_NOT_CONFIGURED is a different fix and says so", () => {
    const refusal = currentModelRefusal(
      gatewayError(409, "PROVIDER_NOT_CONFIGURED", "Provider 'anthropic' not configured: set one of [ANTHROPIC_API_KEY]"),
    );
    expect(refusal?.kind).toBe("provider-not-configured");
    expect(refusal?.description).toContain("ANTHROPIC_API_KEY");
  });

  test("a daemon without the verb is unavailable, not a bad key", () => {
    expect(currentModelRefusal(gatewayError(404, "METHOD_NOT_FOUND", "Unknown gateway method"))?.kind).toBe(
      "unavailable",
    );
  });

  test("an unclassified failure falls through", () => {
    expect(currentModelRefusal(gatewayError(500, "INTERNAL", "boom"))).toBeNull();
    expect(currentModelRefusal(null)).toBeNull();
  });
});

describe("readTargetRouting: main comes off models.current.get, not config", () => {
  test("reads the live current-model payload", () => {
    const routing = readTargetRouting("main", { provider: { model: "stale:from-config" } }, LIVE_CURRENT_MODEL);
    expect(routing.provider).toBe("openrouter");
    expect(routing.model).toBe("openrouter/free");
    expect(routing.unset).toBe(false);
    // The config payload is deliberately ignored for this target: a stale
    // provider.model must never win over the live registry.
    expect(routing.model).not.toBe("from-config");
  });

  test("no selection reads as unset", () => {
    const routing = readTargetRouting("main", {}, { model: null, configured: false });
    expect(routing.unset).toBe(true);
    expect(routing.provider).toBe("");
  });

  test("a selection with no usable credentials is set, with a note saying why", () => {
    const routing = readTargetRouting("main", {}, { ...LIVE_CURRENT_MODEL, configured: false });
    expect(routing.unset).toBe(false);
    expect(routing.configuredNote).toContain("no usable credentials");
  });

  test("the config-backed targets still read from config", () => {
    const config = { helper: { globalProvider: "groq", globalModel: "llama-3.1-8b", enabled: true } };
    const routing = readTargetRouting("helper", config, LIVE_CURRENT_MODEL);
    expect(routing.provider).toBe("groq");
    expect(routing.model).toBe("llama-3.1-8b");
    expect(routing.enabled).toBe(true);
  });
});

describe("buildTargetWriteEntries no longer writes the current model", () => {
  test("no config-backed target writes provider.model", () => {
    for (const target of ["helper", "tool", "tts", "embeddings"] as const) {
      const keys = buildTargetWriteEntries(target, "groq", "llama-3.1-8b").map(([key]) => key);
      expect(keys).not.toContain("provider.model");
    }
  });

  test("helper/tool still write their own keys and enable flag", () => {
    expect(buildTargetWriteEntries("helper", "groq", "llama-3.1-8b")).toEqual([
      ["helper.globalProvider", "groq"],
      ["helper.globalModel", "llama-3.1-8b"],
      ["helper.enabled", true],
    ]);
  });
});

describe("qualifiedRegistryKey", () => {
  test("qualifies a bare model id with its provider", () => {
    expect(qualifiedRegistryKey("openrouter", "openrouter/free")).toBe("openrouter:openrouter/free");
  });

  test("leaves an already-qualified key alone", () => {
    expect(qualifiedRegistryKey("openrouter", "openrouter:openrouter/free")).toBe("openrouter:openrouter/free");
  });
});
