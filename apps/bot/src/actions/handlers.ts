import type { ActionHandler } from "./executor.js";
import type { DebugTracer } from "../logger/debug-trace.js";
import { ResourceLockManager } from "../teamwork/coordination.js";
import { handleMove } from "./handlers/moving/move.js";
import { handleMine } from "./handlers/mining/mine.js";
import { handleCraft } from "./handlers/crafting/craft.js";
import { handleSmelt } from "./handlers/smelting/smelt.js";
import { handleBuild } from "./handlers/building/build.js";
import { handlePlace } from "./handlers/placing/place.js";
import { handleLoot } from "./handlers/looting/loot.js";
import { handlePerceive } from "./handlers/perceiving/perceive.js";
import { handleDrop, handleEquip, handleGive, clearInventory } from "./handlers/inventory-management/inventory-management.js";
import { handleRequestResource } from "./handlers/teamwork/teamwork.js";
import { handleGather, handlePickup } from "./handlers/gathering/gather.js";

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
        analyzeInventory: wrap("analyzeInventory", handlePerceive),
        build: wrap("build", handleBuild),
        craft: wrap("craft", (bot, step) => handleCraft(bot, step, resourceLocks)),
        drop: wrap("drop", handleDrop),
        equip: wrap("equip", handleEquip),
        gather: wrap("gather", (bot, step) => handleGather(bot, step, resourceLocks)),
        give: wrap("give", handleGive),
        loot: wrap("loot", (bot, step) => handleLoot(bot, step, resourceLocks)),
        mine: wrap("mine", handleMine),
        move: wrap("move", handleMove),
        perceive: wrap("perceive", handlePerceive),
        pickup: wrap("pickup", handlePickup),
        place: wrap("place", handlePlace),
        requestResource: wrap("requestResource", handleRequestResource),
        smelt: wrap("smelt", (bot, step) => handleSmelt(bot, step, resourceLocks))
    } satisfies Record<string, ActionHandler>;
}