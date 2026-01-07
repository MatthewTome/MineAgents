import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
export function createDefaultActionHandlers() {
    return {
        move: handleMove,
        mine: handleMine,
        gather: handleGather,
        craft: handleCraft,
        smelt: handleSmelt,
        build: handleBuild,
        hunt: handleHunt,
        fish: handleFish,
        fight: handleFight,
        perceive: handlePerceive,
        analyzeInventory: handlePerceive
    };
}
async function handlePerceive(bot, step) {
    const params = (step.params ?? {});
    console.log(`[bot] Perceiving: ${params?.check ?? "surroundings/inventory"}`);
    await waitForNextTick(bot);
}
async function handleSmelt(bot, step) {
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
    catch (e) { /* might not be done, ignore */ }
    furnace.close();
}
async function handleCraft(bot, step) {
    const params = (step.params ?? {});
    const itemName = params.recipe.toLowerCase();
    const count = params.count ?? 1;
    const itemType = bot.registry.itemsByName[itemName];
    if (!itemType && !itemName.includes("plank"))
        throw new Error(`Unknown item name: ${itemName}`);
    let recipeList = itemType ? bot.recipesFor(itemType.id, null, 1, true) : [];
    let recipe = recipeList[0];
    if (!recipe && itemName.includes("plank")) {
        const oak = bot.registry.itemsByName['oak_planks'];
        if (oak)
            recipe = bot.recipesFor(oak.id, null, 1, true)[0];
    }
    if (!recipe)
        throw new Error(`No crafting recipe found for ${itemName}.`);
    if (recipe.requiresTable) {
        let tableBlock = params.craftingTable
            ? bot.blockAt(new Vec3(params.craftingTable.x, params.craftingTable.y, params.craftingTable.z))
            : bot.findBlock({ matching: (b) => b.name === "crafting_table", maxDistance: 32 });
        if (!tableBlock) {
            console.log("[craft] Crafting new table...");
            await handleGather(bot, { params: { item: "log" } });
            await handleCraft(bot, { params: { recipe: "oak_planks" } });
            const tRecipe = bot.recipesFor(bot.registry.itemsByName['crafting_table'].id, null, 1, null)[0];
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
        await moveToward(bot, tableBlock.position, 3, 15000);
        await bot.craft(recipe, count, tableBlock);
    }
    else {
        await bot.craft(recipe, count, undefined);
    }
}
async function handleGather(bot, step) {
    const params = (step.params ?? {});
    const rawTarget = params.item?.toLowerCase();
    const targetItem = resolveItemName(rawTarget ?? "");
    const timeout = params.timeoutMs ?? 60000;
    const start = Date.now();
    if (!targetItem)
        throw new Error("Gather requires item name");
    console.log(`[gather] Starting cycle for: ${targetItem}`);
    const failedBlocks = new Set();
    let consecutiveFailures = 0;
    while (Date.now() - start < timeout) {
        if (consecutiveFailures >= 3) {
            console.log("[gather] Relocating to new area...");
            const escape = bot.entity.position.offset((Math.random() - 0.5) * 30, 0, (Math.random() - 0.5) * 30);
            await moveToward(bot, escape, 2, 8000).catch(() => { });
            consecutiveFailures = 0;
            continue;
        }
        const dropped = findNearestEntity(bot, (e) => {
            if (e.name !== "item")
                return false;
            const d = e.getDroppedItem?.();
            return d?.name?.toLowerCase().includes(targetItem) || false;
        }, 32);
        if (dropped) {
            console.log(`[gather] Found dropped ${targetItem}.`);
            await moveToward(bot, dropped.position, 1.0, 15000);
            return;
        }
        const blockName = resolveItemToBlock(targetItem);
        if (blockName) {
            const aliases = expandMaterialAliases(blockName);
            const block = bot.findBlock({
                matching: (b) => {
                    if (!b || !b.position)
                        return false;
                    if (!aliases.includes(b.name) && !b.name.includes(blockName))
                        return false;
                    if (failedBlocks.has(b.position.toString()))
                        return false;
                    return true;
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
                    const collected = await collectBlocks(bot, [block]);
                    if (!collected) {
                        await handleMine(bot, { params: { position: block.position } });
                    }
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
            await handleGather(bot, { params: { item: raw, timeoutMs: timeout / 2 } });
            await handleCraft(bot, { params: { recipe: targetItem } });
            return;
        }
        console.log(`[gather] Searching...`);
        const explore = bot.entity.position.offset((Math.random() - 0.5) * 20, 0, (Math.random() - 0.5) * 20);
        await moveToward(bot, explore, 2, 5000).catch(() => { });
        consecutiveFailures++;
        await waitForNextTick(bot);
    }
    throw new Error(`Gather ${targetItem} failed.`);
}
async function handleMove(bot, step) {
    const params = (step.params ?? {});
    const targetPos = resolveTargetPosition(bot, params || {});
    await moveToward(bot, targetPos, params?.range ?? 1.5, params?.timeoutMs ?? 15000);
}
async function handleMine(bot, step) {
    const params = (step.params ?? {});
    const block = findBlockTarget(bot, params || {}, 32);
    if (!block)
        throw new Error(`No matching block found`);
    if (await collectBlocks(bot, [block])) {
        return;
    }
    if (bot.entity.position.distanceTo(block.position) > 4.5) {
        await moveToward(bot, block.position, 3.5, 15000);
    }
    await ensureToolFor(bot, block);
    try {
        await bot.dig(block, true);
    }
    catch (err) {
        await bot.dig(block, true);
    }
}
async function handleBuild(bot, step) {
    const params = (step.params ?? {});
    if (!params?.structure)
        throw new Error("Build requires structure type");
    const rawOrigin = params.origin ? new Vec3(params.origin.x, params.origin.y, params.origin.z) : bot.entity.position;
    const origin = rawOrigin.floored();
    const blueprint = getBlueprint(params);
    if (!blueprint.length)
        throw new Error(`Blueprint empty for '${params.structure}'`);
    const bounds = blueprint.map(p => origin.plus(p));
    const botPos = bot.entity.position.floored();
    const buildBounds = getBuildBounds(bounds);
    const structureCanTrap = ["walls", "roof", "tower", "chimney"].includes(params.structure);
    if (structureCanTrap && isInsideBounds(botPos, buildBounds)) {
        console.log("[build] Relocating outside build bounds to avoid trapping...");
        const safe = findBuildStandOutside(bot, buildBounds, origin);
        await moveToward(bot, safe, 0.5, 5000);
    }
    const materialName = (params.material ?? "cobblestone").toLowerCase();
    const isVertical = ["wall", "walls", "roof", "house", "tower", "chimney"].includes(params.structure);
    const sorted = blueprint.map(pos => origin.plus(pos)).sort((a, b) => {
        if (a.y !== b.y)
            return a.y - b.y;
        const distA = a.distanceTo(bot.entity.position);
        const distB = b.distanceTo(bot.entity.position);
        return isVertical ? (distB - distA) : (distA - distB);
    });
    let placed = 0;
    for (const pos of sorted) {
        const existing = bot.blockAt(pos);
        if (existing && existing.boundingBox !== "empty") {
            if (existing.name.includes(materialName) || materialName.includes(existing.name))
                continue;
            console.log(`[build] Clearing ${existing.name} at ${pos}`);
            await ensureToolFor(bot, existing);
            await bot.dig(existing, true);
        }
        const ref = findReferenceBlock(bot, pos);
        if (!ref)
            continue;
        let item;
        try {
            item = requireInventoryItem(bot, materialName);
        }
        catch (e) {
            throw new Error(`Build failed: Out of ${materialName}`);
        }
        if (bot.inventory.slots[bot.getEquipmentDestSlot("hand")]?.name !== item.name) {
            await bot.equip(item, "hand");
        }
        if (bot.entity.position.distanceTo(ref.position) > 4.5) {
            const safeStand = ref.position.offset(0.5, 1, 0.5).plus(pos.minus(ref.position).scaled(-1));
            await moveToward(bot, safeStand, 4.0, 10000);
        }
        await ensureNotOnPlacement(bot, pos);
        try {
            await bot.placeBlock(ref, pos.minus(ref.position));
            await waitForNextTick(bot);
            placed += 1;
        }
        catch (e) { }
    }
    if (placed === 0) {
        throw new Error("Build failed: placed 0 blocks (obstructed or unreachable)");
    }
}
async function moveToward(bot, target, range, timeout) {
    if (bot.pathfinder) {
        try {
            const goal = new goals.GoalNear(target.x, target.y, target.z, range);
            await raceWithTimeout(bot.pathfinder.goto(goal), timeout);
            return;
        }
        catch (err) {
            console.warn(`[move] Pathfinder failed (${err instanceof Error ? err.message : String(err)}). Falling back.`);
        }
    }
    if (await moveWithMovementPlugin(bot, target, range, timeout)) {
        return;
    }
    await moveTowardManually(bot, target, range, timeout);
}
async function moveTowardManually(bot, target, range, timeout) {
    const start = Date.now();
    let lastPos = bot.entity.position.clone();
    let stuck = 0;
    try {
        while (bot.entity.position.distanceTo(target) > range) {
            if (Date.now() - start > timeout)
                throw new Error("Move timeout");
            if (bot.entity.position.distanceTo(lastPos) < 0.2)
                stuck++;
            else {
                stuck = 0;
                lastPos = bot.entity.position.clone();
            }
            if (stuck > 15)
                await attemptUnstuck(bot, target);
            const nextSpot = findBestLocalStep(bot, target);
            if (nextSpot) {
                await bot.lookAt(nextSpot.offset(0, 1.6, 0));
                bot.setControlState("forward", true);
                if (nextSpot.y > bot.entity.position.y + 0.1) {
                    bot.setControlState("jump", true);
                }
                else {
                    bot.setControlState("jump", false);
                }
            }
            else {
                await bot.lookAt(target);
                bot.setControlState("forward", true);
            }
            if (isCliffAhead(bot)) {
                bot.setControlState("forward", false);
                bot.setControlState("back", true);
                await waitForNextTick(bot);
            }
            await waitForNextTick(bot);
        }
    }
    finally {
        bot.clearControlStates();
    }
}
async function moveWithMovementPlugin(bot, target, range, timeout) {
    const movement = bot.movement;
    if (!movement)
        return false;
    try {
        if (movement.goto) {
            await raceWithTimeout(movement.goto(target, { range, timeout }), timeout);
            return true;
        }
        if (movement.moveTo) {
            await raceWithTimeout(movement.moveTo(target, { range, timeout }), timeout);
            return true;
        }
    }
    catch (err) {
        console.warn(`[move] Movement plugin failed (${err instanceof Error ? err.message : String(err)}).`);
    }
    return false;
}
function findBestLocalStep(bot, globalTarget) {
    const pos = bot.entity.position.floored();
    let best = null;
    let minScore = Infinity;
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            if (x === 0 && z === 0)
                continue;
            for (let y = -1; y <= 1; y++) {
                const candidate = pos.offset(x, y, z);
                if (!isSafeToStand(bot, candidate))
                    continue;
                const dist = candidate.distanceTo(globalTarget);
                const penalty = (y === 1) ? 0.5 : 0;
                const score = dist + penalty;
                if (score < minScore) {
                    minScore = score;
                    best = candidate.offset(0.5, 0, 0.5);
                }
            }
        }
    }
    return best;
}
function isSafeToStand(bot, pos) {
    const block = bot.blockAt(pos);
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const above = bot.blockAt(pos.offset(0, 1, 0));
    if (!block || !below || !above)
        return false;
    if (below.boundingBox === "empty" || below.name === "lava")
        return false;
    if (block.boundingBox !== "empty")
        return false;
    if (above.boundingBox !== "empty")
        return false;
    const deepBelow = bot.blockAt(pos.offset(0, -2, 0));
    if (deepBelow && deepBelow.boundingBox === "empty") {
        const deepDeep = bot.blockAt(pos.offset(0, -3, 0));
        if (deepDeep && deepDeep.boundingBox === "empty")
            return false;
    }
    return true;
}
function isCliffAhead(bot) {
    const velocity = bot.entity.velocity;
    const look = bot.entity.position.plus(velocity.scaled(5));
    const blockBelow = bot.blockAt(look.offset(0, -1, 0));
    const blockBelow2 = bot.blockAt(look.offset(0, -2, 0));
    const blockBelow3 = bot.blockAt(look.offset(0, -3, 0));
    return (!blockBelow || blockBelow.boundingBox === "empty") &&
        (!blockBelow2 || blockBelow2.boundingBox === "empty") &&
        (!blockBelow3 || blockBelow3.boundingBox === "empty");
}
function resolveItemName(name) {
    const lower = name.toLowerCase();
    if (lower === "wood")
        return "log";
    if (lower === "stone")
        return "cobblestone";
    return lower;
}
function resolveTargetPosition(bot, params) {
    if (params.position)
        return new Vec3(params.position.x, params.position.y, params.position.z);
    if (params.entityName) {
        const lower = params.entityName.toLowerCase();
        const entity = findNearestEntity(bot, (e) => {
            const name = (e.username ?? e.displayName ?? e.name ?? "").toLowerCase();
            return name.includes(lower);
        }, 96);
        if (entity)
            return entity.position.clone();
    }
    throw new Error("Unable to resolve target position");
}
function findNearestEntity(bot, predicate, maxDistance) {
    let best = null;
    let bestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
        if (!predicate(e))
            continue;
        const d = bot.entity.position.distanceTo(e.position);
        if (d < bestDist && d <= maxDistance) {
            best = e;
            bestDist = d;
        }
    }
    return best;
}
function expandMaterialAliases(name) {
    const lower = name.toLowerCase();
    if (lower === "wood" || lower === "log" || lower === "planks")
        return ["oak_planks", "spruce_planks", "birch_planks", "oak_log", "birch_log", "cobblestone", "dirt"];
    if (lower.includes("plank"))
        return [lower, "oak_planks", "birch_planks", "spruce_planks"];
    if (lower.includes("stone"))
        return [lower, "cobblestone", "stone", "stone_bricks"];
    if (lower.includes("iron"))
        return ["iron_ore", "deepslate_iron_ore", "raw_iron"];
    return [lower];
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
function requireInventoryItem(bot, name) {
    const aliases = expandMaterialAliases(name);
    const item = bot.inventory.items().find(i => aliases.includes(i.name) || i.name.includes(name));
    if (!item)
        throw new Error(`Missing item: ${name}`);
    return item;
}
function findSafeSpotNear(bot, origin) {
    return origin.offset(3, 0, 3);
}
function getBuildBounds(points) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const p of points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        minZ = Math.min(minZ, p.z);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
        maxZ = Math.max(maxZ, p.z);
    }
    return {
        min: new Vec3(minX, minY, minZ),
        max: new Vec3(maxX, maxY, maxZ)
    };
}
function isInsideBounds(pos, bounds) {
    return pos.x >= bounds.min.x &&
        pos.x <= bounds.max.x &&
        pos.z >= bounds.min.z &&
        pos.z <= bounds.max.z &&
        pos.y >= bounds.min.y - 1 &&
        pos.y <= bounds.max.y + 1;
}
function findBuildStandOutside(bot, bounds, origin) {
    const candidates = [];
    const offsets = [
        new Vec3(bounds.min.x - 2, origin.y, origin.z),
        new Vec3(bounds.max.x + 2, origin.y, origin.z),
        new Vec3(origin.x, origin.y, bounds.min.z - 2),
        new Vec3(origin.x, origin.y, bounds.max.z + 2),
        new Vec3(bounds.min.x - 2, origin.y, bounds.min.z - 2),
        new Vec3(bounds.min.x - 2, origin.y, bounds.max.z + 2),
        new Vec3(bounds.max.x + 2, origin.y, bounds.min.z - 2),
        new Vec3(bounds.max.x + 2, origin.y, bounds.max.z + 2)
    ];
    for (const pos of offsets) {
        const floored = pos.floored();
        if (isSafeToStand(bot, floored)) {
            candidates.push(floored.offset(0.5, 0, 0.5));
        }
    }
    if (!candidates.length) {
        return findSafeSpotNear(bot, origin);
    }
    candidates.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b));
    return candidates[0];
}
async function ensureNotOnPlacement(bot, target) {
    if (bot.entity.position.distanceTo(target.offset(0.5, 0.5, 0.5)) < 1.5) {
        const back = bot.entity.position.minus(target).normalize().scaled(2);
        back.y = 0;
        await moveToward(bot, bot.entity.position.plus(back), 0.2, 1000);
    }
}
async function attemptUnstuck(bot, target) {
    bot.setControlState("forward", false);
    bot.setControlState("jump", true);
    await bot.look(bot.entity.yaw + (Math.random() - 0.5), 0);
    bot.setControlState("forward", true);
    await waitForNextTick(bot);
}
function waitForNextTick(bot) {
    return new Promise(r => bot.once("physicsTick", r));
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
async function ensureToolFor(bot, block) {
    const toolPlugin = bot.tool;
    if (toolPlugin?.equipForBlock) {
        try {
            await toolPlugin.equipForBlock(block);
            return;
        }
        catch (err) {
            console.warn(`[tools] Tool plugin failed (${err instanceof Error ? err.message : String(err)}). Falling back.`);
        }
    }
    const inventory = bot.inventory.items();
    if (block.material === "rock" || block.name.includes("stone") || block.name.includes("ore") || block.name.includes("cobble")) {
        if (inventory.some(i => i.name.includes("pickaxe"))) {
            await bot.equip(inventory.find(i => i.name.includes("pickaxe")), "hand");
            return;
        }
        console.log("[tools] Crafting pickaxe...");
        await handleGather(bot, { params: { item: "log" } });
        await handleCraft(bot, { params: { recipe: "oak_planks" } });
        await handleCraft(bot, { params: { recipe: "stick" } });
        await handleCraft(bot, { params: { recipe: "crafting_table" } });
        await handleCraft(bot, { params: { recipe: "wooden_pickaxe" } });
        const pick = inventory.find(i => i.name.includes("pickaxe"));
        if (pick)
            await bot.equip(pick, "hand");
    }
}
async function collectBlocks(bot, blocks) {
    const collection = bot.collectBlock;
    if (!bot.collectBlock?.collect)
        return false;
    try {
        await raceWithTimeout(collection.collect(blocks, { ignoreNoPath: true }), 15000);
        return true;
    }
    catch (err) {
        console.warn(`[collect] Collect block failed (${err instanceof Error ? err.message : String(err)}).`);
        return false;
    }
}
async function raceWithTimeout(promise, timeoutMs) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Move timeout")), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timeoutId)
            clearTimeout(timeoutId);
    }
}
function resolveItemToBlock(item) {
    if (item.includes("cobblestone"))
        return "stone";
    if (item.includes("dirt"))
        return "dirt";
    if (item.includes("log") || item.includes("wood"))
        return "oak_log";
    if (item.includes("iron"))
        return "iron_ore";
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
function getBlueprint(params) {
    const { width = 3, height = 3, length = 3, structure } = params;
    const positions = [];
    const hw = Math.floor(Math.max(1, width) / 2);
    const hl = Math.floor(Math.max(1, length) / 2);
    if (structure === "platform") {
        for (let x = -hw; x <= hw; x++)
            for (let z = -hl; z <= hl; z++)
                positions.push(new Vec3(x, 0, z));
    }
    else if (structure === "walls") {
        for (let y = 0; y < height; y++)
            for (let x = -hw; x <= hw; x++)
                for (let z = -hl; z <= hl; z++)
                    if (Math.abs(x) === hw || Math.abs(z) === hl)
                        positions.push(new Vec3(x, y, z));
    }
    else if (structure === "roof") {
        for (let y = 0; y <= Math.min(hw, hl); y++) {
            const ix = hw - y, iz = hl - y;
            for (let x = -ix; x <= ix; x++)
                for (let z = -iz; z <= iz; z++)
                    if (Math.abs(x) === ix || Math.abs(z) === iz)
                        positions.push(new Vec3(x, y, z));
        }
    }
    return positions;
}
