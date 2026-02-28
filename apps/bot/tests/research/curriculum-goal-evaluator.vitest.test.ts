import { describe, expect, it } from "vitest";
import { classifyCurriculumGoal, evaluateCurriculumGoalSuccess, IronToolsPipelineScoreTracker } from "../../src/research/evaluators/curriculum-goal-evaluator.js";
import type { ActionStep } from "../../src/actions/executor.js";

describe("curriculum-goal-evaluator", () =>
{
    it("classifies shelter and iron-tools-pipeline curriculum goals", () =>
    {
        expect(classifyCurriculumGoal("build a wooden shelter before nightfall")).toBe("shelter");
        expect(classifyCurriculumGoal("Finalize_iron_tools_pipeline now")).toBe("iron-tools-pipeline");
        expect(classifyCurriculumGoal("collect flowers")).toBeNull();
    });

    it("marks shelter goals successful when shelter build step succeeds", () =>
    {
        const steps: ActionStep[] = [
            { id: "step-1", action: "mine", params: { item: "oak_log", count: 16 }, description: "Get logs" },
            { id: "step-2", action: "build", params: { structure: "shelter" }, description: "Build shelter" }
        ];

        const results = [
            { id: "step-1", status: "success" },
            { id: "step-2", status: "success" }
        ];

        expect(evaluateCurriculumGoalSuccess("!goal build a wooden shelter", steps, results, [])).toBe(true);
    });

    it("marks iron tools pipeline successful when iron_pickaxe is present", () =>
    {
        const inventory = [
            { name: "iron_pickaxe", count: 1 },
            { name: "iron_shovel", count: 1 },
            { name: "iron_sword", count: 1 },
            { name: "iron_axe", count: 1 }
        ];

        expect(evaluateCurriculumGoalSuccess("iron tools pipeline", [], [], inventory)).toBe(true);
        expect(evaluateCurriculumGoalSuccess("iron tools pipeline", [], [], [{ name: "iron_shovel", count: 1 }])).toBe(false);
    });

    it("tracks iron tools pipeline milestones as one-time points", () =>
    {
        const tracker = new IronToolsPipelineScoreTracker();

        const first = tracker.observe({
            inventoryItems: [
                { name: "oak_log", count: 3 },
                { name: "oak_planks", count: 12 },
                { name: "stick", count: 6 }
            ],
            equippedItemName: "wooden_pickaxe"
        });

        expect(first.map((m) => m.id)).toEqual(["step-1", "step-2", "step-3", "step-4"]);
        expect(tracker.points).toBe(4);

        const second = tracker.observe({
            inventoryItems: [
                { name: "oak_log", count: 99 },
                { name: "oak_planks", count: 99 },
                { name: "stick", count: 99 },
                { name: "cobblestone", count: 11 },
                { name: "coal", count: 2 },
                { name: "raw_iron", count: 9 },
                { name: "iron_ingot", count: 9 },
                { name: "iron_pickaxe", count: 1 }
            ],
            equippedItemName: "stone_pickaxe"
        });

        expect(second.map((m) => m.id)).toEqual(["step-5", "step-6", "step-7", "step-8", "step-9", "step-10"]);
        expect(tracker.points).toBe(10);

        const third = tracker.observe({
            inventoryItems: [{ name: "iron_ingot", count: 500 }],
            equippedItemName: "stone_pickaxe"
        });

        expect(third).toHaveLength(0);
        expect(tracker.points).toBe(10);
    });

    it("resets milestone points between sessions", () =>
    {
        const tracker = new IronToolsPipelineScoreTracker();
        tracker.observe({ inventoryItems: [{ name: "oak_log", count: 3 }], equippedItemName: null });
        expect(tracker.points).toBe(1);

        tracker.reset();
        expect(tracker.points).toBe(0);
    });

});