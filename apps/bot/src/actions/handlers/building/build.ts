import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { raceWithTimeout, findNearestEntity, moveWithMovementPlugin } from "../moving/move.js";
import { requireInventoryItem, getReplaceableBlocks, resolveItemName } from "../../utils.js";
import { BuildParams } from "./types.js";
import { countInventoryItems } from "./utils.js";
import { generatePlatform, generateWalls, generateRoof, generateDoorFrame } from "./blueprints.js";
import { evacuateBuildArea, requestEntitiesClearArea } from "./safety.js";
import { placeBlockAt } from "../placing/place.js";

const MOVE_REQUEST_WAIT_MS = 3000;
const MAX_MOVE_REQUESTS = 2;

type BuildTarget = { pos: Vec3; material: string };

function resolveDoorPosition(origin: Vec3, width: number): Vec3
{
    const doorX = Math.floor(width / 2);
    return origin.offset(doorX, 0, 0);
}

function generateShelterTargets(origin: Vec3, width: number, length: number, height: number, wallMaterial: string, doorMaterial: string): BuildTarget[]
{
    const wallOrigin = origin.offset(0, 1, 0);
    const doorPos = resolveDoorPosition(wallOrigin, width);

    const floor = generatePlatform(origin, width, length).map((pos) => ({ pos, material: wallMaterial }));
    const walls = generateWalls(wallOrigin, width, length, height, doorPos).map((pos) => ({ pos, material: wallMaterial }));
    const roof = generateRoof(wallOrigin, width, length).map((pos) => ({ pos, material: wallMaterial }));
    const door = [{ pos: doorPos, material: doorMaterial }];

    return [...floor, ...walls, ...roof, ...door];
}

