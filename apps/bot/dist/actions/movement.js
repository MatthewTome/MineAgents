import { Vec3 } from "vec3";
import pathfinderPkg from "mineflayer-pathfinder";
const { goals } = pathfinderPkg;
export async function moveToward(bot, target, range, timeout) {
    let pathfinderError = null;
    if (bot.pathfinder) {
        try {
            const goal = new goals.GoalNear(target.x, target.y, target.z, range);
            await raceWithTimeout(bot.pathfinder.goto(goal), timeout);
            return;
        }
        catch (err) {
            pathfinderError = err instanceof Error ? err.message : String(err);
            console.warn(`[move] Pathfinder failed: ${pathfinderError}. Falling back to movement plugin.`);
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
export async function moveWithMovementPlugin(bot, target, range, timeout) {
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
export function resolveTargetPosition(bot, params) {
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
export function findNearestEntity(bot, predicate, maxDistance) {
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
export function isSafeToStand(bot, pos) {
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
    return true;
}
export function waitForNextTick(bot) {
    return new Promise(r => bot.once("physicsTick", r));
}
export async function raceWithTimeout(promise, timeoutMs) {
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
