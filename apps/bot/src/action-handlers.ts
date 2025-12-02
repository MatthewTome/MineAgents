import type { Bot } from "mineflayer";
import type { Block } from "prismarine-block";
import type { Entity } from "prismarine-entity";
import type { Item } from "prismarine-item";
import { Vec3 } from "vec3";
import type { ActionHandler } from "./action-executor.js";

interface Vec3Input
{
    x: number;
    y: number;
    z: number;
}

interface MoveParams
{
    position?: Vec3Input;
    entityName?: string;
    range?: number;
    timeoutMs?: number;
}

interface MineParams
{
    block?: string;
    position?: Vec3Input;
    maxDistance?: number;
    attempts?: number;
}

interface GatherParams
{
    item?: string;
    maxDistance?: number;
    timeoutMs?: number;
}

interface BuildParams
{
    structure: "base" | "house" | "nether_portal" | "platform";
    origin?: Vec3Input;
    material?: string;
}

interface HuntParams
{
    target?: string;
    range?: number;
    timeoutMs?: number;
}

interface FightParams
{
    target?: string;
    aggression?: "passive" | "aggressive" | "any";
    timeoutMs?: number;
}

interface FishParams
{
    casts?: number;
}

export function createDefaultActionHandlers(): Record<string, ActionHandler>
{
    return {
        move: handleMove,
        mine: handleMine,
        gather: handleGather,
        build: handleBuild,
        hunt: handleHunt,
        fish: handleFish,
        fight: handleFight
    } satisfies Record<string, ActionHandler>;
}

async function handleMove(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as MoveParams | undefined;
    const range = params?.range ?? 1.5;
    const timeoutMs = params?.timeoutMs ?? 15000;

    if (!params?.position && !params?.entityName)
    {
        throw new Error("Move action requires a position or entityName");
    }

    const targetPos = resolveTargetPosition(bot, params);
    await moveToward(bot, targetPos, range, timeoutMs);
}

async function handleMine(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as MineParams | undefined;
    if (!params?.block && !params?.position)
    {
        throw new Error("Mine action requires a block name or position");
    }

    const maxDistance = params.maxDistance ?? 32;
    const block = findBlockTarget(bot, params, maxDistance);
    if (!block)
    {
        throw new Error("No matching block found to mine");
    }

    const targetPos = block.position.clone().offset(0.5, 0.5, 0.5);
    await moveToward(bot, targetPos, 4, 20000);
    await bot.dig(block, true);
}

async function handleGather(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as GatherParams | undefined;
    const matchName = params?.item?.toLowerCase();
    const target = findNearestEntity(bot, (entity) =>
    {
        if (entity.name !== "item")
        {
            return false;
        }

        if (!matchName)
        {
            return true;
        }

        const dropped = (entity as any).getDroppedItem?.() as Item | undefined;
        return dropped?.name?.toLowerCase() === matchName || dropped?.displayName?.toLowerCase() === matchName;
    }, params?.maxDistance ?? 48);

    if (!target)
    {
        throw new Error("No matching dropped items nearby");
    }

    await moveToward(bot, target.position, 1.5, params?.timeoutMs ?? 15000);
}

async function handleBuild(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as BuildParams | undefined;
    if (!params?.structure)
    {
        throw new Error("Build action requires a structure type");
    }

    const origin = params.origin ? new Vec3(params.origin.x, params.origin.y, params.origin.z) : bot.entity.position.floored();
    const materialName = (params.material ?? "cobblestone").toLowerCase();
    const blueprint = getBlueprint(params.structure);

    if (!blueprint.length)
    {
        throw new Error(`Unknown structure '${params.structure}'`);
    }

    const sortedBlocks = blueprint.map(pos => origin.plus(pos)).sort((a, b) => a.y - b.y);

    for (const pos of sortedBlocks)
    {
        const reference = findReferenceBlock(bot, pos);
        if (!reference)
        {
            throw new Error(`No support block to place at ${pos}`);
        }

        const face = pos.minus(reference.position);
        const item = requireInventoryItem(bot, materialName);
        await bot.equip(item, "hand");
        await moveToward(bot, reference.position.offset(0.5, 0.5, 0.5), 4, 20000);
        await bot.placeBlock(reference, face);
    }
}

async function handleHunt(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as HuntParams | undefined;
    const match = params?.target?.toLowerCase();

    const target = findNearestEntity(bot, (entity) =>
    {
        if (entity.type !== "mob")
        {
            return false;
        }

        if (!match)
        {
            return true;
        }

        const name = (entity.displayName ?? entity.name ?? "").toLowerCase();
        return name.includes(match);
    }, 64);

    if (!target)
    {
        throw new Error("No matching mob found to hunt");
    }

    await engageTarget(bot, target, params?.range ?? 2, params?.timeoutMs ?? 20000);
}

async function handleFight(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as FightParams | undefined;
    const match = params?.target?.toLowerCase();
    const aggression = params?.aggression ?? "any";

    const target = findNearestEntity(bot, (entity) =>
    {
        if (entity.type !== "mob" && entity.type !== "player")
        {
            return false;
        }

        const name = (entity.displayName ?? entity.name ?? entity.username ?? "").toLowerCase();

        if (match && !name.includes(match))
        {
            return false;
        }

        if (aggression === "aggressive")
        {
            return entity.kind === "Hostile" || entity.metadata?.some((m: any) => m?.name === "target" && m?.value);
        }

        if (aggression === "passive")
        {
            return entity.kind !== "Hostile";
        }

        return true;
    }, 64);

    if (!target)
    {
        throw new Error("No matching target found to fight");
    }

    await engageTarget(bot, target, 2.5, params?.timeoutMs ?? 20000);
}

