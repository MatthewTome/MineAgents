import { Vec3 } from "vec3";
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
    for (let radius = 2; radius <= cfg.maxRadius; radius++) {
        for (let dx = -radius; dx <= radius; dx++) {
            for (let dz = -radius; dz <= radius; dz++) {
                if (Math.abs(dx) !== radius && Math.abs(dz) !== radius)
                    continue;
                const candidate = base.offset(dx, 0, dz);
                const site = evaluateCandidate(bot, candidate, cfg, half);
                if (!site)
                    continue;
                const score = candidate.distanceTo(base) + (1 - site.coverage) * 10 + site.flatness * 2;
                if (score < bestScore) {
                    best = site;
                    bestScore = score;
                }
            }
        }
        if (best)
            break;
    }
    return best;
}
function evaluateCandidate(bot, center, cfg, half) {
    const surfaceYs = [];
    let checked = 0;
    let valid = 0;
    for (let dx = -half; dx <= half; dx++) {
        for (let dz = -half; dz <= half; dz++) {
            checked++;
            const column = center.offset(dx, 0, dz);
            const surface = findSurfaceY(bot, column, 2);
            if (surface == null)
                continue;
            valid++;
            surfaceYs.push(surface);
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
        coverage: valid / checked
    };
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
