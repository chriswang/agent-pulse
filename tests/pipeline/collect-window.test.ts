import { describe, expect, it } from "vitest";
import type { CollectedSignal } from "../../src/domain/types.js";
import { filterSignalsToWindow } from "../../src/pipeline/collect.js";

describe("historical collection window", () => {
  it("keeps only signals inside the bounded lookback window", () => {
    const items = [
      signal("inside", "2026-07-01T00:00:00.000Z"),
      signal("boundary", "2026-06-17T00:00:00.000Z"),
      signal("too-old", "2026-06-16T23:59:59.000Z"),
      signal("just-future", "2026-07-18T00:00:00.001Z"),
      signal("future", "2026-07-19T00:00:01.000Z"),
    ];

    expect(
      filterSignalsToWindow(items, "2026-06-17T00:00:00.000Z", "2026-07-18T00:00:00.000Z").map(
        (item) => item.title,
      ),
    ).toEqual(["inside", "boundary"]);
  });

  it("does not filter ordinary incremental collection", () => {
    const items = [signal("old-but-incremental", "2025-01-01T00:00:00.000Z")];
    expect(filterSignalsToWindow(items)).toBe(items);
  });
});

function signal(title: string, publishedAt: string): CollectedSignal {
  return {
    url: `https://example.com/${title}`,
    title,
    summary: title,
    language: "zh-CN",
    publishedAt,
    category: "policy",
    tags: [],
    metrics: {},
    rawMeta: {},
  };
}
