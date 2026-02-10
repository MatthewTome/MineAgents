import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { Entity } from "prismarine-entity";
import pathfinderPkg from "mineflayer-pathfinder";

const { goals } = pathfinderPkg;

export interface Vec3Input { x: number; y: number; z: number; }
export interface MoveParams { position?: Vec3Input; entityName?: string; range?: number; timeoutMs?: number; }

export async function moveToward(bot: Bot, target: Vec3, range: number, timeout: number): Promise<void>
{
    let pathfinderError: string | null = null;

    if (bot.pathfinder) {
        try {
            const goal = new goals.GoalNear(target.x, target.y, target.z, range);
            await raceWithTimeout(bot.pathfinder.goto(goal), timeout);
            return;
        } catch (err) {
            bot.pathfinder.stop();
            pathfinderError = err instanceof Error ? err.message : String(err);
            console.warn(`[move] Pathfinder failed: ${pathfinderError}.`);
            console.log("[move] Falling back to movement plugin.");
        }
    }

    if (await moveWithMovementPlugin(bot, target, range, timeout)) {
        return;
    }

    const failureReason = pathfinderError
        ? `Pathfinder error: ${pathfinderError}`
        : "Movement plugins unavailable for navigation";

    throw new Error(failureReason);
}

export async function moveWithMovementPlugin(bot: Bot, target: Vec3, range: number, timeout: number): Promise<boolean>
{
    const movement = (bot as any).movement;
    if (!movement) return false;

    try {
        if (movement.goto) {
            await raceWithTimeout(movement.goto(target, { range, timeout }), timeout);
            return true;
        }
        if (movement.moveTo) {
            await raceWithTimeout(movement.moveTo(target, { range, timeout }), timeout);
            return true;
        }
    } catch (err) {
        console.warn(`[move] Movement plugin failed (${err instanceof Error ? err.message : String(err)}).`);
    }

    return false;
}

export function resolveTargetPosition(bot: Bot, params: MoveParams): Vec3
{
    if (params.position) return new Vec3(params.position.x, params.position.y, params.position.z);
    if (params.entityName) {
        const lower = params.entityName.toLowerCase();
        const entity = findNearestEntity(bot, (e) => {
            const name = (e.username ?? e.displayName ?? e.name ?? "").toLowerCase();
            return name.includes(lower);
        }, 96);
        if (entity) return entity.position.clone();
    }
    throw new Error("Unable to resolve target position");
}

export function findNearestEntity(bot: Bot, predicate: (entity: Entity) => boolean, maxDistance: number): Entity | null
{
    let best: Entity | null = null;
    let bestDist = Infinity;
    for (const e of Object.values(bot.entities)) {
        if (!predicate(e)) continue;
        const d = bot.entity.position.distanceTo(e.position);
        if (d < bestDist && d <= maxDistance) { best = e; bestDist = d; }
    }
    return best;
}

export function isSafeToStand(bot: Bot, pos: Vec3): boolean
{
    const block = bot.blockAt(pos);
    const below = bot.blockAt(pos.offset(0, -1, 0));
    const above = bot.blockAt(pos.offset(0, 1, 0));

    if (!block || !below || !above) return false;

    if (below.boundingBox === "empty" || below.name === "lava") return false;

    if (block.boundingBox !== "empty") return false;
    if (above.boundingBox !== "empty") return false;

    return true;
}

export function waitForNextTick(bot: Bot): Promise<void>
{
    return new Promise(r => bot.once("physicsTick", r));
}

export async function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T>
{
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Move timeout")), timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function handleMove(bot: Bot, step: { params?: Record<string, unknown> }): Promise<void>
{
    const params = (step.params ?? {}) as unknown as MoveParams;
    const targetPos = resolveTargetPosition(bot, params || {});
    await moveToward(bot, targetPos, params?.range ?? 1.5, params?.timeoutMs ?? 15000);
}
