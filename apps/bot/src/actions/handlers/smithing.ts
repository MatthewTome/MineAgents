import type { Bot } from "mineflayer";
import { moveToward } from "./movement.js";
import { requireInventoryItem } from "../action-utils.js";
import { buildLockKey, withResourceLock } from "./teamwork.js";
import type { SmithParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";

export async function handleSmith(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as SmithParams;
    if (!params.item1)
    {
        throw new Error("Smith requires item1");
    }

    const anvilBlocks = ["anvil", "chipped_anvil", "damaged_anvil"];
    const matchingIds = anvilBlocks
        .map((name) => bot.registry?.blocksByName?.[name]?.id)
        .filter((id): id is number => typeof id === "number");

    const anvilBlock = bot.findBlock({ matching: matchingIds, maxDistance: 16 });
    if (!anvilBlock)
    {
        throw new Error("No anvil found nearby.");
    }

    const item1 = requireInventoryItem(bot, params.item1);
    const item2 = params.item2 ? requireInventoryItem(bot, params.item2) : null;

    const lockKey = buildLockKey("anvil", anvilBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () =>
    {
        await moveToward(bot, anvilBlock.position, 2.5, 15000);
        const anvil = await bot.openAnvil(anvilBlock);
        if (item2)
        {
            await anvil.combine(item1, item2, params.name);
        }
        else
        {
            await anvil.rename(item1, params.name ?? item1.name);
        }
        (anvil as any).close();
    });
}