async function handleFish(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = step.params as FishParams | undefined;
    const casts = Math.max(1, params?.casts ?? 1);
    const rod = requireInventoryItem(bot, "fishing_rod");
    await bot.equip(rod, "hand");

    for (let i = 0; i < casts; i++)
    {
        await bot.fish();
    }
}

function resolveTargetPosition(bot: Bot, params: MoveParams): Vec3
{
    if (params.position)
    {
        return new Vec3(params.position.x, params.position.y, params.position.z);
    }

    if (params.entityName)
    {
        const lower = params.entityName.toLowerCase();
        const entity = findNearestEntity(bot, (e) =>
        {
            const name = (e.username ?? e.displayName ?? e.name ?? "").toLowerCase();
            return name.includes(lower);
        }, 96);

        if (entity)
        {
            return entity.position.clone();
        }
    }

    throw new Error("Unable to resolve target position for move action");
}

function findBlockTarget(bot: Bot, params: MineParams, maxDistance: number): Block | null
{
    if (params.position)
    {
        const pos = new Vec3(params.position.x, params.position.y, params.position.z);
        return bot.blockAt(pos) ?? null;
    }

    const name = params.block?.toLowerCase();
    if (!name)
    {
        return null;
    }

    const blockId = bot.registry.blocksByName[name]?.id;
    if (!blockId)
    {
        return null;
    }

    return bot.findBlock({ matching: blockId, maxDistance }) ?? null;
}

function findReferenceBlock(bot: Bot, target: Vec3): Block | null
{
    const below = bot.blockAt(target.offset(0, -1, 0));
    if (below && below.boundingBox !== "empty")
    {
        return below;
    }

    const neighbors = [
        target.offset(1, 0, 0),
        target.offset(-1, 0, 0),
        target.offset(0, 0, 1),
        target.offset(0, 0, -1),
        target.offset(0, 1, 0)
    ];

    for (const pos of neighbors)
    {
        const block = bot.blockAt(pos);
        if (block && block.boundingBox !== "empty")
        {
            return block;
        }
    }

    return null;
}

function getBlueprint(structure: BuildParams["structure"]): Vec3[]
{
    const positions: Vec3[] = [];

    if (structure === "platform")
    {
        for (let x = -1; x <= 1; x++)
        {
            for (let z = -1; z <= 1; z++)
            {
                positions.push(new Vec3(x, 0, z));
            }
        }
    }
    else if (structure === "base")
    {
        for (let x = -1; x <= 1; x++)
        {
            for (let z = -1; z <= 1; z++)
            {
                positions.push(new Vec3(x, 0, z));
                if (Math.abs(x) === 1 || Math.abs(z) === 1)
                {
                    positions.push(new Vec3(x, 1, z));
                }
            }
        }
    }
    else if (structure === "house")
    {
        for (let x = -2; x <= 2; x++)
        {
            for (let z = -2; z <= 2; z++)
            {
                positions.push(new Vec3(x, 0, z));
                if (Math.abs(x) === 2 || Math.abs(z) === 2)
                {
                    positions.push(new Vec3(x, 1, z));
                    positions.push(new Vec3(x, 2, z));
                }
            }
        }

        for (let x = -2; x <= 2; x++)
        {
            for (let z = -2; z <= 2; z++)
            {
                positions.push(new Vec3(x, 3, z));
            }
        }
    }
    else if (structure === "nether_portal")
    {
        const frame =
        [
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

function requireInventoryItem(bot: Bot, name: string): Item
{
    const lower = name.toLowerCase();
    const item = bot.inventory.items().find(i => (i.name?.toLowerCase() ?? "") === lower);

    if (!item)
    {
        throw new Error(`Missing required item '${name}' in inventory`);
    }

    return item;
}

function findNearestEntity(bot: Bot, predicate: (entity: Entity) => boolean, maxDistance: number): Entity | null
{
    let best: Entity | null = null;
    let bestDistance = Number.MAX_SAFE_INTEGER;

    for (const entity of Object.values(bot.entities))
    {
        if (!predicate(entity))
        {
            continue;
        }

        const distance = bot.entity.position.distanceTo(entity.position);
        if (distance < bestDistance && distance <= maxDistance)
        {
            best = entity;
            bestDistance = distance;
        }
    }

    return best;
}

async function engageTarget(bot: Bot, entity: Entity, range: number, timeoutMs: number): Promise<void>
{
    const start = Date.now();
    while (bot.entity.position.distanceTo(entity.position) > range)
    {
        if (Date.now() - start > timeoutMs)
        {
            bot.clearControlStates();
            throw new Error("Failed to reach target in time");
        }

        await moveToward(bot, entity.position, range, timeoutMs - (Date.now() - start));
    }

    bot.clearControlStates();
    await bot.lookAt(entity.position, true);
    bot.attack(entity);
}

async function moveToward(bot: Bot, target: Vec3, stopDistance: number, timeoutMs: number): Promise<void>
{
    const start = Date.now();
    bot.setControlState("forward", false);

    while (bot.entity.position.distanceTo(target) > stopDistance)
    {
        if (Date.now() - start > timeoutMs)
        {
            bot.clearControlStates();
            throw new Error("Movement timed out");
        }

        await bot.lookAt(target, true);
        bot.setControlState("forward", true);

        if (target.y - bot.entity.position.y > 0.5)
        {
            bot.setControlState("jump", true);
        }
        else
        {
            bot.setControlState("jump", false);
        }

        await waitForNextTick(bot);
    }

    bot.clearControlStates();
}

function waitForNextTick(bot: Bot): Promise<void>
{
    return new Promise((resolve) =>
    {
        const listener = () =>
        {
            bot.removeListener("physicsTick", listener);
            resolve();
        };
        bot.on("physicsTick", listener);
    });
}