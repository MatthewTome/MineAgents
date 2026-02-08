import type { Bot } from "mineflayer";
import type { PerceptionSnapshot } from "../settings/types.js";
import type { RecipeLibrary } from "../planner/knowledge.js";
import type { PlannerWorkerClient } from "../planner/planner-worker-client.js";
import type { ActionExecutor } from "../actions/action-executor.js";
import type { SafetyRails } from "../safety/safety-rails.js";
import type { PlanNarrator } from "../actions/handlers/chat.js";
import type { SessionLogger } from "../logger/session-logger.js";
import { safeChat } from "./helpers.js";

export async function attemptRecovery(options:
{
    bot: Bot;
    planner: PlannerWorkerClient;
    executor: ActionExecutor;
    recipeLibrary: RecipeLibrary | null;
    ragEnabled: boolean;
    narrationEnabled: boolean;
    goal: string;
    perception: PerceptionSnapshot;
    baseContext: string;
    failed: { id: string; reason?: string };
    safety: SafetyRails | undefined;
    narrator: PlanNarrator;
    sessionLogger: SessionLogger;
}): Promise<boolean>
{
    if (!options.recipeLibrary) { return false; }

    const query = `${options.goal} ${options.failed.reason ?? ""}`.trim();
    const recipes = options.recipeLibrary.search(query, options.perception).slice(0, 3);
    if (recipes.length === 0) { return false; }

    for (const recipe of recipes)
    {
        const context = [
            options.baseContext,
            `Recovery attempt: previous plan failed at ${options.failed.id} (${options.failed.reason ?? "unknown reason"}).`,
            options.recipeLibrary.formatRecipeFact(recipe, 8)
        ].join(" ");

        const plan = await options.planner.createPlan({
            goal: options.goal,
            perception: options.perception,
            context,
            ragEnabled: options.ragEnabled
        });

        if (plan.steps.length === 0) { continue; }

        if (options.narrationEnabled)
        {
            const narrative = options.narrator.narrateRecovery({ intent: plan.intent, goal: options.goal, steps: plan.steps }, options.failed.id);
            if (narrative)
            {
                safeChat(options.bot, options.safety, narrative, "planner.narration.recovery");
                options.sessionLogger.info("planner.narration", "Recovery plan narrated", { message: narrative });
            }
        }

        options.executor.reset();
        const results = await options.executor.executePlan(plan.steps);
        const failed = results.find((result) => result.status === "failed");
        if (!failed) { return true; }
    }
    return false;
}