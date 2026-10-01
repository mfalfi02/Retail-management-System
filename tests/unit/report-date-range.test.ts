import assert from "node:assert/strict";
import test from "node:test";
import { businessDateParts, businessDateRange, businessDayKey, businessDayStart } from "@/lib/reports/date-range";

test("business day boundary uses Jakarta date around UTC midnight", () => {
  const instant = new Date("2026-09-28T17:15:00.000Z");
  const start = businessDayStart(instant);
  assert.equal(start.toISOString(), "2026-09-28T17:00:00.000Z");
  assert.equal(businessDayKey(instant), "2026-09-29");
  assert.equal(businessDateParts(new Date(start.getTime() + 7 * 60 * 60 * 1000)).day, "29");
});

test("report date range is inclusive in Jakarta and rejects impossible dates", () => {
  assert.equal(businessDateRange("2026-09-29")?.toISOString(), "2026-09-28T17:00:00.000Z");
  assert.equal(businessDateRange("2026-09-29", true)?.toISOString(), "2026-09-29T16:59:59.999Z");
  assert.equal(businessDateRange("2026-02-30"), undefined);
  assert.equal(businessDateRange("2026/09/29"), undefined);
});
