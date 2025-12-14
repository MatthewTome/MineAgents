import { Vec3 } from "vec3";
export function createDefaultActionHandlers() {
    return {
        move: handleMove,
        mine: handleMine,
        gather: handleGather,
        build: handleBuild,
        hunt: handleHunt,
        fish: handleFish,
        fight: handleFight
    };
}
async function handleMove(bot, step) {
    const params = step.params;
    const range = params?.range ?? 1.5;
    const timeoutMs = params?.timeoutMs ?? 15000;
    if (!params?.position && !params?.entityName) {
        throw new Error("Move action requires a position or entityName");
    }
    const targetPos = resolveTargetPosition(bot, params);
    await moveToward(bot, targetPos, range, timeoutMs);
}
async function handleMine(bot, step) {
    const params = step.params;
    if (!params?.block && !params?.position) {
        throw new Error("Mine action requires a block name or position");
    }
    const maxDistance = params.maxDistance ?? 32;
    const block = findBlockTarget(bot, params, maxDistance);
    if (!block) {
        throw new Error("No matching block found to mine");
    }
    const targetPos = block.position.clone().offset(0.5, 0.5, 0.5);
    await moveToward(bot, targetPos, 4, 20000);
    await bot.dig(block, true);
}
async function handleGather(bot, step) {
    const params = step.params;
    const matchName = params?.item?.toLowerCase();
    const target = findNearestEntity(bot, (entity) => {
        if (entity.name !== "item") {
            return false;
        }
        if (!matchName) {
            return true;
        }
        const dropped = entity.getDroppedItem?.();
        return dropped?.name?.toLowerCase() === matchName || dropped?.displayName?.toLowerCase() === matchName;
    }, params?.maxDistance ?? 48);
    if (!target) {
        throw new Error("No matching dropped items nearby");
    }
    await moveToward(bot, target.position, 1.5, params?.timeoutMs ?? 15000);
}
async function handleBuild(bot, step) {
    const params = step.params;
    if (!params?.structure) {
        throw new Error("Build action requires a structure type");
    }
    const rawOrigin = params.origin ? new Vec3(params.origin.x, params.origin.y, params.origin.z) : bot.entity.position;
    const origin = rawOrigin.floored();
    const structureBounds = getBlueprint(params.structure).map(p => origin.plus(p));
    const botPos = bot.entity.position.floored();
    const isObstructing = structureBounds.some(b => b.equals(botPos) || b.equals(botPos.offset(0, 1, 0)));
    if (isObstructing) {
        const safeSpot = findSafeSpotNear(bot, origin, structureBounds);
        await moveToward(bot, safeSpot, 0.5, 5000);
    }
    const materialName = (params.material ?? "cobblestone").toLowerCase();
    const blueprint = getBlueprint(params.structure);
    if (!blueprint.length) {
        throw new Error(`Unknown structure '${params.structure}'`);
    }
    const sortedBlocks = blueprint.map(pos => origin.plus(pos)).sort((a, b) => a.y - b.y);
    for (const pos of sortedBlocks) {
        const existing = bot.blockAt(pos);
        if (existing && existing.boundingBox !== "empty" && existing.name !== "water" && existing.name !== "lava") {
            continue;
        }
        const reference = findReferenceBlock(bot, pos);
        if (!reference) {
            continue;
        }
        const face = pos.minus(reference.position);
        const item = requireInventoryItem(bot, materialName);
        if (bot.inventory.slots[bot.getEquipmentDestSlot("hand")]?.name !== item.name) {
            await bot.equip(item, "hand");
            await waitForNextTick(bot);
        }
        await moveToward(bot, reference.position.offset(0.5, 0.5, 0.5), 3.5, 20000);
        await ensureNotOnPlacement(bot, pos);
        try {
            await bot.placeBlock(reference, face);
        }
        catch (err) {
            if (err.message.includes("timeout") || err.message.includes("range")) {
                await moveToward(bot, reference.position.offset(0.5, 0.5, 0.5), 2.0, 5000);
                await bot.placeBlock(reference, face);
            }
            else {
                throw err;
            }
        }
        await waitForNextTick(bot);
    }
}
async function handleHunt(bot, step) {
    const params = step.params;
    const match = params?.target?.toLowerCase();
    const target = findNearestEntity(bot, (entity) => {
        if (entity.type !== "mob")
            return false;
        if (!match)
            return true;
        const name = (entity.displayName ?? entity.name ?? "").toLowerCase();
        return name.includes(match);
    }, 64);
    if (!target) {
        throw new Error("No matching mob found to hunt");
    }
    await engageTarget(bot, target, params?.range ?? 2, params?.timeoutMs ?? 20000);
}
async function handleFight(bot, step) {
    const params = step.params;
    const match = params?.target?.toLowerCase();
    const aggression = params?.aggression ?? "any";
    const target = findNearestEntity(bot, (entity) => {
        if (entity.type !== "mob" && entity.type !== "player")
            return false;
        const name = (entity.displayName ?? entity.name ?? entity.username ?? "").toLowerCase();
        if (match && !name.includes(match))
            return false;
        if (aggression === "aggressive") {
            return entity.kind === "Hostile" || entity.metadata?.some((m) => m?.name === "target" && m?.value);
        }
        if (aggression === "passive") {
            return entity.kind !== "Hostile";
        }
        return true;
    }, 64);
    if (!target) {
        throw new Error("No matching target found to fight");
    }
    await engageTarget(bot, target, 2.5, params?.timeoutMs ?? 20000);
}
async function handleFish(bot, step) {
    const params = step.params;
    const casts = Math.max(1, params?.casts ?? 1);
    const rod = requireInventoryItem(bot, "fishing_rod");
    await bot.equip(rod, "hand");
    for (let i = 0; i < casts; i++) {
        await bot.fish();
    }
}
// --- Navigation Logic -------------------------------------------------------
async function moveToward(bot, target, stopDistance, timeoutMs) {
    const start = Date.now();
    let lastPos = bot.entity.position.clone();
    let stuckTicks = 0;
    const cleanup = () => {
        bot.clearControlStates();
        bot.stopDigging();
    };
    try {
        while (bot.entity.position.distanceTo(target) > stopDistance) {
            if (Date.now() - start > timeoutMs)
                throw new Error("Movement timed out");
            const distMoved = bot.entity.position.distanceTo(lastPos);
            if (distMoved < 0.2) {
                stuckTicks++;
            }
            else {
                stuckTicks = 0;
                lastPos = bot.entity.position.clone();
            }
            if (stuckTicks > 15) {
                await attemptUnstuck(bot, target, stuckTicks);
                if (stuckTicks > 20)
                    stuckTicks = 0;
                continue;
            }
            const nextSpot = findBestLocalStep(bot, target);
            if (nextSpot) {
                await lookAtAndSteer(bot, nextSpot);
            }
            else {
                await lookAtAndSteer(bot, target);
            }
            const pos = bot.entity.position;
            const velocity = bot.entity.velocity;
            const heading = new Vec3(-Math.sin(bot.entity.yaw), 0, Math.cos(bot.entity.yaw));
            const blockAhead = bot.blockAt(pos.plus(heading));
            if (bot.controlState.forward && blockAhead && blockAhead.boundingBox !== "empty" && velocity.x ** 2 + velocity.z ** 2 > 0.01) {
                bot.setControlState("jump", true);
            }
            else {
                if (stuckTicks < 5)
                    bot.setControlState("jump", false);
            }
            await waitForNextTick(bot);
        }
    }
    finally {
        cleanup();
    }
}
async function attemptUnstuck(bot, target, severity) {
    bot.setControlState("forward", false);
    if (severity < 30) {
        bot.setControlState("jump", true);
        bot.setControlState("sprint", true);
        const randomYaw = Math.random() * Math.PI * 2;
        await bot.look(randomYaw, 0, true);
        bot.setControlState("forward", true);
        await waitForNextTick(bot);
        await waitForNextTick(bot);
        return;
    }
    const eyePos = bot.entity.position.offset(0, 1.6, 0);
    const lookDir = target.minus(eyePos).normalize();
    const ray = bot.world.raycast(eyePos, lookDir, 2);
    if (ray && ray.block && ray.block.boundingBox !== "empty" && ray.block.name !== "bedrock") {
        if (bot.entity.onGround) {
            await bot.dig(ray.block, true);
            return;
        }
    }
    if (target.y > bot.entity.position.y + 1 && bot.entity.onGround) {
        const jumpBlock = bot.inventory.items().find(i => i.name.includes("dirt") || i.name.includes("cobblestone") || i.name.includes("stone"));
        if (jumpBlock) {
            await bot.equip(jumpBlock, "hand");
            bot.setControlState("jump", true);
            await bot.look(bot.entity.yaw, -Math.PI / 2, true);
            await waitForNextTick(bot);
            await waitForNextTick(bot);
            try {
                const blockBelow = bot.blockAt(bot.entity.position.offset(0, -1, 0));
                if (blockBelow)
                    await bot.placeBlock(blockBelow, new Vec3(0, 1, 0));
            }
            catch (e) { /* ignore placement err */ }
            return;
        }
    }
    bot.setControlState("back", true);
    await waitForNextTick(bot);
    await waitForNextTick(bot);
    bot.setControlState("back", false);
}
function findBestLocalStep(bot, globalTarget) {
    const pos = bot.entity.position.floored();
    const candidates = [];
    for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
            if (x === 0 && z === 0)
                continue;
            for (let y = -1; y <= 1; y++) {
                const candidate = pos.offset(x, y, z);
                if (!isSafeToStand(bot, candidate))
                    continue;
                const center = candidate.offset(0.5, 0, 0.5);
                const dist = center.distanceTo(globalTarget);
                const penalty = (y === 1) ? 0.5 : 0;
                candidates.push({ vec: center, score: dist + penalty });
            }
        }
    }
    candidates.sort((a, b) => a.score - b.score);
    if (candidates.length > 0)
        return candidates[0].vec;
    return null;
}
function isSafeToStand(bot, pos) {
    const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
    const blockFeet = bot.blockAt(pos);
    const blockHead = bot.blockAt(pos.offset(0, 1, 0));
    if (!blockBelow || !blockBelow.boundingBox || blockBelow.boundingBox === "empty")
        return false;
    if (blockBelow.name === "lava" || blockBelow.name === "fire" || blockBelow.name === "magma_block")
        return false;
    if (blockFeet && blockFeet.boundingBox !== "empty" && blockFeet.name !== "water")
        return false;
    if (blockHead && blockHead.boundingBox !== "empty")
        return false;
    return true;
}
async function lookAtAndSteer(bot, target) {
    await bot.lookAt(target, true);
    bot.setControlState("forward", true);
    const deltaY = target.y - bot.entity.position.y;
    if (deltaY > 0.5) {
        bot.setControlState("jump", true);
    }
}
// --- Helpers ---------------------------------------------------------------
function resolveTargetPosition(bot, params) {
    if (params.position) {
        return new Vec3(params.position.x, params.position.y, params.position.z);
    }
    if (params.entityName) {
        const lower = params.entityName.toLowerCase();
        const entity = findNearestEntity(bot, (e) => {
            const name = (e.username ?? e.displayName ?? e.name ?? "").toLowerCase();
            return name.includes(lower);
        }, 96);
        if (entity) {
            return entity.position.clone();
        }
    }
    throw new Error("Unable to resolve target position for move action");
}
function findBlockTarget(bot, params, maxDistance) {
    if (params.position) {
        const pos = new Vec3(params.position.x, params.position.y, params.position.z);
        return bot.blockAt(pos) ?? null;
    }
    const name = params.block?.toLowerCase();
    if (!name) {
        return null;
    }
    const aliases = expandMaterialAliases(name);
    return bot.findBlock({
        matching: (block) => aliases.includes(block.name.toLowerCase()),
        maxDistance
    }) ?? null;
}
function findReferenceBlock(bot, target) {
    const below = bot.blockAt(target.offset(0, -1, 0));
    if (below && below.boundingBox !== "empty") {
        return below;
    }
    const neighbors = [
        target.offset(1, 0, 0),
        target.offset(-1, 0, 0),
        target.offset(0, 0, 1),
        target.offset(0, 0, -1),
        target.offset(0, 1, 0)
    ];
    for (const pos of neighbors) {
        const block = bot.blockAt(pos);
        if (block && block.boundingBox !== "empty") {
            return block;
        }
    }
    return null;
}
async function ensureNotOnPlacement(bot, targetBlockPos, backAwayDistance = 1.5) {
    const botPos = bot.entity.position;
    const targetCenter = targetBlockPos.offset(0.5, 0, 0.5);
    const dist = botPos.distanceTo(targetCenter);
    if (dist < 1.3) {
        let retreatDir = (dist < 0.01) ? new Vec3(1, 0, 0) : botPos.minus(targetCenter).normalize();
        retreatDir.y = 0;
        retreatDir = retreatDir.normalize();
        const safeSpot = targetCenter.plus(retreatDir.scaled(backAwayDistance));
        await moveToward(bot, safeSpot, 0.2, 3000);
    }
}
function findSafeSpotNear(bot, origin, badPositions) {
    for (let r = 2; r < 6; r++) {
        for (let x = -r; x <= r; x++) {
            for (let z = -r; z <= r; z++) {
                const test = origin.offset(x, 0, z);
                if (badPositions.some(b => b.equals(test)))
                    continue;
                if (isSafeToStand(bot, test))
                    return test.offset(0.5, 0, 0.5);
            }
        }
    }
    return origin.offset(3, 0, 3);
}
function getBlueprint(structure) {
    const positions = [];
    if (structure === "platform") {
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                positions.push(new Vec3(x, 0, z));
            }
        }
    }
    else if (structure === "base") {
        for (let x = -1; x <= 1; x++) {
            for (let z = -1; z <= 1; z++) {
                positions.push(new Vec3(x, 0, z));
                if (Math.abs(x) === 1 || Math.abs(z) === 1) {
                    positions.push(new Vec3(x, 1, z));
                }
            }
        }
    }
    else if (structure === "house") {
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                positions.push(new Vec3(x, 0, z));
                if (Math.abs(x) === 2 || Math.abs(z) === 2) {
                    positions.push(new Vec3(x, 1, z));
                    positions.push(new Vec3(x, 2, z));
                }
            }
        }
        for (let x = -2; x <= 2; x++) {
            for (let z = -2; z <= 2; z++) {
                positions.push(new Vec3(x, 3, z));
            }
        }
    }
    else if (structure === "nether_portal") {
        const frame = [
            new Vec3(0, 0, 0), new Vec3(1, 0, 0),
            new Vec3(0, 1, 0), new Vec3(1, 1, 0),
            new Vec3(0, 2, 0), new Vec3(1, 2, 0),
            new Vec3(0, 3, 0), new Vec3(1, 3, 0),
            new Vec3(0, 4, 0), new Vec3(1, 4, 0),
            new Vec3(-1, 0, 0), new Vec3(2, 0, 0),
            new Vec3(-1, 4, 0), new Vec3(2, 4, 0)
        ];
        positions.push(...frame);
    }
    return positions;
}
function requireInventoryItem(bot, name) {
    const lower = name.toLowerCase();
    const aliases = expandMaterialAliases(lower);
    const item = bot.inventory.items().find((i) => {
        const itemName = i.name?.toLowerCase() ?? "";
        const display = i.displayName?.toLowerCase() ?? "";
        return aliases.includes(itemName) || aliases.includes(display) || itemName.includes(lower);
    });
    if (!item) {
        throw new Error(`Missing required item '${name}' in inventory`);
    }
    return item;
}
function expandMaterialAliases(name) {
    const lower = name.toLowerCase();
    const woodVariants = [
        "oak_planks", "spruce_planks", "birch_planks", "jungle_planks", "acacia_planks", "dark_oak_planks",
        "mangrove_planks", "cherry_planks", "bamboo_planks", "crimson_planks", "warped_planks",
        "oak_wood", "spruce_wood", "birch_wood", "jungle_wood", "acacia_wood", "dark_oak_wood",
        "mangrove_wood", "cherry_wood", "bamboo_block", "crimson_hyphae", "warped_hyphae",
        "stripped_oak_wood", "stripped_spruce_wood", "stripped_birch_wood", "stripped_jungle_wood",
        "stripped_acacia_wood", "stripped_dark_oak_wood", "stripped_mangrove_wood", "stripped_cherry_wood",
        "stripped_bamboo_block", "stripped_crimson_hyphae", "stripped_warped_hyphae"
    ];
    const stoneVariants = [
        "stone", "cobblestone", "stone_bricks", "mossy_stone_bricks", "granite", "polished_granite",
        "andesite", "polished_andesite", "diorite", "polished_diorite", "deepslate", "cobbled_deepslate",
        "polished_deepslate", "deepslate_bricks", "cracked_deepslate_bricks", "blackstone",
        "polished_blackstone", "blackstone_bricks", "tuff", "smooth_stone"
    ];
    if (lower.includes("wood") || lower.includes("plank")) {
        return Array.from(new Set([lower, ...woodVariants]));
    }
    if (lower.includes("stone") || lower.includes("cobble")) {
        return Array.from(new Set([lower, ...stoneVariants]));
    }
    return [lower];
}
function findNearestEntity(bot, predicate, maxDistance) {
    let best = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    for (const entity of Object.values(bot.entities)) {
        if (!predicate(entity)) {
            continue;
        }
        const distance = bot.entity.position.distanceTo(entity.position);
        if (distance < bestDistance && distance <= maxDistance) {
            best = entity;
            bestDistance = distance;
        }
    }
    return best;
}
async function engageTarget(bot, entity, range, timeoutMs) {
    const start = Date.now();
    while (bot.entity.position.distanceTo(entity.position) > range) {
        if (Date.now() - start > timeoutMs) {
            bot.clearControlStates();
            throw new Error("Failed to reach target in time");
        }
        await moveToward(bot, entity.position, range, timeoutMs - (Date.now() - start));
    }
    bot.clearControlStates();
    await bot.lookAt(entity.position, true);
    bot.attack(entity);
}
function waitForNextTick(bot) {
    return new Promise((resolve) => {
        const listener = () => {
            bot.removeListener("physicsTick", listener);
            resolve();
        };
        bot.on("physicsTick", listener);
    });
}
