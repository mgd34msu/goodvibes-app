// Generator invariants for the device capability snapshot, and the one thing
// the snapshot exists to carry: the typed inputFields the wire does not send.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadCatalog, renderModule, OUT_PATH } from "../scripts/generate-device-capabilities.ts";
import {
  DEVICE_CAPABILITY_CATALOG,
  DEVICE_CAPABILITY_CONTRACT_VERSION,
} from "../src/ui/views/settings/device-capabilities.generated.ts";

describe("generate-device-capabilities", () => {
  test("checked-in output matches a fresh render (no drift)", async () => {
    expect(readFileSync(OUT_PATH, "utf8")).toBe(renderModule(await loadCatalog()));
  });

  test("the snapshot is the installed SDK's catalog, entry for entry", async () => {
    const snapshot = await loadCatalog();
    expect(DEVICE_CAPABILITY_CATALOG.map((entry) => entry.id)).toEqual(
      snapshot.entries.map((entry) => entry.id),
    );
    expect(DEVICE_CAPABILITY_CONTRACT_VERSION).toBe(snapshot.contractVersion);
  });

  test("every capability carries its typed input fields", () => {
    // This is the whole reason the file is generated: devices.nodes.list
    // describes capabilities WITHOUT inputFields, so a request form built from
    // the wire alone could not ask for a notification's title or a photo's
    // pixel cap.
    const notify = DEVICE_CAPABILITY_CATALOG.find((entry) => entry.id === "device.command.notify");
    expect(notify?.inputFields.map((field) => field.name)).toContain("title");
    const camera = DEVICE_CAPABILITY_CATALOG.find((entry) => entry.id === "device.camera.rear.capture");
    expect(camera?.inputFields.find((field) => field.name === "maxWidth")?.type).toBe("number");
    expect(camera?.inputFields.find((field) => field.name === "maxWidth")?.required).toBe(false);
  });

  test("only a capture retains an artifact, and every capture does", () => {
    // artifactKind describes the CLASS of data a capability yields, not whether
    // anything is kept: a location fix is 'geo' and a clipboard read is 'text',
    // and neither retains a file. Retention follows `effect === "capture"`, and
    // that is what the captures list can be trusted to hold.
    for (const entry of DEVICE_CAPABILITY_CATALOG) {
      expect(entry.producesArtifact).toBe(entry.effect === "capture");
      if (entry.effect === "actuate") expect(entry.artifactKind).toBe("none");
    }
  });

  test("the module is browser-legal: it imports nothing at all", () => {
    // scripts/check-boundaries.ts forbids src/ui importing an SDK platform
    // subpath, which is why the catalog is snapshotted here rather than
    // imported. A generated module with no imports cannot violate that rule
    // however the SDK is repackaged.
    const text = readFileSync(OUT_PATH, "utf8");
    expect(text).not.toMatch(/^import\s/m);
    expect(text).not.toMatch(/from\s+["']@pellux/);
  });
});
