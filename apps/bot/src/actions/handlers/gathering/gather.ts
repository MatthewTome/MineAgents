import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
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

export async function handleGather(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as GatherParams;
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(bot, rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const maxDistance = params.maxDistance ?? 32;
    const requiredCount = Math.max(1, Math.floor(Number(params.count ?? 1)));

    if (!targetItem) throw new Error("Gather requires item name");

    console.log(`[gather] Requested "${rawTarget ?? "unknown"}" resolved to "${targetItem}" (timeout=${timeout}ms, maxDistance=${maxDistance})`);

    const existing = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
    if (existing && existing.count >= requiredCount)
    {
        console.log(`[gather] Already have ${existing.name} (${existing.count}) which satisfies "${targetItem}" x${requiredCount}, skipping gather.`);
        return;
    }

    console.log(`[gather] Starting active gather cycle for: ${targetItem}`);

    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < timeout)
    {
        attempts++;
        
        const acquired = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (acquired && acquired.count >= requiredCount)
        {
            console.log(`[gather] Successfully gathered ${acquired.name} x${acquired.count}.`);
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
            await moveWithMovementPlugin(bot, dropped.position, 32, 15000);
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
                await handleLoot(bot, { params: { position: chest.position, item: chestItem?.name ?? targetItem, count: requiredCount } }, resourceLocks);
            }
            else
            {
                await handleLoot(bot, { params: { maxDistance, item: targetItem, count: requiredCount } }, resourceLocks);
            }

            const looted = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
            if (looted && looted.count >= requiredCount)
            {
                console.log(`[gather] Looted ${looted.name} from chest.`);
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
                await handleCraft(bot, { params: { recipe: targetItem, count: requiredCount } }, resourceLocks);
                return;
            }
            catch { }
        }

        const needsSmelting = targetItem.includes("ingot");
        if (needsSmelting)
        {
            const oreItem = targetItem.replace("_ingot", "_ore").replace("raw_", "");
            try
            {
                await handleSmelt(bot, { params: { item: oreItem, count: requiredCount } }, resourceLocks);
                const smelted = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
                if (smelted && smelted.count >= requiredCount)
                {
                    console.log(`[gather] Smelted ${smelted.name}.`);
                    return;
                }
            }
            catch { }
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
        if (raw)
        {
            try 
            {
                const remaining = timeout - (Date.now() - start);
                if (remaining > 5000) 
                {
                    console.log(`[gather] Mining prerequisites for ${targetItem} from ${raw}...`);
                    await handleGather(bot, { params: { item: raw, count: requiredCount, timeoutMs: remaining / 2, maxDistance } }, resourceLocks);
                }
            }
            catch (err) { }
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (attempts % 5 === 0) {
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
    await moveWithMovementPlugin(bot, droppedItem.position, 0.5, 15000);
    await waitForNextTick(bot);
    console.log("[pickup] Item collected");
}