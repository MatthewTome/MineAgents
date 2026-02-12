import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { recordChestContents } from "../../../perception/chest-memory.js";
import { moveWithMovementPlugin } from "../moving/move.js";
import { buildLockKey, withResourceLock } from "../teamwork/teamwork.js";
import type { LootParams } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";

export async function handleLoot(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as LootParams;
    const maxDistance = params.maxDistance ?? 16;
    const targetItem = params.item?.toLowerCase();
    const targetCount = params.count ?? 0;

    const containerNames = ['chest', 'trapped_chest', 'barrel'];
    const containerIds = containerNames
        .map(name => bot.registry.blocksByName[name]?.id)
        .filter((id): id is number => id !== undefined);

    if (containerIds.length === 0) {
        throw new Error("No container blocks registered for this version.");
    }

    const chestBlock = params.position
        ? bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z))
        : bot.findBlock({ matching: containerIds, maxDistance });

    if (!chestBlock) {
        throw new Error("No chest/container found nearby.");
    }

    const lockKey = buildLockKey("chest", chestBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () =>
    {
        await moveWithMovementPlugin(bot, chestBlock.position, 2.5, 15000);

        const chest = await bot.openContainer(chestBlock);
        const containerItems = chest.items().filter(item => item.slot < chest.inventoryStart);
        const recordedItems = containerItems.map((item) => ({ name: item.name, count: item.count ?? 0 }));
        recordChestContents(chestBlock.position, recordedItems);

        if (targetItem)
        {
            let remaining = targetCount;
            const matching = containerItems.filter((item) =>
                item.name.toLowerCase().includes(targetItem)
            );

            for (const item of matching)
            {
                const available = item.count ?? 0;
                const toWithdraw = remaining > 0 ? Math.min(available, remaining) : available;
                if (toWithdraw <= 0) { continue; }

                try
                {
                    await chest.withdraw(item.type, null, toWithdraw);
                    if (remaining > 0)
                    {
                        remaining -= toWithdraw;
                        if (remaining <= 0) { break; }
                    }
                }
                catch (err)
                {
                    console.warn(`[loot] Failed to withdraw ${item.name}: ${err}`);
                }
            }
        }
        chest.close();
    });
}