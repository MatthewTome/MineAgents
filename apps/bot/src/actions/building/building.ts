import { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { requireInventoryItem, expandMaterialAliases } from "../utils.js";
import { waitForNextTick, raceWithTimeout, moveToward } from "../movement.js";

const { goals } = pathfinderPkg;

export interface BuildParams {
    structure: 'platform' | 'wall' | 'walls' | 'tower' | 'roof' | 'door_frame' | 'door';
    origin: { x: number, y: number, z: number };
    material?: string;
    width?: number;
    height?: number;
    length?: number;
    door?: boolean; 
}

export async function executeBuild(bot: Bot, params: BuildParams): Promise<void> {
    const material = params.material ?? "dirt";
    const width = params.width ?? 7;
    const length = params.length ?? 7;
    const height = params.height ?? 4;
    let origin = new Vec3(params.origin.x, params.origin.y, params.origin.z);

    if (['walls', 'door', 'roof', 'door_frame'].includes(params.structure)) {
        const blockAtOrigin = bot.blockAt(origin);
        if (blockAtOrigin && blockAtOrigin.boundingBox !== 'empty' && blockAtOrigin.name !== 'air') {
            console.log(`[building] Origin ${origin} occupied by ${blockAtOrigin.name}. Shifting Y+1.`);
            origin = origin.offset(0, 1, 0);
        }
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

    const replaceableBlocks = expandMaterialAliases("replaceable");
    let failures = 0;

    for (const target of targets) {
        if (bot.entity.position.floored().equals(target)) {
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
    const aliases = expandMaterialAliases(name);
    return bot.inventory.items()
        .filter(i => aliases.some(a => i.name.includes(a)))
        .reduce((sum, i) => sum + i.count, 0);
}

function generatePlatform(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

function generateWalls(origin: Vec3, w: number, l: number, h: number, doorPos: Vec3 | null): Vec3[] {
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

function generateRoof(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

function generateDoorFrame(origin: Vec3): Vec3[] {
    return [
        origin.offset(-1, 0, 0), origin.offset(1, 0, 0), 
        origin.offset(-1, 1, 0), origin.offset(1, 1, 0),
        origin.offset(-1, 2, 0), origin.offset(0, 2, 0), origin.offset(1, 2, 0)
    ];
}