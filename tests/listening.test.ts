import { describe, expect, it } from "vitest";
import {
  listeningTotals,
  recordListening,
  type ListeningDays,
} from "../src/listening";
describe("local listening history", () => {
  it("splits listening over the year boundary and rejects impossible samples", () => {
    const days: ListeningDays = {};
    const ending = new Date(2026, 0, 1, 0, 0, 5);
    recordListening(days, "a", 10, ending);
    expect(days["2025-12-31"].a).toBe(5);
    expect(days["2026-01-01"].a).toBe(5);
    recordListening(days, "a", 3600, ending);
    recordListening(days, "a", -3, ending);
    expect(
      listeningTotals(days, new Date(2026, 0, 1), new Date(2027, 0, 1)),
    ).toEqual({ a: 5 });
    expect(
      listeningTotals(days, new Date(2025, 0, 1), new Date(2026, 0, 1)),
    ).toEqual({ a: 5 });
  });
});
