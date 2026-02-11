import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import { moveToward } from "../moving/move.js";

const MOVE_REQUEST_WAIT_MS = 3000;

export async function evacuateBuildArea(bot: Bot, targets: Vec3[]): Promise<void> {
    const myPos = bot.entity.position;
    
    const isObstructing = targets.some(t => {
        const dx = Math.abs(myPos.x - (t.x + 0.5));
        const dz = Math.abs(myPos.z - (t.z + 0.5));
        const dy = myPos.y - t.y;
        
        const horizontalOverlap = dx < 1.3 && dz < 1.3;
        const verticalOverlap = dy > -2 && dy < 1.5;

        return horizontalOverlap && verticalOverlap;
    });

    if (!isObstructing) return;

    console.log("[building] Bot is obstructing the build blueprint. Relocating...");

    let bestSpot: Vec3 | null = null;
    let minDist = Infinity;
    
    for(let x=-7; x<=7; x++) {
        for(let z=-7; z<=7; z++) {
            const offset = new Vec3(x, 0, z);
            const candidate = myPos.floored().plus(offset);
            
            if (targets.some(t => t.equals(candidate))) continue;

            const ground = bot.blockAt(candidate.offset(0, -1, 0));
            const feet = bot.blockAt(candidate);
            const head = bot.blockAt(candidate.offset(0, 1, 0));

            if (ground && ground.boundingBox !== 'empty' && 
                feet && feet.boundingBox === 'empty' && 
                head && head.boundingBox === 'empty') {
                
                const d = candidate.distanceTo(myPos);
                if (d > 1.5 && d < minDist) {
                    minDist = d;
                    bestSpot = candidate;
                }
            }
        }
    }

    if (bestSpot) {
        const moveTarget = bestSpot.offset(0.5, 0, 0.5);
        try {
            await moveToward(bot, moveTarget, 0.5, 5000);
        } catch (e) {
            console.warn("[building] Evacuation pathfinder failed. Trying emergency shove.");
            if (bot.entity.position.distanceTo(moveTarget) < 5) {
                await bot.lookAt(moveTarget);
                bot.setControlState('forward', true);
                bot.setControlState('sprint', true);
                if ((bot.entity as any).isCollidedHorizontally) bot.setControlState('jump', true);
                await new Promise(r => setTimeout(r, 1000));
                bot.clearControlStates();
            }
        }
    } else {
        console.warn("[building] Could not find safe evacuation spot! Jumping as last resort...");
        bot.setControlState('jump', true);
        await new Promise(r => setTimeout(r, 500));
        bot.setControlState('jump', false);
    }
}

export async function requestEntitiesClearArea(
    bot: Bot,
    targets: Vec3[],
    origin: Vec3,
    width: number,
    length: number
): Promise<void> {
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