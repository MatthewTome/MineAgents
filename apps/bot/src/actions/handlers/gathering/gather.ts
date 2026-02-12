import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import { CraftingSystem } from "../crafting/craft.js";
import { handleLoot } from "../looting/loot.js";
import type { GatherParams, PickupParams  } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";
import { collectBlocks, handleMine, resolveItemToBlock, resolveProductToRaw } from "../mining/mine.js";
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

    if (!targetItem) throw new Error("Gather requires item name");

    console.log(`[gather] Requested "${rawTarget ?? "unknown"}" resolved to "${targetItem}" (timeout=${timeout}ms, maxDistance=${maxDistance})`);

    const existing = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
    if (existing)
    {
        console.log(`[gather] Already have ${existing.name} (${existing.count}) which satisfies "${targetItem}", skipping gather.`);
        return;
    }

    const chests = listChestMemory().filter((chest) =>
        chest.status === "known" && chest.items && chest.items.some((item) => isItemMatch(item.name, targetItem))
    );
    
    if (chests.length > 0)
    {
        const chest = chests[0];
        const chestItem = chest.items?.find((item) => isItemMatch(item.name, targetItem));
        console.log(`[gather] Found ${chestItem?.name ?? targetItem} in known chest at ${chest.position}`);
        
        await handleLoot(bot, { params: { position: chest.position, item: chestItem?.name ?? targetItem } }, resourceLocks);
        
        const nowHas = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (nowHas)
        {
            console.log(`[gather] Retrieved ${nowHas.name} from chest.`);
            return;
        }
    }

    try
    {
        await handleLoot(bot, { params: { maxDistance, item: targetItem } }, resourceLocks);
        const looted = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (looted)
        {
            console.log(`[gather] Looted ${looted.name} from a nearby chest.`);
            return;
        }
    }
    catch (err: any) { /* Ignore loot failure */ }

    console.log(`[gather] Starting active gather cycle for: ${targetItem}`);

    const start = Date.now();
    let attempts = 0;

    while (Date.now() - start < timeout)
    {
        attempts++;
        
        const acquired = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (acquired)
        {
            console.log(`[gather] Successfully gathered ${acquired.name}.`);
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
            await moveWithMovementPlugin(bot, dropped.position, 1.0, 15000);
            continue; 
        }

        const blockName = resolveItemToBlock(bot, targetItem);
        
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
                    console.log(`[gather] Crafting ${targetItem} from ${raw}...`);
                    await handleGather(bot, { params: { item: raw, timeoutMs: remaining / 2, maxDistance } }, resourceLocks);
                    
                    const crafting = new CraftingSystem(bot);
                    const itemDef = bot.registry.itemsByName[targetItem];
                    
                    if (itemDef)
                    {
                        const table = bot.findBlock({ matching: (b) => b.name === 'crafting_table', maxDistance: maxDistance });
                        const recipes = crafting.recipesFor(itemDef.id, null, 1, table || null);

                        if (recipes.length > 0)
                        {
                            const recipe = recipes[0];
                            if (recipe.requiresTable)
                            {
                                if (!table) throw new Error("Crafting table required but not found.");
                                await moveWithMovementPlugin(bot, table.position, 3, 10000);
                            }

                            await crafting.craft(recipe, 1, table || undefined);
                        }
                    }
                    
                    const crafted = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
                    if (crafted) return;
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