import type { ActionStep } from "../../actions/executor.js";

const SHELTER_GOAL_PATTERNS = ["wooden shelter", "shelter before nightfall", "build a small wooden shelter"];
const IRON_PIPELINE_GOAL_PATTERNS = ["iron tools pipeline", "finalize_iron_tools_pipeline"];

export type CurriculumGoalType = "shelter" | "iron-tools-pipeline";

function normalizeGoalName(goalName: string): string
{
    return goalName.toLowerCase().trim();
}

function getInventoryCountByName(items: { name: string; count: number }[], itemName: string): number
{
    const normalized = itemName.toLowerCase();
    return items
        .filter((item) => item.name.toLowerCase() === normalized)
        .reduce((acc, item) => acc + item.count, 0);
}

export function classifyCurriculumGoal(goalName: string): CurriculumGoalType | null
{
    const normalized = normalizeGoalName(goalName);
    if (SHELTER_GOAL_PATTERNS.some((pattern) => normalized.includes(pattern)))
    {
        return "shelter";
    }

    if (IRON_PIPELINE_GOAL_PATTERNS.some((pattern) => normalized.includes(pattern)))
    {
        return "iron-tools-pipeline";
    }

    return null;
}

export function evaluateCurriculumGoalSuccess(goalName: string, steps: ActionStep[], results: { id: string; status: string }[], inventoryItems: { name: string; count: number }[]): boolean
{
    const goalType = classifyCurriculumGoal(goalName);
    if (goalType === "shelter")
    {
        const shelterStepIds = new Set(
            steps
                .filter((step) => step.action === "build" && String((step.params ?? {}).structure ?? "") === "shelter")
                .map((step) => step.id)
        );

        return results.some((result) => result.status === "success" && shelterStepIds.has(result.id));
    }

    if (goalType === "iron-tools-pipeline")
    {
        const requiredTools = ["iron_pickaxe", "iron_shovel", "iron_sword", "iron_axe"];
        return requiredTools.every((tool) => getInventoryCountByName(inventoryItems, tool) >= 1);
    }

    return false;
}