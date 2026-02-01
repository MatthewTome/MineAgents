import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { recordChestContents } from "../../perception/chest-memory.js";
import { moveToward } from "./movement.js";
import { buildLockKey, withResourceLock } from "./teamwork.js";
import type { LootParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";

export async function handleLoot(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as LootParams;
    const maxDistance = params.maxDistance ?? 16;
    const targetItem = params.item?.toLowerCase();
    const targetCount = params.count ?? 0;
    const chestId = bot.registry?.blocksByName?.chest?.id;
    if (typeof chestId !== "number")
    {
        throw new Error("Chest block not registered for this version.");
    }

    const chestBlock = params.position
        ? bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z))
        : bot.findBlock({ matching: chestId, maxDistance });

    if (!chestBlock)
    {
        throw new Error("No chest found nearby.");
    }

    const lockKey = buildLockKey("chest", chestBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () =>
    {
        await moveToward(bot, chestBlock.position, 2.5, 15000);

        const chest = await bot.openContainer(chestBlock);
        const items = chest.containerItems().map((item) => ({ name: item.name, count: item.count ?? 0 }));
        recordChestContents(chestBlock.position, items);

        if (targetItem)
        {
            let remaining = targetCount;
            const matching = chest.containerItems().filter((item) =>
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