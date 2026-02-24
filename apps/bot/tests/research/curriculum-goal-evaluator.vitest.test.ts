import { describe, expect, it } from "vitest";
import { classifyCurriculumGoal, evaluateCurriculumGoalSuccess } from "../../src/research/evaluators/curriculum-goal-evaluator.js";
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

    it("marks iron tools pipeline successful only when all required tools are present", () =>
    {
        const inventory = [
            { name: "iron_pickaxe", count: 1 },
            { name: "iron_shovel", count: 1 },
            { name: "iron_sword", count: 1 },
            { name: "iron_axe", count: 1 }
        ];

        expect(evaluateCurriculumGoalSuccess("iron tools pipeline", [], [], inventory)).toBe(true);
        expect(evaluateCurriculumGoalSuccess("iron tools pipeline", [], [], inventory.slice(0, 3))).toBe(false);
    });
});