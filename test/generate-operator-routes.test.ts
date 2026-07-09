// Generator invariants for the operator route snapshot: deterministic order,
// the exact row shape both UI agents depend on, and WS-only flagging.

import { describe, expect, test } from "bun:test";
import { loadContract, toRows, renderModule, OUT_PATH } from "../scripts/generate-operator-routes.ts";
import { readFileSync } from "node:fs";

describe("generate-operator-routes", () => {
  test("rows are sorted, complete, and flag WS-only methods correctly", async () => {
    const contract = await loadContract();
    const rows = toRows(contract);

    expect(rows.length).toBe(contract.operator.methods.length);
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([...ids].sort());

    for (const row of rows) {
      // ws=true is reserved for WS-only methods: no HTTP route to fall back to.
      if (row.ws) {
        expect(row.httpMethod).toBeNull();
        expect(row.path).toBeNull();
      } else {
        expect(row.httpMethod).not.toBeNull();
        expect(row.path).not.toBeNull();
      }
    }

    // Known anchors from the installed contract (sdk 1.3.1).
    const approve = rows.find((r) => r.id === "approvals.approve");
    expect(approve?.path).toBe("/api/approvals/{approvalId}/approve");
    expect(rows.find((r) => r.id === "fleet.snapshot")?.ws).toBe(true);
    // Fleet archive verbs (contract 1.6, sdk 1.6.1) — ws-only like the rest of fleet.*.
    for (const id of ["fleet.archive", "fleet.unarchive", "fleet.archiveFinished", "fleet.archived.list"]) {
      expect(rows.find((r) => r.id === id)?.ws).toBe(true);
    }
  });

  test("checked-in output matches a fresh render (no drift)", async () => {
    const contract = await loadContract();
    expect(readFileSync(OUT_PATH, "utf8")).toBe(renderModule(contract, toRows(contract)));
  });
});
