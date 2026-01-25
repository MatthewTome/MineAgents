import { Vec3 } from "vec3";
import { recordChestContents, listChestMemory } from "../perception/chest-memory.js";
import { moveToward, resolveTargetPosition, findNearestEntity, waitForNextTick, raceWithTimeout } from "./movement.js";
import { executeBuild } from "./building/building.js";
import { requireInventoryItem, ensureToolFor, expandMaterialAliases, resolveItemName, resolveWoodType, isItemMatch, getAcceptableVariants, isGenericCategory } from "./utils.js";
export function createDefaultActionHandlers(options) {
    const resourceLocks = options?.resourceLocks;
    return {
        move: handleMove,
        mine: handleMine,
        gather: (bot, step) => handleGather(bot, step, resourceLocks),
        craft: (bot, step) => handleCraft(bot, step, resourceLocks),
        smelt: (bot, step) => handleSmelt(bot, step, resourceLocks),
        build: handleBuild,
        loot: (bot, step) => handleLoot(bot, step, resourceLocks),
        eat: handleEat,
        smith: (bot, step) => handleSmith(bot, step, resourceLocks),
        hunt: handleHunt,
        fish: handleFish,
        fight: handleFight,
        perceive: handlePerceive,
        analyzeInventory: handlePerceive,
        give: handleGive,
        drop: handleDrop,
        requestResource: handleRequestResource,
        pickup: handlePickup
    };
}
async function handleMove(bot, step) {
    const params = (step.params ?? {});
    const targetPos = resolveTargetPosition(bot, params || {});
    await moveToward(bot, targetPos, params?.range ?? 1.5, params?.timeoutMs ?? 15000);
}
async function handleBuild(bot, step) {
    const params = (step.params ?? {});
    const timeout = 180000;
    await raceWithTimeout(executeBuild(bot, params), timeout);
}
async function handlePerceive(bot, step) {
    const params = (step.params ?? {});
    console.log(`[bot] Perceiving: ${params?.check ?? "surroundings/inventory"}`);
    await waitForNextTick(bot);
}
async function handleSmelt(bot, step, resourceLocks) {
    const params = (step.params ?? {});
    if (!params.item)
        throw new Error("Smelt requires item name");
    const rawItem = resolveItemName(params.item);
    const fuelItem = resolveItemName(params.fuel ?? "coal");
    let furnaceBlock = params.furnace
        ? bot.blockAt(new Vec3(params.furnace.x, params.furnace.y, params.furnace.z))
        : bot.findBlock({ matching: b => b.name === "furnace", maxDistance: 32 });
    if (!furnaceBlock) {
        console.log("[smelt] No furnace found. Crafting/Placing one...");
        await handleGather(bot, { params: { item: "cobblestone" } });
        await handleCraft(bot, { params: { recipe: "furnace" } });
        const pos = bot.entity.position.offset(1, 0, 0).floored();
        const ref = findReferenceBlock(bot, pos);
        if (ref) {
            const fItem = bot.inventory.items().find(i => i.name === "furnace");
            if (fItem) {
                await bot.equip(fItem, "hand");
                await bot.placeBlock(ref, new Vec3(0, 1, 0));
                await waitForNextTick(bot);
                furnaceBlock = bot.blockAt(pos);
            }
        }
    }
    if (!furnaceBlock)
        throw new Error("Failed to secure a furnace.");
    const lockKey = buildLockKey("furnace", furnaceBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () => {
        await moveToward(bot, furnaceBlock.position, 3, 15000);
        const furnace = await bot.openFurnace(furnaceBlock);
        const fuel = bot.inventory.items().find(i => i.name.includes(fuelItem) || i.name.includes("wood") || i.name.includes("plank") || i.name.includes("coal"));
        if (!fuel)
            throw new Error(`No fuel found for smelting (looked for ${fuelItem} or wood)`);
        await furnace.putFuel(fuel.type, null, fuel.count);
        const input = bot.inventory.items().find(i => i.name.includes(rawItem));
        if (!input)
            throw new Error(`No input item ${rawItem} found to smelt`);
        await furnace.putInput(input.type, null, input.count);
        console.log("[smelt] Cooking... waiting 10s");
        await new Promise(r => setTimeout(r, 10000));
        try {
            await furnace.takeOutput();
        }
        catch (e) { }
        furnace.close();
    });
}
async function handleLoot(bot, step, resourceLocks) {
    const params = (step.params ?? {});
    const maxDistance = params.maxDistance ?? 16;
    const targetItem = params.item?.toLowerCase();
    const targetCount = params.count ?? 0;
    const chestId = bot.registry?.blocksByName?.chest?.id;
    if (typeof chestId !== "number") {
        throw new Error("Chest block not registered for this version.");
    }
    const chestBlock = params.position
        ? bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z))
        : bot.findBlock({ matching: chestId, maxDistance });
    if (!chestBlock) {
        throw new Error("No chest found nearby.");
    }
    const lockKey = buildLockKey("chest", chestBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () => {
        await moveToward(bot, chestBlock.position, 2.5, 15000);
        const chest = await bot.openContainer(chestBlock);
        const items = chest.containerItems().map((item) => ({ name: item.name, count: item.count ?? 0 }));
        recordChestContents(chestBlock.position, items);
        if (targetItem) {
            let remaining = targetCount;
            const matching = chest.containerItems().filter((item) => item.name.toLowerCase().includes(targetItem));
            for (const item of matching) {
                const available = item.count ?? 0;
                const toWithdraw = remaining > 0 ? Math.min(available, remaining) : available;
                if (toWithdraw <= 0) {
                    continue;
                }
                try {
                    await chest.withdraw(item.type, null, toWithdraw);
                    if (remaining > 0) {
                        remaining -= toWithdraw;
                        if (remaining <= 0) {
                            break;
                        }
                    }
                }
                catch (err) {
                    console.warn(`[loot] Failed to withdraw ${item.name}: ${err}`);
                }
            }
        }
        chest.close();
    });
}
async function handleEat(bot, step) {
    const params = (step.params ?? {});
    const preferred = params.item?.toLowerCase();
    const inventory = bot.inventory.items();
    const foodCandidates = inventory.filter((item) => {
        const name = item.name.toLowerCase();
        return name.includes("bread")
            || name.includes("cooked")
            || name.includes("apple")
            || name.includes("stew")
            || name.includes("porkchop")
            || name.includes("beef")
            || name.includes("mutton")
            || name.includes("chicken")
            || name.includes("carrot")
            || name.includes("potato")
            || name.includes("fish");
    });
    const food = preferred
        ? foodCandidates.find((item) => item.name.toLowerCase().includes(preferred))
        : foodCandidates[0];
    if (!food) {
        throw new Error("No food available to eat.");
    }
    await bot.equip(food, "hand");
    await bot.consume();
}
async function handleSmith(bot, step, resourceLocks) {
    const params = (step.params ?? {});
    if (!params.item1) {
        throw new Error("Smith requires item1");
    }
    const anvilBlocks = ["anvil", "chipped_anvil", "damaged_anvil"];
    const matchingIds = anvilBlocks
        .map((name) => bot.registry?.blocksByName?.[name]?.id)
        .filter((id) => typeof id === "number");
    const anvilBlock = bot.findBlock({ matching: matchingIds, maxDistance: 16 });
    if (!anvilBlock) {
        throw new Error("No anvil found nearby.");
    }
    const item1 = requireInventoryItem(bot, params.item1);
    const item2 = params.item2 ? requireInventoryItem(bot, params.item2) : null;
    const lockKey = buildLockKey("anvil", anvilBlock.position);
    await withResourceLock(resourceLocks, lockKey, async () => {
        await moveToward(bot, anvilBlock.position, 2.5, 15000);
        const anvil = await bot.openAnvil(anvilBlock);
        if (item2) {
            await anvil.combine(item1, item2, params.name);
        }
        else {
            await anvil.rename(item1, params.name ?? item1.name);
        }
        anvil.close();
    });
}
const CRAFT_RAW_MATERIALS = {
    "planks": "log",
    "oak_planks": "oak_log",
    "spruce_planks": "spruce_log",
    "birch_planks": "birch_log",
    "jungle_planks": "jungle_log",
    "acacia_planks": "acacia_log",
    "dark_oak_planks": "dark_oak_log",
    "stick": "planks",
    "crafting_table": "planks",
    "chest": "planks",
    "furnace": "cobblestone",
    "wooden_pickaxe": "planks",
    "stone_pickaxe": "cobblestone",
    "iron_pickaxe": "iron_ingot",
    "door": "planks",
    "oak_door": "oak_planks",
};
async function handleCraft(bot, step, resourceLocks) {
    const params = (step.params ?? {});
    let itemName = params.recipe.toLowerCase();
    const count = params.count ?? 1;
    const structureNames = ["platform", "walls", "roof", "door_frame"];
    if (structureNames.includes(itemName)) {
        console.warn(`[craft] Recipe '${itemName}' looks like a structure. Attempting to switch to material '${params.material ?? "oak_planks"}'`);
        itemName = params.material?.toLowerCase() ?? "oak_planks";
    }
    if (itemName.endsWith("door") && !itemName.includes("_")) {
        const availableWood = resolveWoodType(bot);
        itemName = `${availableWood}_door`;
        console.log(`[craft] Resolved generic 'door' to '${itemName}' based on inventory.`);
    }
    const existing = bot.inventory.items().find(i => i.name === itemName);
    if (existing && existing.count >= count) {
        console.log(`[craft] Already have ${existing.count} ${itemName}, skipping craft.`);
        return;
    }
    let itemType = bot.registry.itemsByName[itemName];
    if (!itemType && itemName.includes("plank")) {
        const logItem = bot.inventory.items().find(i => i.name.endsWith("_log"));
        const fallbackPlank = logItem ? logItem.name.replace("_log", "_planks") : "oak_planks";
        itemType = bot.registry.itemsByName[fallbackPlank];
        if (itemType) {
            itemName = itemType.name ?? fallbackPlank;
        }
    }
    if (!itemType) {
        throw new Error(`Unknown item name: ${itemName}`);
    }
    const noTableRecipes = bot.recipesFor(itemType.id, null, 1, false);
    const tableRecipes = bot.recipesFor(itemType.id, null, 1, true);
    const recipe = noTableRecipes[0] ?? tableRecipes[0];
    if (!recipe) {
        const rawMaterial = CRAFT_RAW_MATERIALS[itemName] ?? CRAFT_RAW_MATERIALS[itemName.split("_").pop() ?? ""];
        if (rawMaterial) {
            console.log(`[craft] No recipe for ${itemName}, attempting to gather ${rawMaterial} first...`);
            await handleGather(bot, { params: { item: rawMaterial } }, resourceLocks);
            const retryRecipes = bot.recipesFor(itemType.id, null, 1, true);
            if (retryRecipes.length > 0) {
                await bot.craft(retryRecipes[0], count, undefined);
                return;
            }
        }
        throw new Error(`No crafting recipe found for ${itemName} in Minecraft data.`);
    }
    const craftableRecipe = bot.recipesFor(itemType.id, null, 1, true)[0] ?? recipe;
    if (!craftableRecipe) {
        const rawMaterial = CRAFT_RAW_MATERIALS[itemName] ?? CRAFT_RAW_MATERIALS[itemName.split("_").pop() ?? ""];
        if (rawMaterial) {
            console.log(`[craft] Missing ingredients for ${itemName}, gathering ${rawMaterial}...`);
            await handleGather(bot, { params: { item: rawMaterial } }, resourceLocks);
            const retryRecipes = bot.recipesFor(itemType.id, null, 1, true);
            if (retryRecipes.length > 0) {
                await bot.craft(retryRecipes[0], count, undefined);
                return;
            }
        }
        const req = recipe.delta?.[0];
        throw new Error(`Insufficient ingredients to craft ${itemName}. Needs ingredients (e.g., ${req ? req.id : 'unknown'}). Missing materials.`);
    }
    if (craftableRecipe.requiresTable) {
        let tableBlock = params.craftingTable
            ? bot.blockAt(new Vec3(params.craftingTable.x, params.craftingTable.y, params.craftingTable.z))
            : bot.findBlock({ matching: (b) => b.name === "crafting_table", maxDistance: 32 });
        if (!tableBlock) {
            console.log("[craft] Crafting new table...");
            await handleGather(bot, { params: { item: "log" } }, resourceLocks);
            const log = bot.inventory.items().find(i => i.name.endsWith("_log"));
            if (!log)
                throw new Error("Failed to gather logs for crafting table.");
            const plankItem = bot.registry.itemsByName[log.name.replace("_log", "_planks")];
            if (plankItem) {
                const plankRecipe = bot.recipesFor(plankItem.id, null, 1, true)[0];
                if (plankRecipe)
                    await bot.craft(plankRecipe, 1, undefined);
            }
            const tRecipe = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, true)[0];
            await bot.craft(tRecipe, 1, undefined);
            const pos = bot.entity.position.offset(1, 0, 0).floored();
            const ref = findReferenceBlock(bot, pos);
            if (ref) {
                const tItem = bot.inventory.items().find(i => i.name === 'crafting_table');
                if (tItem) {
                    await bot.equip(tItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    tableBlock = bot.blockAt(pos);
                }
            }
        }
        if (!tableBlock)
            throw new Error("Could not access crafting table.");
        const lockKey = buildLockKey("crafting_table", tableBlock.position);
        await withResourceLock(resourceLocks, lockKey, async () => {
            await moveToward(bot, tableBlock.position, 3, 15000);
            await bot.craft(craftableRecipe, count, tableBlock);
        });
    }
    else {
        await bot.craft(craftableRecipe, count, undefined);
    }
}
async function handleGather(bot, step, resourceLocks) {
    const params = (step.params ?? {});
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const maxDistance = params.maxDistance ?? 16;
    if (!targetItem)
        throw new Error("Gather requires item name");
    const acceptableVariants = getAcceptableVariants(targetItem);
    const useLooseMatching = isGenericCategory(targetItem) || acceptableVariants.length > 1;
    if (useLooseMatching) {
        console.log(`[gather] Using loose matching for "${targetItem}" - accepting: ${acceptableVariants.slice(0, 3).join(", ")}${acceptableVariants.length > 3 ? "..." : ""}`);
    }
    const existing = bot.inventory.items().find(i => isItemMatch(i.name, targetItem));
    if (existing) {
        console.log(`[gather] Already have ${existing.name} (${existing.count}) which satisfies "${targetItem}", skipping gather.`);
        return;
    }
    const chests = listChestMemory().filter(c => c.status === "known" && c.items && c.items.some(i => isItemMatch(i.name, targetItem)));
    if (chests.length > 0) {
        const chestItem = chests[0].items?.find(i => isItemMatch(i.name, targetItem));
        console.log(`[gather] Found ${chestItem?.name ?? targetItem} in known chest at ${chests[0].position.x},${chests[0].position.y},${chests[0].position.z}`);
        await handleLoot(bot, { params: { position: chests[0].position, item: chestItem?.name ?? targetItem } }, resourceLocks);
        const nowHas = bot.inventory.items().find(i => isItemMatch(i.name, targetItem));
        if (nowHas) {
            console.log(`[gather] Retrieved ${nowHas.name} from chest (satisfies "${targetItem}").`);
            return;
        }
    }
    try {
        await handleLoot(bot, { params: { maxDistance, item: targetItem } }, resourceLocks);
        const looted = bot.inventory.items().find(i => isItemMatch(i.name, targetItem));
        if (looted) {
            console.log(`[gather] Looted ${looted.name} from a nearby chest (satisfies "${targetItem}").`);
            return;
        }
    }
    catch { }
    console.log(`[gather] Starting cycle for: ${targetItem}`);
    const start = Date.now();
    const failedBlocks = new Set();
    let consecutiveFailures = 0;
    let fallbackAttempted = false;
    while (Date.now() - start < timeout) {
        const acquired = bot.inventory.items().find(i => isItemMatch(i.name, targetItem));
        if (acquired) {
            console.log(`[gather] Successfully gathered ${acquired.name} (satisfies "${targetItem}").`);
            return;
        }
        if (consecutiveFailures >= 3) {
            if (!fallbackAttempted && !useLooseMatching && acceptableVariants.length > 1) {
                console.log(`[gather] Specific "${targetItem}" not found after 3 attempts, trying any variant...`);
                fallbackAttempted = true;
                consecutiveFailures = 0;
            }
            else {
                console.log("[gather] Relocating to new area...");
                const escape = bot.entity.position.offset((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
                await moveToward(bot, escape, 2, 8000).catch(() => { });
                consecutiveFailures = 0;
            }
            continue;
        }
        const dropped = findNearestEntity(bot, (e) => {
            if (e.name !== "item")
                return false;
            const d = e.getDroppedItem?.();
            if (!d?.name)
                return false;
            return isItemMatch(d.name, targetItem);
        }, 32);
        if (dropped) {
            const droppedItem = dropped.getDroppedItem?.();
            console.log(`[gather] Found dropped ${droppedItem?.name ?? "item"} (satisfies "${targetItem}").`);
            await moveToward(bot, dropped.position, 1.0, 15000);
            return;
        }
        const blockName = resolveItemToBlock(targetItem);
        if (blockName) {
            const allAliases = new Set();
            allAliases.add(blockName);
            expandMaterialAliases(blockName).forEach(a => allAliases.add(a));
            if (fallbackAttempted || useLooseMatching) {
                for (const variant of acceptableVariants) {
                    const variantBlock = resolveItemToBlock(variant);
                    if (variantBlock) {
                        allAliases.add(variantBlock);
                        expandMaterialAliases(variantBlock).forEach(a => allAliases.add(a));
                    }
                }
            }
            const aliasArray = Array.from(allAliases);
            const block = bot.findBlock({
                matching: (b) => {
                    if (!b || !b.position)
                        return false;
                    const bName = b.name.toLowerCase();
                    if (failedBlocks.has(b.position.toString()))
                        return false;
                    return aliasArray.some(alias => bName === alias || bName.includes(alias));
                },
                maxDistance: 32
            });
            if (block && block.position) {
                console.log(`[gather] Mining ${block.name} at ${block.position}...`);
                await ensureToolFor(bot, block);
                if (!bot.canDigBlock(block)) {
                    console.log(`[gather] Cannot dig ${block.name}. Blacklisting.`);
                    failedBlocks.add(block.position.toString());
                    consecutiveFailures++;
                    continue;
                }
                try {
                    await collectBlocks(bot, [block]);
                    consecutiveFailures = 0;
                    await waitForNextTick(bot);
                    continue;
                }
                catch (err) {
                    console.warn(`[gather] Mine failed: ${err.message}`);
                    if (block.position)
                        failedBlocks.add(block.position.toString());
                    consecutiveFailures++;
                    continue;
                }
            }
        }
        const raw = resolveProductToRaw(targetItem);
        if (raw) {
            console.log(`[gather] Producing ${targetItem} from ${raw}...`);
            await handleGather(bot, { params: { item: raw, timeoutMs: timeout / 2 } }, resourceLocks);
            await handleCraft(bot, { params: { recipe: targetItem } }, resourceLocks);
            return;
        }
        console.log(`[gather] Searching...`);
        const explore = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
        await moveToward(bot, explore, 2, 5000).catch(() => { });
        consecutiveFailures++;
        await waitForNextTick(bot);
    }
    throw new Error(`Gather ${targetItem} failed. Tried variants: ${acceptableVariants.join(", ")}`);
}
async function withResourceLock(resourceLocks, resourceKey, action) {
    if (!resourceLocks || !resourceKey) {
        return action();
    }
    const acquired = await resourceLocks.acquire(resourceKey);
    if (!acquired) {
        throw new Error(`Resource locked: ${resourceKey}`);
    }
    try {
        return await action();
    }
    finally {
        resourceLocks.release(resourceKey);
    }
}
function buildLockKey(resourceType, position) {
    if (!position) {
        return null;
    }
    return `${resourceType}:${position.toString()}`;
}
async function handleMine(bot, step) {
    const params = (step.params ?? {});
    const block = findBlockTarget(bot, params || {}, 32);
    if (!block)
        throw new Error(`No matching block found`);
    await ensureToolFor(bot, block);
    await collectBlocks(bot, [block]);
}
async function handleHunt(bot, step) {
    const params = (step.params ?? {});
    const target = findNearestEntity(bot, e => e.type === "mob" && (e.name ?? "").includes(params.target ?? ""), 64);
    if (!target)
        throw new Error("Target not found");
    await engageTarget(bot, target, params.range ?? 2, params.timeoutMs ?? 20000);
}
async function handleFight(bot, step) {
    const params = (step.params ?? {});
    const target = findNearestEntity(bot, e => (e.type === "mob" || e.type === "player") && (e.name ?? "").includes(params.target ?? ""), 64);
    if (!target)
        throw new Error("Target not found");
    await engageTarget(bot, target, 2.5, params.timeoutMs ?? 20000);
}
async function handleFish(bot, step) {
    const params = (step.params ?? {});
    const rod = requireInventoryItem(bot, "fishing_rod");
    await bot.equip(rod, "hand");
    for (let i = 0; i < (params.casts ?? 1); i++)
        await bot.fish();
}
async function engageTarget(bot, entity, range, timeoutMs) {
    const start = Date.now();
    while (bot.entity.position.distanceTo(entity.position) > range) {
        if (Date.now() - start > timeoutMs)
            throw new Error("Timeout");
        await moveToward(bot, entity.position, range, timeoutMs - (Date.now() - start));
    }
    await bot.lookAt(entity.position, true);
    bot.attack(entity);
}
function findBlockTarget(bot, params, maxDistance) {
    if (params.position)
        return bot.blockAt(new Vec3(params.position.x, params.position.y, params.position.z));
    const name = params.block?.toLowerCase();
    if (!name)
        return null;
    const aliases = expandMaterialAliases(name);
    return bot.findBlock({ matching: (b) => aliases.includes(b.name) || b.name.includes(name), maxDistance });
}
function findReferenceBlock(bot, target) {
    const neighbors = [target.offset(0, -1, 0), target.offset(0, 1, 0), target.offset(1, 0, 0), target.offset(-1, 0, 0), target.offset(0, 0, 1), target.offset(0, 0, -1)];
    for (const p of neighbors) {
        const b = bot.blockAt(p);
        if (b && b.boundingBox !== "empty" && !b.name.includes("water") && !b.name.includes("lava"))
            return b;
    }
    return null;
}
async function collectBlocks(bot, blocks) {
    const collection = bot.collectBlock;
    if (!bot.collectBlock?.collect) {
        throw new Error("Collect block plugin unavailable");
    }
    await raceWithTimeout(collection.collect(blocks, { ignoreNoPath: true }), 15000);
    return true;
}
function resolveItemToBlock(item) {
    const lower = item.toLowerCase();
    if (lower.includes("cobblestone"))
        return "stone";
    if (lower.includes("dirt"))
        return "dirt";
    if (lower.includes("iron"))
        return "iron_ore";
    if (lower.includes("gold"))
        return "gold_ore";
    if (lower.includes("diamond"))
        return "diamond_ore";
    if (lower.includes("coal"))
        return "coal_ore";
    if (lower.includes("copper"))
        return "copper_ore";
    if (lower.includes("redstone") && !lower.includes("block"))
        return "redstone_ore";
    if (lower.includes("lapis"))
        return "lapis_ore";
    if (lower.includes("emerald"))
        return "emerald_ore";
    if (lower === "log" || lower === "wood")
        return "log";
    if (lower.includes("_log"))
        return lower;
    if (lower.includes("_stem"))
        return lower;
    if (lower.includes("log") || lower.includes("wood"))
        return "log";
    if (lower.includes("sand") && !lower.includes("stone"))
        return "sand";
    if (lower.includes("gravel"))
        return "gravel";
    if (lower.includes("clay"))
        return "clay";
    return null;
}
function resolveProductToRaw(product) {
    if (product.includes("planks"))
        return "log";
    if (product.includes("stick"))
        return "planks";
    if (product.includes("pickaxe"))
        return "stick";
    return null;
}
async function handleGive(bot, step) {
    const params = (step.params ?? {});
    if (!params.target)
        throw new Error("Give requires target player name");
    if (!params.item)
        throw new Error("Give requires item name");
    const targetName = params.target.toLowerCase();
    const itemName = params.item.toLowerCase();
    const method = params.method ?? "drop";
    const targetEntity = findNearestEntity(bot, (e) => e.type === "player" && (e.username?.toLowerCase().includes(targetName) ?? false), 64);
    if (!targetEntity)
        throw new Error(`Target player "${params.target}" not found nearby`);
    const items = bot.inventory.items().filter(i => i.name.toLowerCase().includes(itemName));
    if (items.length === 0)
        throw new Error(`No ${params.item} in inventory`);
    if (method === "chest") {
        const chestId = bot.registry?.blocksByName?.chest?.id;
        let chestBlock = typeof chestId === "number"
            ? bot.findBlock({ matching: chestId, maxDistance: 16 })
            : null;
        if (!chestBlock) {
            const chestItem = bot.inventory.items().find(i => i.name === "chest");
            if (chestItem) {
                const pos = bot.entity.position.offset(1, 0, 0).floored();
                const ref = bot.blockAt(pos.offset(0, -1, 0));
                if (ref && ref.boundingBox !== "empty") {
                    await bot.equip(chestItem, "hand");
                    await bot.placeBlock(ref, new Vec3(0, 1, 0));
                    await waitForNextTick(bot);
                    chestBlock = bot.blockAt(pos);
                }
            }
        }
        if (!chestBlock)
            throw new Error("No chest available for deposit");
        await moveToward(bot, chestBlock.position, 2.5, 15000);
        const chest = await bot.openContainer(chestBlock);
        let deposited = 0;
        for (const item of items) {
            const toDeposit = params.count ? Math.min(params.count - deposited, item.count) : item.count;
            if (toDeposit <= 0)
                continue;
            try {
                await chest.deposit(item.type, null, toDeposit);
                deposited += toDeposit;
            }
            catch (err) {
                console.warn(`[give] Failed to deposit ${item.name}: ${err}`);
            }
            if (params.count && deposited >= params.count)
                break;
        }
        chest.close();
        const pos = chestBlock.position;
        bot.chat(`[team] Deposited ${deposited} ${params.item} in chest at ${pos.x},${pos.y},${pos.z} for ${params.target}`);
    }
    else {
        await moveToward(bot, targetEntity.position, 3, 15000);
        await bot.lookAt(targetEntity.position.offset(0, 1, 0), true);
        let tossed = 0;
        for (const item of items) {
            const toToss = params.count ? Math.min(params.count - tossed, item.count) : item.count;
            if (toToss <= 0)
                continue;
            try {
                await bot.toss(item.type, item.metadata, toToss);
                tossed += toToss;
                await waitForNextTick(bot);
            }
            catch (err) {
                console.warn(`[give] Failed to toss ${item.name}: ${err}`);
            }
            if (params.count && tossed >= params.count)
                break;
        }
        bot.chat(`[team] Tossed ${tossed} ${params.item} to ${params.target}`);
    }
}
async function handleDrop(bot, step) {
    const params = (step.params ?? {});
    const itemName = params.item?.toLowerCase();
    if (!itemName || itemName === "all") {
        await clearInventory(bot);
        return;
    }
    const items = bot.inventory.items().filter(i => i.name.toLowerCase().includes(itemName));
    if (items.length === 0) {
        console.log(`[drop] No ${params.item} found in inventory`);
        return;
    }
    let dropped = 0;
    for (const item of items) {
        const toDrop = params.count ? Math.min(params.count - dropped, item.count) : item.count;
        if (toDrop <= 0)
            continue;
        try {
            await bot.toss(item.type, item.metadata, toDrop);
            dropped += toDrop;
            await waitForNextTick(bot);
        }
        catch (err) {
            console.warn(`[drop] Failed to drop ${item.name}: ${err}`);
        }
        if (params.count && dropped >= params.count)
            break;
    }
    console.log(`[drop] Dropped ${dropped} ${params.item}`);
}
async function handleRequestResource(bot, step) {
    const params = (step.params ?? {});
    if (!params.item)
        throw new Error("RequestResource requires item name");
    const urgency = params.urgent ? "[URGENT] " : "";
    const count = params.count ?? "some";
    const roleName = bot.__roleName ?? "agent";
    bot.chat(`${urgency}[team] ${bot.username} (${roleName}) needs ${count} ${params.item}`);
    console.log(`[requestResource] Announced need for ${count} ${params.item}`);
}
async function handlePickup(bot, step) {
    const params = (step.params ?? {});
    const itemName = params.item?.toLowerCase();
    const droppedItem = findNearestEntity(bot, (e) => {
        if (e.name !== "item")
            return false;
        const dropped = e.getDroppedItem?.();
        if (!dropped)
            return false;
        if (itemName && !dropped.name?.toLowerCase().includes(itemName))
            return false;
        return true;
    }, 32);
    if (!droppedItem) {
        console.log(`[pickup] No dropped items found${itemName ? ` matching "${itemName}"` : ""}`);
        return;
    }
    console.log(`[pickup] Moving to collect dropped item at ${droppedItem.position}`);
    await moveToward(bot, droppedItem.position, 0.5, 15000);
    await waitForNextTick(bot);
    console.log("[pickup] Item collected");
}
export async function clearInventory(bot) {
    const items = bot.inventory.items();
    console.log(`[clearInventory] Dropping ${items.length} item stacks...`);
    for (const item of items) {
        try {
            await bot.tossStack(item);
            await waitForNextTick(bot);
        }
        catch (err) {
            console.warn(`[clearInventory] Failed to drop ${item.name}: ${err}`);
        }
    }
    console.log("[clearInventory] Inventory cleared.");
}
