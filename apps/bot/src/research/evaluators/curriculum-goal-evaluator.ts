import type { ActionStep } from "../../actions/executor.js";

const SHELTER_GOAL_PATTERNS = ["wooden shelter", "shelter before nightfall", "build a small wooden shelter"];
const IRON_PIPELINE_GOAL_PATTERNS = ["iron tools pipeline"];

export type CurriculumGoalType = "shelter" | "iron-tools-pipeline";

export interface IronToolsPipelineEvaluationState
{
    inventoryItems: { name: string; count: number }[];
    equippedItemName: string | null;
}

type IronToolsPipelineMilestone =
{
    id: string;
    description: string;
    isMet: (state: IronToolsPipelineEvaluationState) => boolean;
};

const IRON_TOOLS_PIPELINE_MILESTONES: IronToolsPipelineMilestone[] = [
    { id: "step-1", description: "Inventory contains >= 1 oak_log", isMet: (state) => getInventoryCountByName(state.inventoryItems, "oak_log") >= 1 },
    { id: "step-2", description: "Inventory contains >= 3 oak_planks", isMet: (state) => getInventoryCountByName(state.inventoryItems, "oak_planks") >= 3 },
    { id: "step-3", description: "Inventory contains >= 6 stick", isMet: (state) => getInventoryCountByName(state.inventoryItems, "stick") >= 6 },
    { id: "step-4", description: "Equipped item == wooden_pickaxe", isMet: (state) => state.equippedItemName === "wooden_pickaxe" },
    { id: "step-5", description: "Inventory contains >= 3 cobblestone", isMet: (state) => getInventoryCountByName(state.inventoryItems, "cobblestone") >= 3 },
    { id: "step-6", description: "Equipped item == stone_pickaxe", isMet: (state) => state.equippedItemName === "stone_pickaxe" },
    { id: "step-7", description: "Inventory contains >= 1 coal", isMet: (state) => getInventoryCountByName(state.inventoryItems, "coal") >= 1 },
    { id: "step-8", description: "Inventory contains >= 3 raw_iron", isMet: (state) => getInventoryCountByName(state.inventoryItems, "raw_iron") >= 3 },
    { id: "step-9", description: "Inventory contains >= 3 iron_ingot", isMet: (state) => getInventoryCountByName(state.inventoryItems, "iron_ingot") >= 3 },
    { id: "step-10", description: "Inventory contains >= 1 iron_pickaxe", isMet: (state) => getInventoryCountByName(state.inventoryItems, "iron_pickaxe") >= 1 },
];

export type IronToolsPipelineMilestoneResult =
{
    id: string;
    description: string;
    pointsAwarded: number;
};

export class IronToolsPipelineScoreTracker
{
    private readonly achievedMilestones: Set<string> = new Set();

    observe(state: IronToolsPipelineEvaluationState): IronToolsPipelineMilestoneResult[]
    {
        const newlyAchieved: IronToolsPipelineMilestoneResult[] = [];

        for (const milestone of IRON_TOOLS_PIPELINE_MILESTONES)
        {
            if (this.achievedMilestones.has(milestone.id))
            {
                continue;
            }

            if (milestone.isMet(state))
            {
                this.achievedMilestones.add(milestone.id);
                newlyAchieved.push({ id: milestone.id, description: milestone.description, pointsAwarded: 1 });
            }
        }

        return newlyAchieved;
    }

    reset(): void
    {
        this.achievedMilestones.clear();
    }

    get points(): number
    {
        return this.achievedMilestones.size;
    }

    get maxPoints(): number
    {
        return IRON_TOOLS_PIPELINE_MILESTONES.length;
    }
}

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