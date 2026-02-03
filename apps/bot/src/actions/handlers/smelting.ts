import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveToward } from "./movement.js";
import { resolveItemName } from "../action-utils.js";
import { buildLockKey, withResourceLock } from "./teamwork.js";
import type { SmeltParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";

export async function handleSmelt(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as SmeltParams;
    if (!params.item) throw new Error("Smelt requires item name");

    const rawItem = resolveItemName(bot, params.item);
    const fuelItem = resolveItemName(bot, params.fuel ?? "coal");

    const furnaceBlock = params.furnace
        ? bot.blockAt(new Vec3(params.furnace.x, params.furnace.y, params.furnace.z))
        : bot.findBlock({ matching: (block) => block.name === "furnace", maxDistance: 32 });

    if (!furnaceBlock) throw new Error("No furnace found nearby.");

    const lockKey = buildLockKey("furnace", furnaceBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () =>
    {
        await moveToward(bot, furnaceBlock.position, 3, 15000);

        const furnace = await bot.openFurnace(furnaceBlock);

        const fuel = bot.inventory.items().find((item) => item.name === fuelItem);
        if (!fuel) throw new Error(`No fuel found for smelting (looked for ${fuelItem})`);
        await furnace.putFuel(fuel.type, null, fuel.count);

        const input = bot.inventory.items().find((item) => item.name.includes(rawItem));
        if (!input) throw new Error(`No input item ${rawItem} found to smelt`);
        await furnace.putInput(input.type, null, input.count);

        console.log("[smelt] Cooking... waiting 10s");
        await new Promise((resolve) => setTimeout(resolve, 10000));

        try
        {
            await furnace.takeOutput();
        }
        catch { }

        furnace.close();
    });
}