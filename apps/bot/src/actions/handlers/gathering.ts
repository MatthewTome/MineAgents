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
import { expandMaterialAliases, resolveItemName, isItemMatch, getAcceptableVariants, isGenericCategory } from "../action-utils.js";

export async function handleGather(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as GatherParams;
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(bot, rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const maxDistance = params.maxDistance ?? 16;

    if (!targetItem) throw new Error("Gather requires item name");

    const acceptableVariants = getAcceptableVariants(targetItem);
    const useLooseMatching = isGenericCategory(targetItem) || acceptableVariants.length > 1;

    if (useLooseMatching)
    {
        console.log(`[gather] Using loose matching for "${targetItem}" - accepting: ${acceptableVariants.slice(0, 3).join(", ")}${acceptableVariants.length > 3 ? "..." : ""}`);
    }

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
        const chestItem = chests[0].items?.find((item) => isItemMatch(item.name, targetItem));
        console.log(`[gather] Found ${chestItem?.name ?? targetItem} in known chest at ${chests[0].position.x},${chests[0].position.y},${chests[0].position.z}`);
        await handleLoot(bot, { params: { position: chests[0].position, item: chestItem?.name ?? targetItem } }, resourceLocks);
        const nowHas = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (nowHas)
        {
            console.log(`[gather] Retrieved ${nowHas.name} from chest (satisfies "${targetItem}").`);
            return;
        }
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
    catch { }

    console.log(`[gather] Starting cycle for: ${targetItem}`);

    const start = Date.now();
    const failedBlocks = new Set<string>();
    let consecutiveFailures = 0;
    let fallbackAttempted = false;

    while (Date.now() - start < timeout)
    {
        const acquired = bot.inventory.items().find((item) => isItemMatch(item.name, targetItem));
        if (acquired)
        {
            console.log(`[gather] Successfully gathered ${acquired.name} (satisfies "${targetItem}").`);
            return;
        }

        if (consecutiveFailures >= 3)
        {
            if (!fallbackAttempted && !useLooseMatching && acceptableVariants.length > 1)
            {
                console.log(`[gather] Specific "${targetItem}" not found after 3 attempts, trying any variant...`);
                fallbackAttempted = true;
                consecutiveFailures = 0;
            }
            else
            {
                console.log("[gather] Relocating to new area...");
                const escape = bot.entity.position.offset((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
                await moveToward(bot, escape, 2, 8000).catch(() => {});
                consecutiveFailures = 0;
            }
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

        const blockName = resolveItemToBlock(targetItem);
        if (blockName)
        {
            const allAliases = new Set<string>();
            allAliases.add(blockName);
            expandMaterialAliases(bot, blockName).forEach((alias) => allAliases.add(alias));

            if (fallbackAttempted || useLooseMatching)
            {
                for (const variant of acceptableVariants)
                {
                    const variantBlock = resolveItemToBlock(variant);
                    if (variantBlock)
                    {
                        allAliases.add(variantBlock);
                        expandMaterialAliases(bot, variantBlock).forEach((alias) => allAliases.add(alias));
                    }
                }
            }

            const aliasArray = Array.from(allAliases);
            const aliasIds = aliasArray
                .map((name) => bot.registry.blocksByName[name]?.id)
                .filter((id): id is number => id !== undefined);

            const foundPositions = bot.findBlocks({
                matching: aliasIds,
                maxDistance: 64,
                count: 20
            });

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
        await moveToward(bot, explore, 2, 15000).catch(() => {});
        consecutiveFailures++;
        await waitForNextTick(bot);
    }
    throw new Error(`Gather ${targetItem} failed. Tried variants: ${acceptableVariants.join(", ")}`);
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