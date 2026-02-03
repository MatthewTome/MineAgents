import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Item } from "prismarine-item";
import { craftFromInventory } from "./crafting.js";
import { handleLoot } from "./looting.js";
import type { GatherParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";
import type { PickupParams } from "../action-types.js";
import { collectBlocks, resolveItemToBlock, resolveProductToRaw } from "./mining.js";
import { listChestMemory } from "../../perception/chest-memory.js";
import { moveToward, findNearestEntity, waitForNextTick } from "./movement.js";
import { resolveItemName, isItemMatch } from "../action-utils.js";

export async function handleGather(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as GatherParams;
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(bot, rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const maxDistance = params.maxDistance ?? 16;

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
    console.log(`[gather] Chest memory search found ${chests.length} candidates.`);
    if (chests.length > 0)
    {
        const chestItem = chests[0].items?.find((item) => isItemMatch(item.name, targetItem));
        console.log(`[gather] Found ${chestItem?.name ?? targetItem} in known chest at ${chests[0].position.x},${chests[0].position.y},${chests[0].position.z}`);
        await handleLoot(bot, { params: { position: chests[0].position, item: chestItem?.name ?? targetItem } }, resourceLocks);
        const nowHas = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (nowHas)
        {
            console.log(`[gather] Retrieved ${nowHas.name} from chest (satisfies "${targetItem}").`);
            return;
        }
        console.log("[gather] Chest retrieval did not yield the target item.");
    }

    try
    {
        await handleLoot(bot, { params: { maxDistance, item: targetItem } }, resourceLocks);
        const looted = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (looted)
        {
            console.log(`[gather] Looted ${looted.name} from a nearby chest (satisfies "${targetItem}").`);
            return;
        }
    }
    catch (err: any)
    {
        console.warn(`[gather] Nearby chest loot attempt failed: ${err?.message ?? String(err)}`);
    }

    console.log(`[gather] Starting cycle for: ${targetItem}`);

    const start = Date.now();
    const failedBlocks = new Set<string>();
    let consecutiveFailures = 0;
    let attempts = 0;

    while (Date.now() - start < timeout)
    {
        attempts++;
        const elapsed = Date.now() - start;
        console.log(`[gather] Attempt ${attempts} (elapsed ${elapsed}ms, consecutiveFailures=${consecutiveFailures})`);

        const acquired = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (acquired)
        {
            console.log(`[gather] Successfully gathered ${acquired.name} (satisfies "${targetItem}").`);
            return;
        }

        if (consecutiveFailures >= 3)
        {
            console.log("[gather] Relocating to new area...");
            const escape = bot.entity.position.offset((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
            console.log(`[gather] Escape target: ${escape}`);
            await moveToward(bot, escape, 2, 8000).catch(() => {});
            consecutiveFailures = 0;
            continue;
        }

        const dropped = findNearestEntity(bot, (entity) =>
        {
            if (entity.name !== "item") return false;
            const droppedItem = (entity as any).getDroppedItem?.() as Item | undefined;
            if (!droppedItem?.name) return false;
            return isItemMatch(droppedItem.name, targetItem);
        }, 32);

        if (dropped)
        {
            const droppedItem = (dropped as any).getDroppedItem?.();
            console.log(`[gather] Found dropped ${droppedItem?.name ?? "item"} (satisfies "${targetItem}").`);
            await moveToward(bot, dropped.position, 1.0, 15000);
            return;
        }
        console.log("[gather] No matching dropped items nearby.");

        const blockName = resolveItemToBlock(targetItem);
        if (blockName)
        {
            const blockId = bot.registry.blocksByName[blockName]?.id;
            if (!blockId)
            {
                console.warn(`[gather] No block id found for "${blockName}".`);
                consecutiveFailures++;
                continue;
            }

            console.log(`[gather] Block search for "${targetItem}" resolved to "${blockName}".`);

            const foundPositions = bot.findBlocks({
                matching: blockId,
                maxDistance: 64,
                count: 20
            });
            console.log(`[gather] Block search returned ${foundPositions.length} candidates.`);

            let block: Block | null = null;
            for (const pos of foundPositions)
            {
                if (!failedBlocks.has(pos.toString()))
                {
                    const candidate = bot.blockAt(pos);
                    if (candidate && bot.canDigBlock(candidate))
                    {
                        block = candidate;
                        break;
                    }
                }
            }

            if (block)
            {
                console.log(`[gather] Mining ${block.name} at ${block.position}...`);

                try
                {
                    await collectBlocks(bot, [block]);
                    consecutiveFailures = 0;
                    await waitForNextTick(bot);
                    continue;
                }
                catch (err: any)
                {
                    console.warn(`[gather] Mine failed: ${err.message}`);
                    if (block.position) failedBlocks.add(block.position.toString());
                    bot.pathfinder?.stop();
                    consecutiveFailures++;
                    continue;
                }
            }
            else
            {
                console.log("[gather] No reachable blocks matched the target.");
            }
        }

        const raw = resolveProductToRaw(targetItem);
        if (raw)
        {
            console.log(`[gather] Producing ${targetItem} from ${raw}...`);
            await handleGather(bot, { params: { item: raw, timeoutMs: timeout / 2 } }, resourceLocks);
            await craftFromInventory(bot, { recipe: targetItem }, resourceLocks);
            return;
        }

        console.log("[gather] Searching...");
        const explore = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
        console.log(`[gather] Exploring position: ${explore}`);
        await moveToward(bot, explore, 2, 15000).catch(() => {});
        consecutiveFailures++;
        await waitForNextTick(bot);
    }
    console.warn(`[gather] Timeout after ${Date.now() - start}ms trying to gather "${targetItem}".`);
    throw new Error(`Gather ${targetItem} failed.`);
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
    await moveToward(bot, droppedItem.position, 0.5, 15000);
    await waitForNextTick(bot);
    console.log("[pickup] Item collected");
}