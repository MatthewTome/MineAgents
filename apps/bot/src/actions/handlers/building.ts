import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import type { Block } from "prismarine-block";
import pathfinderPkg from "mineflayer-pathfinder";
import { waitForNextTick, raceWithTimeout, moveToward, findNearestEntity, MoveParams, handleMove } from "./movement.js";
import { requireInventoryItem, getReplaceableBlocks, resolveItemName, isItemMatch } from "../action-utils.js";

const { goals } = pathfinderPkg;
const MOVE_REQUEST_WAIT_MS = 3000;
const MAX_MOVE_REQUESTS = 2;

export interface BuildParams
{
    structure: 'platform' | 'wall' | 'walls' | 'tower' | 'roof' | 'door_frame' | 'door';
    origin: { x: number, y: number, z: number };
    material?: string;
    width?: number;
    height?: number;
    length?: number;
    door?: boolean; 
}

export interface PlaceParams
{
    item: string;
    position: { x: number, y: number, z: number };
}

export async function executeBuild(bot: Bot, params: BuildParams): Promise<void> {
    const isSingleBlockPlacement = 
        (params.structure === 'platform' && params.width === 1 && params.length === 1) ||
        (params.width === 1 && params.length === 1 && params.height === 1);

    if (isSingleBlockPlacement) {
        return handleSingleBlockPlacement(bot, params);
    }

    const material = resolveItemName(bot, params.material ?? "oak_planks");
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

    let targets: Vec3[] = [];
    let doorPos: Vec3 | null = null;

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
    } else if (params.door || params.structure === 'door') {
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
        if (a.y !== b.y) return a.y - b.y;
        return bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b);
    });

    const replaceableBlocks = getReplaceableBlocks();
    let failures = 0;

    const requestedMoves = new Map<string, number>();

    for (const target of targets) {
        const obstructer = findNearestEntity(bot, (e) => {
            if (!e || !e.position) return false;
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
                    if (!e || !e.position || e.username !== obstructer.username) return false;
                    return Math.abs(e.position.x - target.x) < 1.5 &&
                           Math.abs(e.position.z - target.z) < 1.5 &&
                           Math.abs(e.position.y - target.y) < 2;
                }, 3);

                if (stillBlocking) {
                    console.warn(`[building] ${obstructer.username} did not move. Will try to work around them.`);
                } else {
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
            if (existing && (existing.name === material || existing.name.includes(material))) continue;

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
        } catch (err) {
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

async function handleSingleBlockPlacement(bot: Bot, params: BuildParams): Promise<void> {
    console.log("[building] Detected single-block placement (1x1 platform). Switching to smart place mode.");

    let itemName = params.material;
    
    const hasPlanks = countInventoryItems(bot, params.material ?? "oak_planks") > 0;
    
    if (!hasPlanks) {
        const utilityBlocks = ["crafting_table", "furnace", "chest"];
        for (const util of utilityBlocks) {
            if (countInventoryItems(bot, util) > 0) {
                console.log(`[building] Implicit override: No planks found, but found ${util}. Using ${util} instead.`);
                itemName = util;
                break;
            }
        }
    }

    const material = resolveItemName(bot, itemName ?? "oak_planks");
    const origin = new Vec3(params.origin.x, params.origin.y, params.origin.z);

    console.log(`[building] Single block placement: ${material} at ${origin}`);
    
    await evacuateBuildArea(bot, [origin]);
    
    try {
        const item = requireInventoryItem(bot, material);
        await bot.equip(item, 'hand');
    } catch (err) {
        throw new Error(`Missing item for placement: ${material}`);
    }

    const success = await placeBlockAt(bot, origin);
    if (!success) {
        throw new Error(`Failed to place ${material} at ${origin}`);
    }
    
    console.log(`[building] Successfully placed ${material}`);
}

async function evacuateBuildArea(bot: Bot, targets: Vec3[]): Promise<void> {
    const myPos = bot.entity.position.floored();

    const isObstructing = targets.some(t => t.equals(myPos) || t.equals(myPos.offset(0, -1, 0)));

    if (!isObstructing) return;

    console.log("[building] Bot is obstructing the build blueprint. Relocating...");

    let bestSpot: Vec3 | null = null;
    let minDist = Infinity;

    for(let x=-5; x<=5; x++) {
        for(let z=-5; z<=5; z++) {
            const candidate = myPos.offset(x, 0, z);
            if (targets.some(t => t.x === candidate.x && t.z === candidate.z)) continue;

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
    } else {
        console.warn("[building] Could not find safe evacuation spot!");
    }
}

async function requestEntitiesClearArea(
    bot: Bot,
    targets: Vec3[],
    origin: Vec3,
    width: number,
    length: number
): Promise<void> {
    const halfW = Math.floor(width / 2);
    const halfL = Math.floor(length / 2);

    const blockingEntities = new Set<string>();
    const entities = Object.values(bot.entities);

    for (const entity of entities) {
        if (!entity || !entity.position) continue;
        if (entity === bot.entity) continue;

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
            if (!entity || !entity.position || entity.type !== "player") continue;
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
        } else {
            console.log("[building] All players have cleared the build area.");
        }
    }
}

async function placeBlockAt(bot: Bot, pos: Vec3): Promise<boolean> {
    const GoalPlaceBlock = (goals as any).GoalPlaceBlock;
    if (!GoalPlaceBlock) throw new Error("GoalPlaceBlock not found in pathfinder");

    if (bot.entity.position.distanceTo(pos) < 4.5) {
        const immediateSuccess = await placeWithRetry(bot, pos);
        if (immediateSuccess) return true;
    }

    try {
        const goal = new GoalPlaceBlock(pos, bot.world, {
            range: 4,
            faces: [new Vec3(0, 1, 0), new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)]
        });

        if (!bot.pathfinder) throw new Error("Pathfinder not loaded");

        await raceWithTimeout(bot.pathfinder.goto(goal), 20000);
        
        return await placeWithRetry(bot, pos);

    } catch (err) {
        bot.pathfinder.stop();
        console.warn(`[building] Path/Place failed at ${pos}: ${err}`);
        
        if (bot.entity.position.distanceTo(pos) < 5.0) {
             return await placeWithRetry(bot, pos);
        }
        return false;
    }
}

async function placeWithRetry(bot: Bot, pos: Vec3): Promise<boolean> {
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
    } catch (err: any) {
        bot.setControlState('sneak', false);
        const b = bot.blockAt(pos);
        if (b && b.name !== 'air' && b.boundingBox !== 'empty') return true;
        
        console.warn(`[building] Placement error: ${err.message}`);
        return false;
    }
}

