import type { Bot } from "mineflayer";
import type { Item } from "prismarine-item";
import { handleCraft } from "../crafting/craft.js";
import { handleLoot } from "../looting/loot.js";
import type { GatherParams, PickupParams  } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";
import { collectBlocks, handleMine, resolveItemToBlock, resolveProductToRaw } from "../mining/mine.js";
import { handleSmelt } from "../smelting/smelt.js";
import { listChestMemory } from "../../../perception/chest-memory.js";
import { moveWithMovementPlugin, findNearestEntity, waitForNextTick } from "../moving/move.js";
import { resolveItemName, isItemMatch } from "../../utils.js";

const MIN_TIMEOUT_MS = 1000;
const MIN_RECURSIVE_TIMEOUT_MS = 3000;
const MAX_PREREQUISITE_DEPTH = 2;

function getCurrentItemCount(bot: Bot, targetItem: string): number
{
    return bot.inventory
        .items()
        .filter((item) => isItemMatch(item.name, targetItem))
        .reduce((total, item) => total + item.count, 0);
}

function getRemainingCount(bot: Bot, targetItem: string, requiredCount: number): number
{
    return Math.max(0, requiredCount - getCurrentItemCount(bot, targetItem));
}

export async function handleGather(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as GatherParams;
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(bot, rawTarget ?? "");
    const timeout = Math.max(MIN_TIMEOUT_MS, params.timeoutMs ?? 60000);
    const maxDistance = params.maxDistance ?? 32;
    const requiredCount = Math.max(1, Math.floor(Number(params.count ?? 1)));
    const prerequisiteDepth = Math.max(0, Math.floor(Number((step.params ?? {}).prerequisiteDepth ?? 0)));

    if (!targetItem) throw new Error("Gather requires item name");

    console.log(`[gather] Requested "${rawTarget ?? "unknown"}" resolved to "${targetItem}" (timeout=${timeout}ms, maxDistance=${maxDistance})`);

    const existingCount = getCurrentItemCount(bot, targetItem);
    if (existingCount >= requiredCount)
    {
        console.log(`[gather] Already have ${targetItem} x${existingCount}, skipping gather.`);
        return;
    }

    console.log(`[gather] Starting active gather cycle for: ${targetItem}`);

    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < timeout)
    {
        attempts++;
        
        const remainingCount = getRemainingCount(bot, targetItem, requiredCount);
        if (remainingCount <= 0)
        {
            console.log(`[gather] Successfully gathered ${targetItem} x${requiredCount}.`);
            return;
        }

        const dropped = findNearestEntity(bot, (entity) =>
        {
            if (entity.name !== "item") return false;
            const droppedItem = (entity as any).getDroppedItem?.() as Item | undefined;
            if (!droppedItem?.name) return false;
            return isItemMatch(droppedItem.name, targetItem);
        }, maxDistance);

        if (dropped)
        {
            const droppedItem = (dropped as any).getDroppedItem?.();
            console.log(`[gather] Found dropped ${droppedItem?.name ?? "item"} at ${dropped.position.floored()}. Collecting...`);
            await moveWithMovementPlugin(bot, dropped.position, 1, 15000);
            continue;
        }

        try
        {
            const chests = listChestMemory().filter((chest) =>
                chest.status === "known" && chest.items && chest.items.some((item) => isItemMatch(item.name, targetItem))
            );

            if (chests.length > 0)
            {
                const chest = chests[0];
                const chestItem = chest.items?.find((item) => isItemMatch(item.name, targetItem));
                await handleLoot(bot, { params: { position: chest.position, item: chestItem?.name ?? targetItem, count: remainingCount } }, resourceLocks);
            }
            else
            {
                await handleLoot(bot, { params: { maxDistance, item: targetItem, count: remainingCount } }, resourceLocks);
            }

            if (getRemainingCount(bot, targetItem, requiredCount) <= 0)
            {
                console.log(`[gather] Looted ${targetItem} from chest.`);
                return;
            }
        }
        catch { }

        const blockTarget = resolveItemToBlock(bot, targetItem);

        const itemDef = bot.registry.itemsByName[targetItem];
        if (itemDef && !blockTarget)
        {
            try
            {
                await handleCraft(bot, { params: { recipe: targetItem, count: remainingCount } }, resourceLocks);
                if (getRemainingCount(bot, targetItem, requiredCount) <= 0) return;
            }
            catch (err: any)
            {
                if (attempts % 5 === 0) console.warn(`[gather] Crafting ${targetItem} failed: ${err.message}`);
            }
        }

        const needsSmelting = targetItem.includes("ingot");
        if (needsSmelting)
        {
            const oreItem = targetItem.replace("_ingot", "_ore").replace("raw_", "");
            try
            {
                await handleSmelt(bot, { params: { item: oreItem, count: remainingCount } }, resourceLocks);
                if (getRemainingCount(bot, targetItem, requiredCount) <= 0)
                {
                    console.log(`[gather] Smelted ${targetItem}.`);
                    return;
                }
            }
            catch (err: any)
            {
                if (attempts % 5 === 0) console.warn(`[gather] Smelting ${targetItem} failed: ${err.message}`);
            }
        }

        const blockName = blockTarget;
        
        if (blockName)
        {
            const blockId = bot.registry.blocksByName[blockName]?.id;
            
            if (blockId !== undefined)
            {
                const foundPositions = bot.findBlocks({
                    matching: blockId,
                    maxDistance: maxDistance,
                    count: 1
                });

                if (foundPositions.length > 0)
                {
                    const pos = foundPositions[0];
                    const block = bot.blockAt(pos);
                    
                    if (block)
                    {
                        console.log(`[gather] Mining ${block.name} at ${block.position}...`);
                        try
                        {
                            await collectBlocks(bot, [block]);
                            await waitForNextTick(bot);
                            continue;
                        }
                        catch (err: any)
                        {
                            console.warn(`[gather] Mining failed: ${err.message}`);
                        }
                    }
                }
            }
            else
            {
                 if (attempts % 3 === 0) console.warn(`[gather] Block "${blockName}" resolved from "${targetItem}" not found in registry.`);
            }
        }

        const raw = resolveProductToRaw(targetItem);
        if (raw && raw !== targetItem && prerequisiteDepth < MAX_PREREQUISITE_DEPTH)
        {
            try 
            {
                let quantityToGather = requiredCount;

                if (itemDef)
                {
                    const recipes = bot.registry.recipes[itemDef.id] as any[];
                    const rawId = bot.registry.itemsByName[raw]?.id;
                    
                    if (rawId && recipes && recipes.length > 0)
                    {
                        for (const recipe of recipes)
                        {
                            let rawCount = 0;
                            
                            const candidates = [];
                            if (Array.isArray(recipe.ingredients)) candidates.push(...recipe.ingredients);
                            if (Array.isArray(recipe.inShape)) candidates.push(...recipe.inShape.flat());
                            
                            for (const cand of candidates)
                            {
                                if (!cand) continue;
                                if (cand === rawId) rawCount++;
                                else if (typeof cand === 'object' && cand.id === rawId) rawCount++;
                            }
                            
                            if (rawCount > 0)
                            {
                                let itemsProduced = 1;
                                if (typeof recipe.result === 'object' && recipe.result !== null && 'count' in recipe.result) {
                                    itemsProduced = recipe.result.count;
                                } else if (Array.isArray(recipe.result) && recipe.result.length > 1) {
                                    itemsProduced = recipe.result[1];
                                }
                                
                                const batches = Math.ceil(requiredCount / itemsProduced);
                                quantityToGather = rawCount * batches;
                                break; 
                            }
                        }
                    }
                }

                const remaining = timeout - (Date.now() - start);
                if (remaining > MIN_RECURSIVE_TIMEOUT_MS)
                {
                    const recursiveTimeout = Math.max(
                        MIN_RECURSIVE_TIMEOUT_MS,
                        Math.floor(remaining / 2)
                    );
                    console.log(`[gather] Mining prerequisites for ${targetItem} from ${raw} (need ${quantityToGather})...`);
                    await handleGather(
                        bot,
                        {
                            params:
                            {
                                item: raw,
                                count: quantityToGather,
                                timeoutMs: recursiveTimeout,
                                maxDistance,
                                prerequisiteDepth: prerequisiteDepth + 1
                            }
                        },
                        resourceLocks
                    );
                }
            }
            catch (err)
            { 
                console.warn(`[gather] Prerequisite gathering failed: ${String(err)}`);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (attempts % 5 === 0)
        {
            console.log(`[gather] Scanning... (Attempt ${attempts})`);
        }
    }

    throw new Error(`Gather ${targetItem} failed: Timeout or not found.`);
}

export async function handlePickup(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as PickupParams;
    const itemName = params.item?.toLowerCase();

    const droppedItem = findNearestEntity(bot, (entity) =>
    {
        if (entity.name !== "item") return false;
        const dropped = (entity as any).getDroppedItem?.();
        if (!dropped) return false;
        if (itemName && !dropped.name?.toLowerCase().includes(itemName)) return false;
        return true;
    }, 32);

    if (!droppedItem)
    {
        console.log(`[pickup] No dropped items found${itemName ? ` matching "${itemName}"` : ""}`);
        return;
    }

    console.log(`[pickup] Moving to collect dropped item at ${droppedItem.position}`);
    await moveWithMovementPlugin(bot, droppedItem.position, 1, 15000);
    await waitForNextTick(bot);
    console.log("[pickup] Item collected");
}