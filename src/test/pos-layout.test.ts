import { describe, it, expect } from "vitest";
import { isLandscapePOSLayout } from "@/lib/pos-layout";

/**
 * Pure-function coverage for the Task 2 bug fix: at exactly 768px wide in
 * portrait orientation, the POS previously kept the narrow desktop side-cart
 * (bare `md:` breakpoint only looks at width) instead of falling back to the
 * mobile-style full-width cart dialog. These are the representative
 * width/height combinations a later real-browser QA pass re-verifies —
 * see WORKLOG.md.
 */
describe("isLandscapePOSLayout", () => {
  it("768x1024 (the reported bug: portrait at exactly the old md: breakpoint) is NOT landscape", () => {
    expect(isLandscapePOSLayout(768, 1024)).toBe(false);
  });

  it("820x1180 (a common iPad-class portrait tablet) is NOT landscape", () => {
    expect(isLandscapePOSLayout(820, 1180)).toBe(false);
  });

  it("1024x768 (a landscape POS terminal) IS landscape", () => {
    expect(isLandscapePOSLayout(1024, 768)).toBe(true);
  });

  it("1366x768 (a landscape POS terminal) IS landscape", () => {
    expect(isLandscapePOSLayout(1366, 768)).toBe(true);
  });

  it("a narrow portrait phone (390x844) is NOT landscape", () => {
    expect(isLandscapePOSLayout(390, 844)).toBe(false);
  });

  it("an exact square at/above the width floor counts as landscape (width >= height, not strictly greater)", () => {
    expect(isLandscapePOSLayout(800, 800)).toBe(true);
  });

  it("a landscape shape below the 768px width floor is still NOT landscape POS layout (too small for the side panel regardless of orientation)", () => {
    expect(isLandscapePOSLayout(667, 375)).toBe(false);
  });

  it("a landscape tablet just above the floor (1024x800, unusually tall bezel) IS landscape", () => {
    expect(isLandscapePOSLayout(1024, 800)).toBe(true);
  });
});
