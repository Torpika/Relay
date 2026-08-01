import { describe, expect, it } from "vitest";

import { settleWithConcurrency } from "@/orchestration/parallel";

describe("settleWithConcurrency", () => {
  it("never exceeds the configured concurrency and preserves result order", async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await settleWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return value * 2;
    });

    expect(maximumActive).toBe(2);
    expect(results.map((result) => result.value)).toEqual([2, 4, 6, 8, 10]);
  });

  it("settles independent failures without preventing remaining tasks", async () => {
    const results = await settleWithConcurrency([1, 2, 3], 2, async (value) => {
      if (value === 2) {
        throw new Error("failed");
      }

      return value;
    });

    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
