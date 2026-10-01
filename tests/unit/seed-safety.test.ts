import assert from "node:assert/strict";
import test from "node:test";
import { assertDemoSeedEnvironment } from "@/lib/services/seed-safety";

test("development seed refuses to run in production", () => {
  assert.doesNotThrow(() => assertDemoSeedEnvironment("development"));
  assert.doesNotThrow(() => assertDemoSeedEnvironment(undefined));
  assert.throws(() => assertDemoSeedEnvironment("production"), /disabled in production/);
});