export async function executeBuild(bot: Bot, params: BuildParams): Promise<void>
{
    const isSingleBlockPlacement =
        (params.structure === "platform" && params.width === 1 && params.length === 1) ||
        (params.width === 1 && params.length === 1 && params.height === 1);

    if (isSingleBlockPlacement) 
    {
        return handleSingleBlockPlacement(bot, params);
    }

    const isShelterBuild = params.structure === "shelter";
    const width = params.width ?? (isShelterBuild ? 5 : 7);
    const length = params.length ?? (isShelterBuild ? 5 : 7);
    const height = params.height ?? (isShelterBuild ? 3 : 4);
    const wallMaterial = resolveItemName(bot, isShelterBuild ? "oak_planks" : (params.material ?? "oak_planks"));
    const doorMaterial = resolveItemName(bot, "oak_door");
    let origin = params.origin ? new Vec3(params.origin.x, params.origin.y, params.origin.z) : bot.entity.position.floored();

    if (["walls", "door", "door_frame", "shelter"].includes(params.structure))
    {
        const blockAtOrigin = bot.blockAt(origin);
        if (blockAtOrigin && blockAtOrigin.boundingBox !== "empty" && blockAtOrigin.name !== "air")
        {
            console.log(`[building] Origin ${origin} occupied by ${blockAtOrigin.name}. Shifting Y+1.`);
            origin = origin.offset(0, 1, 0);
        }
    }

    if (params.structure === "roof")
    {
        console.log(`[building] Roof origin set to Y=${origin.y}. Ensure this is at the correct height (foundation Y + wall height).`);
    }

    console.log(`[building] Starting ${params.structure} at ${origin} using ${wallMaterial}`);

    let targets: BuildTarget[] = [];
    let doorPos: Vec3 | null = null;

    if (params.structure === "walls" && params.door)
    {
        for (let x = 0; x < width; x++)
        {
            for (let z = 0; z < length; z++) 
            {
                if (x === 0 || x === width - 1 || z === 0 || z === length - 1)
                {
                    const checkPos = origin.offset(x, 0, z);
                    const b = bot.blockAt(checkPos);
                    if (b && b.name.includes("door") && !b.name.includes("trap"))
                    {
                        doorPos = checkPos;
                        console.log(`[building] Detected existing door at ${doorPos}, aligning wall gap.`);
                    }
                }
            }
        }
        
        if (!doorPos)
        {
            doorPos = resolveDoorPosition(origin, width);
        }
    }
    else if (params.door || params.structure === "door")
    {
        doorPos = resolveDoorPosition(origin, width);
    }

    switch (params.structure)
    {
        case "platform":
            targets = generatePlatform(origin, width, length).map((pos) => ({ pos, material: wallMaterial }));
            break;
        case "walls":
            targets = generateWalls(origin, width, length, height, doorPos).map((pos) => ({ pos, material: wallMaterial }));
            break;
        case "roof":
            targets = generateRoof(origin, width, length).map((pos) => ({ pos, material: wallMaterial }));
            break;
        case "door_frame":
            targets = generateDoorFrame(origin).map((pos) => ({ pos, material: wallMaterial }));
            break;
        case "door":
            if (!doorPos)
            {
                doorPos = resolveDoorPosition(origin, width);
            }
            targets = [{ pos: doorPos, material: doorMaterial }];
            break;
        case "shelter":
            targets = generateShelterTargets(origin, width, length, height, wallMaterial, doorMaterial);
            break;
        default:
            throw new Error(`Unknown structure type: ${params.structure}`);
    }

    const targetPositions = targets.map((t) => t.pos);
    await evacuateBuildArea(bot, targetPositions);
    await requestEntitiesClearArea(bot, targetPositions, origin, width, length);

    const neededByMaterial = new Map<string, number>();
    for (const target of targets)
    {
        const existing = bot.blockAt(target.pos);
        const isDoorPlacement = target.material.includes("door") && !target.material.includes("trapdoor");
        if (isDoorPlacement)
        {
            if (existing && existing.name.includes("door") && !existing.name.includes("trapdoor"))
            {
                continue;
            }
        }
        else if (existing && existing.boundingBox !== "empty" && (existing.name === target.material || existing.name.includes(target.material)))
        {
            continue;
        }
        neededByMaterial.set(target.material, (neededByMaterial.get(target.material) ?? 0) + 1);
    }

    for (const [material, needed] of neededByMaterial.entries())
    {
        const inventoryCount = countInventoryItems(bot, material);
        if (inventoryCount < needed)
        {
            throw new Error(`Insufficient materials for ${params.structure}. Need ${needed} ${material}, but only have ${inventoryCount}.`);
        }
    }

    targets.sort((a, b) =>
    {
        if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;

        return bot.entity.position.distanceTo(a.pos) - bot.entity.position.distanceTo(b.pos);
    });

    const replaceableBlocks = getReplaceableBlocks();
    let failures = 0;

    const requestedMoves = new Map<string, number>();

    for (const targetInfo of targets)
    {
        const target = targetInfo.pos;
        const targetMaterial = targetInfo.material;
        const isDoorPlacement = targetMaterial.includes("door") && !targetMaterial.includes("trapdoor");
        const obstructer = findNearestEntity(bot, (e) =>
        {
            if (!e || !e.position) return false;

            const entityPos = e.position.floored();
            return entityPos.equals(target) ||
                entityPos.equals(target.offset(0, 1, 0)) ||
                (Math.abs(e.position.x - target.x) < 1.5 &&
                Math.abs(e.position.z - target.z) < 1.5 &&
                Math.abs(e.position.y - target.y) < 2);
        }, 3);

        if (obstructer && obstructer.username && obstructer.username !== bot.username)
        {
            const entityKey = obstructer.username;
            const requestCount = requestedMoves.get(entityKey) ?? 0;

            if (requestCount < MAX_MOVE_REQUESTS)
            {
                bot.chat(`Hey @${obstructer.username}, you are in my build path at ${target}. Please move!`);
                requestedMoves.set(entityKey, requestCount + 1);

                console.log(`[building] Waiting for ${obstructer.username} to move from ${target}...`);
                await new Promise(resolve => setTimeout(resolve, MOVE_REQUEST_WAIT_MS));

                const stillBlocking = findNearestEntity(bot, (e) =>
                {
                    if (!e || !e.position || e.username !== obstructer.username) return false;

                    return Math.abs(e.position.x - target.x) < 1.5 &&
                        Math.abs(e.position.z - target.z) < 1.5 &&
                        Math.abs(e.position.y - target.y) < 2;
                }, 3);

                if (stillBlocking)
                {
                    console.warn(`[building] ${obstructer.username} did not move. Will try to work around them.`);
                }
                else
                {
                    console.log(`[building] ${obstructer.username} moved. Continuing build.`);
                }
            }
        }

        if (bot.entity.position.distanceTo(target) > 4.5) {
            console.log(`[building] Target ${target} is too far (${bot.entity.position.distanceTo(target).toFixed(1)}m). Moving closer...`);
            try
            {
                await moveWithMovementPlugin(bot, target, 4.0, 5000);
            }
            catch (e)
            {
                console.warn(`[building] Failed to move closer: ${e}`);
            }
        }

        if (bot.entity.position.floored().equals(target) ||
            (Math.abs(bot.entity.position.x - target.x) < 1 &&
                Math.abs(bot.entity.position.z - target.z) < 1 &&
                Math.abs(bot.entity.position.y - target.y) < 2))
        {
            await evacuateBuildArea(bot, targetPositions);
        }

        const existing = bot.blockAt(target);
        
        if (isDoorPlacement)
        {
            if (existing && existing.name.includes("door") && !existing.name.includes("trapdoor"))
            {
                console.log(`[building] Door already exists at ${target}`);
                continue;
            }
        }
        else
        {
            if (existing && (existing.name === targetMaterial || existing.name.includes(targetMaterial))) continue;

            if (existing && existing.boundingBox !== "empty")
            {
                if (!replaceableBlocks.includes(existing.name))
                {
                    console.log(`[building] Skipping occupied block at ${target} (${existing.name})`);
                    continue;
                }
            }
        }
        
        try
        {
            const item = requireInventoryItem(bot, targetMaterial);
            await bot.equip(item, "hand");
        } 
        catch (err)
        {
            throw new Error(`Out of building materials: ${targetMaterial}`);
        }

        const success = await placeBlockAt(bot, target);
        if (!success)
        {
            failures++;
        }
    }
    
    if (failures > 0)
    {
        const msg = `[building] Finished ${params.structure} but failed to place ${failures} blocks. Structure incomplete.`;
        console.warn(msg);
        throw new Error(msg);
    }
    
    console.log(`[building] Finished ${params.structure}`);
}