function findPlaceRef(bot: Bot, pos: Vec3): { block: any, face: Vec3 } | null {
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

function isValidRef(block: any): boolean {
    return block && block.boundingBox !== 'empty' && block.name !== 'water' && block.name !== 'lava';
}

function countInventoryItems(bot: Bot, name: string): number {
    const target = resolveItemName(bot, name);
    const allItems = bot.inventory.items();

    let total = 0;
    for (const item of allItems)
    {
        if (isItemMatch(item.name, target))
        {
            total += item.count;
        }
    }

    console.log(`[building] Inventory check for '${target}': found ${total} items.`);
    return total;
}

export function generatePlatform(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

export function generateWalls(origin: Vec3, w: number, l: number, h: number, doorPos: Vec3 | null): Vec3[] {
    const blocks: Vec3[] = [];
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

export function generateRoof(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

export function generateDoorFrame(origin: Vec3): Vec3[] {
    return [
        origin.offset(-1, 0, 0), origin.offset(1, 0, 0), 
        origin.offset(-1, 1, 0), origin.offset(1, 1, 0),
        origin.offset(-1, 2, 0), origin.offset(0, 2, 0), origin.offset(1, 2, 0)
    ];
}

export async function handleBuild(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as BuildParams;
    const timeout = 180000;
    await raceWithTimeout(executeBuild(bot, params), timeout);
}

export type ScoutedBuildSite =
{
    origin: Vec3;
    size: number;
    radius: number;
    flatness: number;
    coverage: number;
    obstructions: number;
};

type BuildSiteOptions =
{
    size: number;
    maxRadius: number;
    heightTolerance: number;
    minCoverage: number;
};

const TILE_ENTITY_BLOCKS =
[
    "chest", "trapped_chest", "ender_chest", "barrel",
    "furnace", "blast_furnace", "smoker",
    "crafting_table", "fletching_table", "cartography_table", "loom",
    "anvil", "chipped_anvil", "damaged_anvil",
    "enchanting_table", "brewing_stand", "cauldron",
    "hopper", "dropper", "dispenser",
    "bed", "respawn_anchor",
    "beacon", "conduit",
    "sign", "wall_sign", "hanging_sign",
    "banner", "wall_banner",
    "campfire", "soul_campfire",
    "lectern", "bell", "grindstone", "stonecutter",
    "jukebox", "note_block",
    "beehive", "bee_nest",
    "decorated_pot", "suspicious_sand", "suspicious_gravel"
];

type SiteEvaluation =
{
    site: ScoutedBuildSite;
    score: number;
} | null;

const DEFAULT_BUILD_SITE: BuildSiteOptions = {
    size: 7,
    maxRadius: 16,
    heightTolerance: 1,
    minCoverage: 0.9
};

export function goalNeedsBuildSite(goal: string): boolean {
    const lower = goal.toLowerCase();
    return ["build", "shelter", "house", "hut", "base", "home"].some(keyword => lower.includes(keyword));
}

export function suggestedBuildSize(goal: string): number {
    const lower = goal.toLowerCase();
    if (lower.includes("large")) return 9;
    if (lower.includes("small") || lower.includes("tiny")) return 5;
    return 7;
}

export function scoutBuildSite(bot: Bot, goal: string, options?: Partial<BuildSiteOptions>): ScoutedBuildSite | null {
    const cfg: BuildSiteOptions = {
        ...DEFAULT_BUILD_SITE,
        ...options,
        size: options?.size ?? suggestedBuildSize(goal)
    };

    const base = bot.entity.position.floored();
    const half = Math.floor(cfg.size / 2);
    let best: ScoutedBuildSite | null = null;
    let bestScore = Infinity;

    const candidates: { site: ScoutedBuildSite; score: number }[] = [];

    for (let radius = 2; radius <= cfg.maxRadius; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
                const candidate = base.offset(dx, 0, dz);
                const site = evaluateCandidate(bot, candidate, cfg, half);
                if (!site) continue;

                const obstructionPenalty = site.obstructions * 50;
                const score = candidate.distanceTo(base) + (1 - site.coverage) * 10 + site.flatness * 2 + obstructionPenalty;

                candidates.push({ site, score });
            }
        }

        const unobstructed = candidates.filter(c => c.site.obstructions === 0);
        if (unobstructed.length > 0) {
            const bestUnobstructed = unobstructed.reduce((a, b) => a.score < b.score ? a : b);
            if (bestUnobstructed.score < bestScore) {
                best = bestUnobstructed.site;
                bestScore = bestUnobstructed.score;
            }
            break;
        }
    }

    if (!best && candidates.length > 0) {
        const sorted = candidates.sort((a, b) => a.score - b.score);
        best = sorted[0].site;
        bestScore = sorted[0].score;

        if (best.obstructions > 0) {
            console.warn(`[scouting] Warning: Selected build site has ${best.obstructions} obstructions. Consider clearing the area first.`);
        }
    }

    if (best) {
        console.log(`[scouting] Selected build site at ${best.origin} (obstructions: ${best.obstructions}, flatness: ${best.flatness}, coverage: ${best.coverage.toFixed(2)})`);
    }

    return best;
}

function evaluateCandidate(bot: Bot, center: Vec3, cfg: BuildSiteOptions, half: number): ScoutedBuildSite | null {
    const surfaceYs: number[] = [];
    let checked = 0;
    let valid = 0;
    let obstructions = 0;

    for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
            checked++;
            const column = center.offset(dx, 0, dz);
            const surface = findSurfaceY(bot, column, 2);
            if (surface == null) continue;
            valid++;
            surfaceYs.push(surface);

            for (let dy = 0; dy <= 4; dy++) {
                const checkPos = new Vec3(column.x, surface + dy, column.z);
                const block = bot.blockAt(checkPos);
                if (block && isTileEntityBlock(block.name)) {
                    obstructions++;
                }
            }
        }
    }

    const entities = Object.values(bot.entities);
    for (const entity of entities) {
        if (!entity || !entity.position) continue;
        if (entity === bot.entity) continue;

        const ex = entity.position.x;
        const ez = entity.position.z;

        if (ex >= center.x - half && ex <= center.x + half &&
            ez >= center.z - half && ez <= center.z + half) {
            if (entity.type === "player") {
                obstructions += 10;
            } else if (entity.type === "mob") {
                obstructions += 2;
            } else {
                obstructions += 1;
            }
        }
    }

    if (valid / checked < cfg.minCoverage) return null;

    const minY = Math.min(...surfaceYs);
    const maxY = Math.max(...surfaceYs);
    const flatness = maxY - minY;
    if (flatness > cfg.heightTolerance) return null;

    const avgY = Math.round(surfaceYs.reduce((sum, y) => sum + y, 0) / surfaceYs.length);
    const origin = new Vec3(center.x, avgY + 1, center.z);

    return {
        origin,
        size: cfg.size,
        radius: Math.round(center.distanceTo(bot.entity.position)),
        flatness,
        coverage: valid / checked,
        obstructions
    };
}

