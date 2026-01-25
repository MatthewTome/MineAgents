import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { requireInventoryItem, expandMaterialAliases } from "../utils.js";
import { waitForNextTick, raceWithTimeout, moveToward, findNearestEntity } from "../movement.js";
const { goals } = pathfinderPkg;
const MOVE_REQUEST_WAIT_MS = 3000;
const MAX_MOVE_REQUESTS = 2;
export async function executeBuild(bot, params) {
    const material = params.material ?? "dirt";
    const width = params.width ?? 7;
    const length = params.length ?? 7;
    const height = params.height ?? 4;
    let origin = new Vec3(params.origin.x, params.origin.y, params.origin.z);
    if (['walls', 'door', 'door_frame'].includes(params.structure)) {
        const blockAtOrigin = bot.blockAt(origin);
        if (blockAtOrigin && blockAtOrigin.boundingBox !== 'empty' && blockAtOrigin.name !== 'air') {
            console.log(`[building] Origin ${origin} occupied by ${blockAtOrigin.name}. Shifting Y+1.`);
            origin = origin.offset(0, 1, 0);
        }
    }
    if (params.structure === 'roof') {
        console.log(`[building] Roof origin set to Y=${origin.y}. Ensure this is at the correct height (foundation Y + wall height).`);
    }
    console.log(`[building] Starting ${params.structure} at ${origin} using ${material}`);
    let targets = [];
    let doorPos = null;
    if (params.structure === 'walls' && params.door) {
        for (let x = 0; x < width; x++) {
            for (let z = 0; z < length; z++) {
                if (x === 0 || x === width - 1 || z === 0 || z === length - 1) {
                    const checkPos = origin.offset(x, 0, z);
                    const b = bot.blockAt(checkPos);
                    if (b && b.name.includes("door") && !b.name.includes("trap")) {
                        doorPos = checkPos;
                        console.log(`[building] Detected existing door at ${doorPos}, aligning wall gap.`);
                    }
                }
            }
        }
        if (!doorPos) {
            const doorX = Math.floor(width / 2);
            doorPos = origin.offset(doorX, 0, 0);
        }
    }
    else if (params.door || params.structure === 'door') {
        const doorX = Math.floor(width / 2);
        doorPos = origin.offset(doorX, 0, 0);
    }
    switch (params.structure) {
        case 'platform':
            targets = generatePlatform(origin, width, length);
            break;
        case 'walls':
            targets = generateWalls(origin, width, length, height, doorPos);
            break;
        case 'roof':
            targets = generateRoof(origin, width, length);
            break;
        case 'door_frame':
            targets = generateDoorFrame(origin);
            break;
        case 'door':
            if (!doorPos) {
                const doorX = Math.floor(width / 2);
                doorPos = origin.offset(doorX, 0, 0);
            }
            targets = [doorPos];
            break;
        default:
            throw new Error(`Unknown structure type: ${params.structure}`);
    }
    await evacuateBuildArea(bot, targets);
    await requestEntitiesClearArea(bot, targets, origin, width, length);
    const inventoryCount = countInventoryItems(bot, material);
    const actualNeeded = targets.filter(t => {
        const b = bot.blockAt(t);
        return !b || b.boundingBox === 'empty' || (b.name !== material && !b.name.includes(material));
    }).length;
    if (inventoryCount < actualNeeded) {
        throw new Error(`Insufficient materials for ${params.structure}. Need ${actualNeeded} ${material}, but only have ${inventoryCount}.`);
    }
    targets.sort((a, b) => {
        if (a.y !== b.y)
            return a.y - b.y;
        return bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b);
    });
    const replaceableBlocks = expandMaterialAliases("replaceable");
    let failures = 0;
    const requestedMoves = new Map();
    for (const target of targets) {
        const obstructer = findNearestEntity(bot, (e) => {
            if (!e || !e.position)
                return false;
            const entityPos = e.position.floored();
            return entityPos.equals(target) ||
                entityPos.equals(target.offset(0, 1, 0)) ||
                (Math.abs(e.position.x - target.x) < 1.5 &&
                    Math.abs(e.position.z - target.z) < 1.5 &&
                    Math.abs(e.position.y - target.y) < 2);
        }, 3);
        if (obstructer && obstructer.username && obstructer.username !== bot.username) {
            const entityKey = obstructer.username;
            const requestCount = requestedMoves.get(entityKey) ?? 0;
            if (requestCount < MAX_MOVE_REQUESTS) {
                bot.chat(`Hey @${obstructer.username}, you are in my build path at ${target}. Please move!`);
                requestedMoves.set(entityKey, requestCount + 1);
                console.log(`[building] Waiting for ${obstructer.username} to move from ${target}...`);
                await new Promise(resolve => setTimeout(resolve, MOVE_REQUEST_WAIT_MS));
                const stillBlocking = findNearestEntity(bot, (e) => {
                    if (!e || !e.position || e.username !== obstructer.username)
                        return false;
                    return Math.abs(e.position.x - target.x) < 1.5 &&
                        Math.abs(e.position.z - target.z) < 1.5 &&
                        Math.abs(e.position.y - target.y) < 2;
                }, 3);
                if (stillBlocking) {
                    console.warn(`[building] ${obstructer.username} did not move. Will try to work around them.`);
                }
                else {
                    console.log(`[building] ${obstructer.username} moved. Continuing build.`);
                }
            }
        }
        if (bot.entity.position.floored().equals(target) ||
            (Math.abs(bot.entity.position.x - target.x) < 1 &&
                Math.abs(bot.entity.position.z - target.z) < 1 &&
                Math.abs(bot.entity.position.y - target.y) < 2)) {
            await evacuateBuildArea(bot, targets);
        }
        const existing = bot.blockAt(target);
        if (params.structure === 'door') {
            if (existing && existing.name.includes("door") && !existing.name.includes("trapdoor")) {
                console.log(`[building] Door already exists at ${target}`);
                continue;
            }
        }
        else {
            if (existing && (existing.name === material || existing.name.includes(material)))
                continue;
            if (existing && existing.boundingBox !== 'empty') {
                if (!replaceableBlocks.includes(existing.name)) {
                    console.log(`[building] Skipping occupied block at ${target} (${existing.name})`);
                    continue;
                }
            }
        }
        try {
            const item = requireInventoryItem(bot, material);
            await bot.equip(item, 'hand');
        }
        catch (err) {
            throw new Error(`Out of building materials: ${material}`);
        }
        const success = await placeBlockAt(bot, target);
        if (!success) {
            failures++;
        }
    }
    if (failures > 0) {
        const msg = `[building] Finished ${params.structure} but failed to place ${failures} blocks. Structure incomplete.`;
        console.warn(msg);
        throw new Error(msg);
    }
    console.log(`[building] Finished ${params.structure}`);
}
async function evacuateBuildArea(bot, targets) {
    const myPos = bot.entity.position.floored();
    const isObstructing = targets.some(t => t.equals(myPos) || t.equals(myPos.offset(0, -1, 0)));
    if (!isObstructing)
        return;
    console.log("[building] Bot is obstructing the build blueprint. Relocating...");
    let bestSpot = null;
    let minDist = Infinity;
    for (let x = -5; x <= 5; x++) {
        for (let z = -5; z <= 5; z++) {
            const candidate = myPos.offset(x, 0, z);
            if (targets.some(t => t.x === candidate.x && t.z === candidate.z))
                continue;
            const ground = bot.blockAt(candidate.offset(0, -1, 0));
            const feet = bot.blockAt(candidate);
            const head = bot.blockAt(candidate.offset(0, 1, 0));
            if (ground && ground.boundingBox !== 'empty' && feet && feet.boundingBox === 'empty' && head && head.boundingBox === 'empty') {
                const d = candidate.distanceTo(myPos);
                if (d < minDist) {
                    minDist = d;
                    bestSpot = candidate;
                }
            }
        }
    }
    if (bestSpot) {
        await moveToward(bot, bestSpot.offset(0.5, 0, 0.5), 0.5, 5000).catch(e => console.warn("[building] Evacuation move partial:", e));
    }
    else {
        console.warn("[building] Could not find safe evacuation spot!");
    }
}
async function requestEntitiesClearArea(bot, targets, origin, width, length) {
    const halfW = Math.floor(width / 2);
    const halfL = Math.floor(length / 2);
    const blockingEntities = new Set();
    const entities = Object.values(bot.entities);
    for (const entity of entities) {
        if (!entity || !entity.position)
            continue;
        if (entity === bot.entity)
            continue;
        const ex = entity.position.x;
        const ez = entity.position.z;
        const ey = entity.position.y;
        const inXRange = ex >= origin.x - 1 && ex <= origin.x + width + 1;
        const inZRange = ez >= origin.z - 1 && ez <= origin.z + length + 1;
        const inYRange = ey >= origin.y - 1 && ey <= origin.y + 10;
        if (inXRange && inZRange && inYRange) {
            if (entity.type === "player" && entity.username && entity.username !== bot.username) {
                blockingEntities.add(entity.username);
            }
        }
    }
    if (blockingEntities.size === 0) {
        console.log("[building] Build area is clear of other players.");
        return;
    }
    const entityList = Array.from(blockingEntities);
    console.log(`[building] Found ${entityList.length} player(s) in build area: ${entityList.join(", ")}`);
    for (const username of entityList) {
        bot.chat(`Hey @${username}, I'm about to build here. Please move at least 5 blocks away from ${Math.floor(origin.x)}, ${Math.floor(origin.y)}, ${Math.floor(origin.z)}!`);
    }
    if (entityList.length > 0) {
        console.log(`[building] Waiting ${MOVE_REQUEST_WAIT_MS}ms for players to clear the area...`);
        await new Promise(resolve => setTimeout(resolve, MOVE_REQUEST_WAIT_MS));
        let stillBlocking = 0;
        for (const entity of Object.values(bot.entities)) {
            if (!entity || !entity.position || entity.type !== "player")
                continue;
            if (entity.username && blockingEntities.has(entity.username)) {
                const ex = entity.position.x;
                const ez = entity.position.z;
                if (ex >= origin.x - 1 && ex <= origin.x + width + 1 &&
                    ez >= origin.z - 1 && ez <= origin.z + length + 1) {
                    stillBlocking++;
                }
            }
        }
        if (stillBlocking > 0) {
            console.warn(`[building] ${stillBlocking} player(s) still in build area. Will attempt to build around them.`);
        }
        else {
            console.log("[building] All players have cleared the build area.");
        }
    }
}
async function placeBlockAt(bot, pos) {
    const GoalPlaceBlock = goals.GoalPlaceBlock;
    if (!GoalPlaceBlock)
        throw new Error("GoalPlaceBlock not found in pathfinder");
    if (bot.entity.position.distanceTo(pos) < 4.5) {
        const immediateSuccess = await placeWithRetry(bot, pos);
        if (immediateSuccess)
            return true;
    }
    try {
        const goal = new GoalPlaceBlock(pos, bot.world, {
            range: 4,
            faces: [new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
        });
        if (!bot.pathfinder)
            throw new Error("Pathfinder not loaded");
        await raceWithTimeout(bot.pathfinder.goto(goal), 20000);
        return await placeWithRetry(bot, pos);
    }
    catch (err) {
        bot.pathfinder.stop();
        console.warn(`[building] Path/Place failed at ${pos}: ${err}`);
        if (bot.entity.position.distanceTo(pos) < 5.0) {
            return await placeWithRetry(bot, pos);
        }
        return false;
    }
}
async function placeWithRetry(bot, pos) {
    const reference = findPlaceRef(bot, pos);
    if (!reference) {
        console.warn(`[building] No reference block to place ${pos} against.`);
        return false;
    }
    try {
        const lookTarget = reference.block.position.offset(0.5, 0.5, 0.5).plus(reference.face.scaled(0.5));
        await bot.lookAt(lookTarget, true);
        bot.setControlState('sneak', true);
        await bot.placeBlock(reference.block, reference.face);
        bot.setControlState('sneak', false);
        await waitForNextTick(bot);
        return true;
    }
    catch (err) {
        bot.setControlState('sneak', false);
        const b = bot.blockAt(pos);
        if (b && b.name !== 'air' && b.boundingBox !== 'empty')
            return true;
        console.warn(`[building] Placement error: ${err.message}`);
        return false;
    }
}
function findPlaceRef(bot, pos) {
    const below = pos.offset(0, -1, 0);
    const blockBelow = bot.blockAt(below);
    if (isValidRef(blockBelow)) {
        return { block: blockBelow, face: new Vec3(0, 1, 0) };
    }
    const faces = [
        new Vec3(0, 1, 0),
        new Vec3(-1, 0, 0), new Vec3(1, 0, 0),
        new Vec3(0, 0, -1), new Vec3(0, 0, 1)
    ];
    for (const face of faces) {
        const neighbor = bot.blockAt(pos.plus(face));
        if (isValidRef(neighbor)) {
            return { block: neighbor, face: face.scaled(-1) };
        }
    }
    return null;
}
function isValidRef(block) {
    return block && block.boundingBox !== 'empty' && block.name !== 'water' && block.name !== 'lava';
}
function countInventoryItems(bot, name) {
    const aliases = expandMaterialAliases(name);
    const normalizedName = name.toLowerCase().replace(/_/g, "");
    const allItems = bot.inventory.items();
    let total = 0;
    for (const item of allItems) {
        const itemName = item.name.toLowerCase();
        const itemNameNormalized = itemName.replace(/_/g, "");
        if (itemName === name.toLowerCase()) {
            total += item.count;
            continue;
        }
        if (aliases.some(a => itemName === a.toLowerCase() || itemName.includes(a.toLowerCase()))) {
            total += item.count;
            continue;
        }
        if (itemNameNormalized.includes(normalizedName) || normalizedName.includes(itemNameNormalized)) {
            total += item.count;
            continue;
        }
    }
    console.log(`[building] Inventory check for '${name}': found ${total} items (aliases: ${aliases.join(", ")})`);
    return total;
}
function generatePlatform(origin, w, l) {
    const blocks = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}
function generateWalls(origin, w, l, h, doorPos) {
    const blocks = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            for (let z = 0; z < l; z++) {
                if (x === 0 || x === w - 1 || z === 0 || z === l - 1) {
                    const absPos = origin.offset(x, y, z);
                    if (doorPos && absPos.x === doorPos.x && absPos.z === doorPos.z && y < 2) {
                        continue;
                    }
                    blocks.push(absPos);
                }
            }
        }
    }
    return blocks;
}
function generateRoof(origin, w, l) {
    const blocks = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}
function generateDoorFrame(origin) {
    return [
        origin.offset(-1, 0, 0), origin.offset(1, 0, 0),
        origin.offset(-1, 1, 0), origin.offset(1, 1, 0),
        origin.offset(-1, 2, 0), origin.offset(0, 2, 0), origin.offset(1, 2, 0)
    ];
}
