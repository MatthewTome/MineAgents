import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
import { waitForNextTick, raceWithTimeout } from "../moving/move.js";
import { resolveItemName, requireInventoryItem } from "../../utils.js";
import { moveWithMovementPlugin } from "../moving/move.js";
import { PlaceParams } from "../building/types.js";
import { countInventoryItems } from "../building/utils.js";
import { evacuateBuildArea } from "../building/safety.js";

const { goals } = pathfinderPkg;

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
        try {
            await moveWithMovementPlugin(bot, targetPos, 3.5, 10000); 
        } catch (err) {
            console.warn(`[place] Pre-movement failed: ${err}. Attempting placement anyway.`);
        }
    }

    const success = await placeBlockAt(bot, targetPos);

    if (!success) {
        throw new Error(`Failed to place ${material} at ${targetPos} (check for obstructions or lack of support block).`);
    }

    console.log(`[place] Successfully placed ${material}.`);
}

export async function placeBlockAt(bot: Bot, pos: Vec3): Promise<boolean> {
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
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[building] Path/Place failed at ${pos}: ${errMsg}`);
        
        if (bot.entity.position.distanceTo(pos) < 6.0) {
             console.log(`[building] Attempting blind placement fallback at ${pos}`);
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