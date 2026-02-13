import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveWithMovementPlugin, waitForNextTick } from "../moving/move.js";
import { resolveItemName } from "../../utils.js";
import { buildLockKey, withResourceLock } from "../teamwork/teamwork.js";
import { findReferenceBlock } from "../building/index.js";
import type { SmeltParams } from "../../types.js";
import type { ResourceLockManager } from "../../../teamwork/coordination.js";
import { CraftingSystem } from "../crafting/craft.js";
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
            
            const crafting = new CraftingSystem(bot);
            const furnaceDef = bot.registry.itemsByName['furnace'];
            
            try 
            {
                const table = bot.findBlock({ matching: (b) => b.name === 'crafting_table', maxDistance: 32 });
                if (!table) throw new Error("Cannot craft furnace: No crafting table found.");
                
                await moveWithMovementPlugin(bot, table.position, 3, 10000);
                
                const recipes = crafting.recipesFor(furnaceDef.id, null, 1, table);
                if (recipes.length === 0) throw new Error("No furnace recipe available.");
                
                await crafting.craft(recipes[0], 1, table);
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
                    
                    const table = bot.findBlock({ matching: (b) => b.name === 'crafting_table', maxDistance: 32 });
                    if (!table) throw new Error("Cannot craft furnace after mining: No crafting table found.");

                    await moveWithMovementPlugin(bot, table.position, 3, 10000);

                    const recipes = crafting.recipesFor(furnaceDef.id, null, 1, table);
                    if (recipes.length === 0) throw new Error("No furnace recipe available after mining.");
                    
                    await crafting.craft(recipes[0], 1, table);
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
        const input = bot.inventory.items().find((item) => item.name.includes(rawItem));
        
        if (!fuel) throw new Error(`No fuel found (${fuelItem})`);
        if (!input) throw new Error(`No input found (${rawItem})`);

        const amountToSmelt = Math.min(count, input.count);
        
        try 
        {
            await furnace.putFuel(fuel.type, null, fuel.count);
            await furnace.putInput(input.type, null, amountToSmelt);
        } 
        catch (err) 
        {
            furnace.close();
            throw new Error(`Failed to put items in furnace: ${err}`);
        }

        console.log(`[smelt] Smelting ${amountToSmelt} ${rawItem}...`);

        let smeltComplete = false;
        let windowOpen = true;

        furnace.once('close', () => 
        {
            windowOpen = false;
        });

        while (windowOpen && !smeltComplete) 
        {
            const inputLeft = furnace.inputItem();
            const fuelLeft = furnace.fuelItem();
            const output = furnace.outputItem();

            if (output && output.count > 0) 
            {
                try 
                {
                    await furnace.takeOutput();
                    console.log(`[smelt] Collected ${output.count} ${output.name}`);
                } 
                catch (e) 
                {
                    console.log("[smelt] Failed to take output (inventory full?)");
                }
            }

            if (!inputLeft) 
            {
                smeltComplete = true;
                break;
            }

            if (!fuelLeft && furnace.fuel === 0 && furnace.progress === 0) 
            {
                furnace.close();
                throw new Error("Ran out of fuel during smelting");
            }

            await new Promise<void>((resolve) => 
            {
                if (!windowOpen) return resolve();
                
                const onUpdate = () => { cleanup(); resolve(); };
                const onClose = () => { cleanup(); resolve(); };
                
                const cleanup = () => 
                {
                    furnace.removeListener('update', onUpdate);
                    furnace.removeListener('close', onClose);
                };

                furnace.on('update', onUpdate);
                furnace.on('close', onClose);
            });
        }

        if (windowOpen) 
        {
            furnace.close();
        }
        
        if (smeltComplete) 
        {
            console.log("[smelt] Smelting complete.");
        } 
        else 
        {
            console.log("[smelt] Furnace window closed before completion.");
        }
    });
}