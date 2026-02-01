import type { ActionHandler } from "./action-executor.js";
import type { DebugTracer } from "../logger/debug-trace.js";
import { ResourceLockManager } from "../teamwork/coordination.js";
import { handleMove } from "./handlers/movement.js";
import { handleMine } from "./handlers/mining.js";
import { handleGather } from "./handlers/gathering.js";
import { handleCraft } from "./handlers/crafting.js";
import { handleSmelt } from "./handlers/smelting.js";
import { handleBuild } from "./handlers/building.js";
import { handleLoot } from "./handlers/looting.js";
import { handlePerceive } from "./handlers/perceiving.js";
import { handleDrop, handleGive } from "./handlers/inventory-management.js";
import { handleRequestResource } from "./handlers/teamwork.js";
import { handlePickup } from "./handlers/gathering.js";
import { clearInventory } from "./handlers/inventory-management.js";

export { clearInventory };

export function createDefaultActionHandlers(options?: { resourceLocks?: ResourceLockManager; tracer?: DebugTracer }): Record<string, ActionHandler>
{
    const resourceLocks = options?.resourceLocks;
    const tracer = options?.tracer;
    const wrap = (name: string, handler: ActionHandler): ActionHandler =>
    {
        if (!tracer)
        {
            return handler;
        }

        return async (bot, step) =>
        {
            return tracer.traceAsync(`action.${name}`, {
                stepId: step.id,
                action: step.action,
                description: step.description,
                params: step.params ? Object.keys(step.params) : []
            }, () => handler(bot, step));
        };
    };
    return {
        move: wrap("move", handleMove),
        mine: wrap("mine", handleMine),
        gather: wrap("gather", (bot, step) => handleGather(bot, step, resourceLocks)),
        craft: wrap("craft", (bot, step) => handleCraft(bot, step, resourceLocks)),
        smelt: wrap("smelt", (bot, step) => handleSmelt(bot, step, resourceLocks)),
        build: wrap("build", handleBuild),
        loot: wrap("loot", (bot, step) => handleLoot(bot, step, resourceLocks)),
        perceive: wrap("perceive", handlePerceive),
        analyzeInventory: wrap("analyzeInventory", handlePerceive),
        give: wrap("give", handleGive),
        drop: wrap("drop", handleDrop),
        requestResource: wrap("requestResource", handleRequestResource),
        pickup: wrap("pickup", handlePickup)
    } satisfies Record<string, ActionHandler>;
}