function isTileEntityBlock(blockName: string): boolean {
    const lower = blockName.toLowerCase();
    return TILE_ENTITY_BLOCKS.some(te => lower.includes(te));
}

function findSurfaceY(bot: Bot, column: Vec3, searchHeight: number): number | null {
    const baseY = column.y;
    for (let dy = searchHeight; dy >= -searchHeight; dy--) {
        const y = baseY + dy;
        const ground = bot.blockAt(new Vec3(column.x, y, column.z));
        const above = bot.blockAt(new Vec3(column.x, y + 1, column.z));
        const above2 = bot.blockAt(new Vec3(column.x, y + 2, column.z));
        if (!isSolidGround(ground)) continue;
        if (!isAir(above) || !isAir(above2)) continue;
        return y;
    }
    return null;
}

function isSolidGround(block: ReturnType<Bot["blockAt"]>): boolean {
    if (!block) return false;
    if (block.boundingBox === "empty") return false;
    const name = block.name;
    if (name.includes("water") || name.includes("lava")) return false;
    return true;
}

function isAir(block: ReturnType<Bot["blockAt"]>): boolean {
    if (!block) return true;
    return block.boundingBox === "empty" || block.name === "air";
}

export function findReferenceBlock(bot: Bot, target: Vec3): Block | null
{
    const neighbors = [
        target.offset(0, -1, 0),
        target.offset(0, 1, 0),
        target.offset(1, 0, 0),
        target.offset(-1, 0, 0),
        target.offset(0, 0, 1),
        target.offset(0, 0, -1)
    ];
    for (const p of neighbors)
    {
        const block = bot.blockAt(p);
        if (block && block.boundingBox !== "empty" && !block.name.includes("water") && !block.name.includes("lava"))
        {
            return block;
        }
    }
    return null;
}

export async function handlePlace(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as PlaceParams;
    
    if (!params.item || !params.position) {
        throw new Error("Place action requires 'item' and 'position' parameters.");
    }

    const targetPos = new Vec3(params.position.x, params.position.y, params.position.z).floored();
    const material = resolveItemName(bot, params.item);

    console.log(`[place] Attempting to place ${material} at ${targetPos}`);

    await evacuateBuildArea(bot, [targetPos]);

    const count = countInventoryItems(bot, material);
    if (count === 0) {
        throw new Error(`Cannot place ${material} - none in inventory.`);
    }

    try {
        const item = requireInventoryItem(bot, material);
        await bot.equip(item, 'hand');
    } catch (err) {
        throw new Error(`Failed to equip ${material}: ${err}`);
    }

    const dist = bot.entity.position.distanceTo(targetPos);
    if (dist > 4.5) {
        console.log(`[place] Moving closer to target (current dist: ${dist.toFixed(1)})`);
        await moveToward(bot, targetPos, 3.5, 10000); 
    }

    const success = await placeBlockAt(bot, targetPos);

    if (!success) {
        throw new Error(`Failed to place ${material} at ${targetPos} (check for obstructions or lack of support block).`);
    }

    console.log(`[place] Successfully placed ${material}.`);
}