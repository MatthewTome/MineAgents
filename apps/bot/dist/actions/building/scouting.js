import { Vec3 } from "vec3";
const TILE_ENTITY_BLOCKS = [
    "chest", "trapped_chest", "ender_chest", "barrel",
    "furnace", "blast_furnace", "smoker",
    "crafting_table", "smithing_table", "fletching_table", "cartography_table", "loom",
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
const DEFAULT_BUILD_SITE = {
    size: 7,
    maxRadius: 16,
    heightTolerance: 1,
    minCoverage: 0.9
};
export function goalNeedsBuildSite(goal) {
    const lower = goal.toLowerCase();
    return ["build", "shelter", "house", "hut", "base", "home"].some(keyword => lower.includes(keyword));
}
export function suggestedBuildSize(goal) {
    const lower = goal.toLowerCase();
    if (lower.includes("large"))
        return 9;
    if (lower.includes("small") || lower.includes("tiny"))
        return 5;
    return 7;
}
export function scoutBuildSite(bot, goal, options) {
    const cfg = {
        ...DEFAULT_BUILD_SITE,
        ...options,
        size: options?.size ?? suggestedBuildSize(goal)
    };
    const base = bot.entity.position.floored();
    const half = Math.floor(cfg.size / 2);
    let best = null;
    let bestScore = Infinity;
    const candidates = [];
    for (let radius = 2; radius <= cfg.maxRadius; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius)
                    continue;
                const candidate = base.offset(dx, 0, dz);
                const site = evaluateCandidate(bot, candidate, cfg, half);
                if (!site)
                    continue;
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
function evaluateCandidate(bot, center, cfg, half) {
    const surfaceYs = [];
    let checked = 0;
    let valid = 0;
    let obstructions = 0;
    for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
            checked++;
            const column = center.offset(dx, 0, dz);
            const surface = findSurfaceY(bot, column, 2);
            if (surface == null)
                continue;
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
        if (!entity || !entity.position)
            continue;
        if (entity === bot.entity)
            continue;
        const ex = entity.position.x;
        const ez = entity.position.z;
        if (ex >= center.x - half && ex <= center.x + half &&
            ez >= center.z - half && ez <= center.z + half) {
            if (entity.type === "player") {
                obstructions += 10;
            }
            else if (entity.type === "mob") {
                obstructions += 2;
            }
            else {
                obstructions += 1;
            }
        }
    }
    if (valid / checked < cfg.minCoverage)
        return null;
    const minY = Math.min(...surfaceYs);
    const maxY = Math.max(...surfaceYs);
    const flatness = maxY - minY;
    if (flatness > cfg.heightTolerance)
        return null;
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
function isTileEntityBlock(blockName) {
    const lower = blockName.toLowerCase();
    return TILE_ENTITY_BLOCKS.some(te => lower.includes(te));
}
function findSurfaceY(bot, column, searchHeight) {
    const baseY = column.y;
    for (let dy = searchHeight; dy >= -searchHeight; dy--) {
        const y = baseY + dy;
        const ground = bot.blockAt(new Vec3(column.x, y, column.z));
        const above = bot.blockAt(new Vec3(column.x, y + 1, column.z));
        const above2 = bot.blockAt(new Vec3(column.x, y + 2, column.z));
        if (!isSolidGround(ground))
            continue;
        if (!isAir(above) || !isAir(above2))
            continue;
        return y;
    }
    return null;
}
function isSolidGround(block) {
    if (!block)
        return false;
    if (block.boundingBox === "empty")
        return false;
    const name = block.name;
    if (name.includes("water") || name.includes("lava"))
        return false;
    return true;
}
function isAir(block) {
    if (!block)
        return true;
    return block.boundingBox === "empty" || block.name === "air";
}
