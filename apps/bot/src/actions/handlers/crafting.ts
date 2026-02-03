import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveToward, waitForNextTick } from "./movement.js";
import { resolveWoodType } from "../action-utils.js";
import { buildLockKey, withResourceLock } from "./teamwork.js";
import { findReferenceBlock } from "./building.js";
import type { CraftParams } from "../action-types.js";
import type { ResourceLockManager } from "../../teamwork/coordination.js";

export async function handleCraft(bot: Bot, step: { params?: Record<string, unknown> }, resourceLocks?: ResourceLockManager): Promise<void>
{
    const params = (step.params ?? {}) as unknown as CraftParams;
    await craftFromInventory(bot, params, resourceLocks);
}

export async function craftFromInventory(bot: Bot, params: CraftParams, resourceLocks?: ResourceLockManager): Promise<void>
{
    let itemName = params.recipe.toLowerCase();
    const count = params.count ?? 1;

    const structureNames = ["platform", "walls", "roof", "door_frame"];
    if (structureNames.includes(itemName))
    {
        console.warn(`[craft] Recipe '${itemName}' looks like a structure. Attempting to switch to material '${params.material ?? "oak_planks"}'`);
        itemName = params.material?.toLowerCase() ?? "oak_planks";
    }

    if (itemName.endsWith("door") && !itemName.includes("_"))
    {
        const availableWood = resolveWoodType();
        itemName = `${availableWood}_door`;
        console.log(`[craft] Resolved generic 'door' to '${itemName}' based on inventory.`);
    }

    const existing = bot.inventory.items().find((item) => item.name === itemName);
    if (existing && existing.count >= count)
    {
        console.log(`[craft] Already have ${existing.count} ${itemName}, skipping craft.`);
        return;
    }

    let itemType = bot.registry.itemsByName[itemName];
    if (!itemType && itemName.includes("plank"))
    {
        const logItem = bot.inventory.items().find((item) => item.name.endsWith("_log"));
        const fallbackPlank = logItem ? logItem.name.replace("_log", "_planks") : "oak_planks";
        itemType = bot.registry.itemsByName[fallbackPlank];
        if (itemType)
        {
            itemName = itemType.name ?? fallbackPlank;
        }
    }

    if (!itemType)
    {
        throw new Error(`Unknown item name: ${itemName}`);
    }

    const noTableRecipes = bot.recipesFor(itemType.id, null, 1, false);
    const tableRecipes = bot.recipesFor(itemType.id, null, 1, true);
    const recipe = noTableRecipes[0] ?? tableRecipes[0];

    if (!recipe)
    {
        throw new Error(`No crafting recipe found for ${itemName} in Minecraft data.`);
    }

    const craftableRecipe = bot.recipesFor(itemType.id, null, 1, true)[0] ?? recipe;

    if (!craftableRecipe)
    {
        const req = recipe.delta?.[0];
        throw new Error(`Insufficient ingredients to craft ${itemName}. Needs ingredients (e.g., ${req ? req.id : "unknown"}). Missing materials.`);
    }

    if (craftableRecipe.requiresTable)
    {
        let tableBlock = params.craftingTable
            ? bot.blockAt(new Vec3(params.craftingTable.x, params.craftingTable.y, params.craftingTable.z))
            : bot.findBlock({ matching: (block) => block.name === "crafting_table", maxDistance: 32 });

        if (!tableBlock)
        {
            const tableItem = bot.inventory.items().find((item) => item.name === "crafting_table");
            if (tableItem)
            {
                const pos = bot.entity.position.offset(1, 0, 0).floored();
                const ref = findReferenceBlock(bot, pos);
                if (ref)
                {
                    await bot.equip(tableItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    tableBlock = bot.blockAt(pos);
                }
            }
        }

        if (!tableBlock) throw new Error("Could not access crafting table.");
        const lockKey = buildLockKey("crafting_table", tableBlock.position);
        await withResourceLock(resourceLocks, lockKey, async () =>
        {
            await moveToward(bot, tableBlock.position, 3, 15000);
            await bot.craft(craftableRecipe, count, tableBlock);
        });
    }
    else
    {
        await bot.craft(craftableRecipe, count, undefined);
    }
}