async function handleSingleBlockPlacement(bot: Bot, params: BuildParams): Promise<void>
{
    console.log("[building] Detected single-block placement (1x1 platform). Switching to smart place mode.");

    let itemName = params.material;
    
    const hasPlanks = countInventoryItems(bot, params.material ?? "oak_planks") > 0;
    
    if (!hasPlanks)
    {
        const utilityBlocks = ["crafting_table", "furnace", "chest"];
        for (const util of utilityBlocks) {
            if (countInventoryItems(bot, util) > 0)
            {
                console.log(`[building] Implicit override: No planks found, but found ${util}. Using ${util} instead.`);
                itemName = util;
                break;
            }
        }
    }

    const material = resolveItemName(bot, itemName ?? "oak_planks");
    const origin = params.origin ? new Vec3(params.origin.x, params.origin.y, params.origin.z) : bot.entity.position.floored();

    console.log(`[building] Single block placement: ${material} at ${origin}`);
    
    await evacuateBuildArea(bot, [origin]);
    
    try
    {
        const item = requireInventoryItem(bot, material);
        await bot.equip(item, "hand");
    }
    catch (err)
    {
        throw new Error(`Missing item for placement: ${material}`);
    }

    const success = await placeBlockAt(bot, origin);
    if (!success)
    {
        throw new Error(`Failed to place ${material} at ${origin}`);
    }
    
    console.log(`[building] Successfully placed ${material}`);
}

export async function handleBuild(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as BuildParams;
    const timeout = 180000;
    await raceWithTimeout(executeBuild(bot, params), timeout);
}