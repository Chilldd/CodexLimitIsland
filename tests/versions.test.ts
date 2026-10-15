import { test } from "vitest";
import assert from "node:assert/strict";
import { assertVersionConsistency } from "../scripts/check-versions";

test("version gate rejects drift or missing data from each source", () => {
  const matching = { npm: "0.1.0", cargo: "0.1.0", tauri: "0.1.0" };
  assert.doesNotThrow(() => assertVersionConsistency(matching));
  for (const source of ["npm", "cargo", "tauri"] as const) {
    assert.throws(() => assertVersionConsistency({ ...matching, [source]: "0.2.0" }), /版本不一致/);
    assert.throws(() => assertVersionConsistency({ ...matching, [source]: undefined }), /版本缺失/);
    const missing: Partial<typeof matching> = { ...matching };
    delete missing[source];
    assert.throws(() => assertVersionConsistency(missing), /版本缺失/);
  }
});
