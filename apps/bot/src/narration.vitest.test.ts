import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PlanNarrator } from "./narration.js";

describe("PlanNarrator", () =>
{
    beforeEach(() =>
    {
        vi.useRealTimers();
    });

    afterEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllTimers();
    });

    it("limits narration length and removes extra whitespace", () =>
    {
        const narrator = new PlanNarrator({ maxLength: 40 });
        const intent = "  Collect wood, craft planks, build shelter near spawn with a roof and walls.  ";
        const summary = narrator.maybeNarrate({ intent }) ?? "";

        expect(summary.length).toBeLessThanOrEqual(40);
        expect(summary.endsWith("...")).toBe(true);
        expect(summary).not.toContain("  ");
    });

    it("rate limits narration to one message per second", () =>
    {
        vi.useFakeTimers();
        const narrator = new PlanNarrator({ minIntervalMs: 1000 });

        const first = narrator.maybeNarrate({ intent: "first" }, 0);
        const blocked = narrator.maybeNarrate({ intent: "second" }, 500);

        vi.advanceTimersByTime(1000);
        const allowed = narrator.maybeNarrate({ intent: "third" }, 1500);

        expect(first).toBe("first");
        expect(blocked).toBeNull();
        expect(allowed).toBe("third");
    });
});