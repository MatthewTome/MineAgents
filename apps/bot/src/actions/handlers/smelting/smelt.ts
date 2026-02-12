import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveWithMovementPlugin, waitForNextTick } from "../moving/move.js";
import { resolveItemName } from "../../utils.js";
import { buildLockKey, withResourceLock } from "../teamwork/teamwork.js";
import { findReferenceBlock } from "../building/index.js";
import type { SmeltParams } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";
import { craftFromInventory } from "../crafting/craft.js";
import { handleMine } from "../mining/mine.js";

export async function handleSmelt(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as SmeltParams;
    if (!params.item) throw new Error("Smelt requires item name");

    const rawItem = resolveItemName(bot, params.item);
    const fuelItem = resolveItemName(bot, params.fuel ?? "coal");
    const count = params.count ?? 1;

    let furnaceBlock = params.furnace
        ? bot.blockAt(new Vec3(params.furnace.x, params.furnace.y, params.furnace.z))
        : bot.findBlock({ matching: (block) => block.name === "furnace", maxDistance: 32 });

    if (!furnaceBlock)
    {
        console.log("[smelt] No furnace found nearby. Checking inventory...");
        const furnaceItem = bot.inventory.items().find(i => i.name === "furnace");
        
        if (!furnaceItem)
        {
            console.log("[smelt] No furnace in inventory. Attempting to craft one.");
            
            try 
            {
                await craftFromInventory(bot, { recipe: "furnace" }, resourceLocks);
            } 
            catch (err: any) 
            {
                console.log(`[smelt] Craft furnace failed: ${err.message}. Checking for cobblestone...`);
                const cobble = bot.inventory.items().find(i => i.name === "cobblestone");
                const currentCobble = cobble ? cobble.count : 0;
                
                if (currentCobble < 8)
                {
                    const needed = 8 - currentCobble;
                    console.log(`[smelt] Need ${needed} more cobblestone. Mining...`);
                    await handleMine(bot, { params: { block: "cobblestone", count: needed, maxDistance: 32 } });
                    await craftFromInventory(bot, { recipe: "furnace" }, resourceLocks);
                }
                else
                {
                    throw err;
                }
            }
        }

        console.log("[smelt] Placing furnace...");
        const furnaceToPlace = bot.inventory.items().find(i => i.name === "furnace");
        if (!furnaceToPlace) throw new Error("Failed to obtain furnace.");

        const pos = bot.entity.position.offset(1, 0, 0).floored();
        const ref = findReferenceBlock(bot, pos);
        
        if (!ref) throw new Error("No suitable block to place furnace on.");
        
        await bot.equip(furnaceToPlace, "hand");
        await bot.placeBlock(ref, new Vec3(0, 1, 0));
        await waitForNextTick(bot);
        
        furnaceBlock = bot.blockAt(pos);
    }

    if (!furnaceBlock) throw new Error("No furnace found nearby and failed to place one.");

    const lockKey = buildLockKey("furnace", furnaceBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () =>
    {
        await moveWithMovementPlugin(bot, furnaceBlock!.position, 3, 15000);

        const furnace = await bot.openFurnace(furnaceBlock!);

        const fuel = bot.inventory.items().find((item) => item.name === fuelItem);
        if (!fuel) throw new Error(`No fuel found for smelting (looked for ${fuelItem})`);
        
        try
        {
            await furnace.putFuel(fuel.type, null, fuel.count);
        }
        catch (err)
        {
            console.warn(`[smelt] Fuel placement warning: ${err}`);
        }

        const input = bot.inventory.items().find((item) => item.name.includes(rawItem));
        if (!input) throw new Error(`No input item ${rawItem} found to smelt`);
        
        try
        {
            await furnace.putInput(input.type, null, input.count);
        }
        catch (err)
        {
             console.warn(`[smelt] Input placement warning: ${err}`);
        }

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