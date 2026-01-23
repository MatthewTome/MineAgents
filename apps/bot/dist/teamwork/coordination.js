import fs from "node:fs";
const DEFAULT_LEADER_TTL_MS = 60000;
const DEFAULT_LOCK_TTL_MS = 20000;
export function resolveLeaderForGoal(options) {
    if (!tryAcquireCoordinationLock(options.lockPath)) {
        return null;
    }
    try {
        const ttlMs = options.ttlMs ?? DEFAULT_LEADER_TTL_MS;
        const state = readCoordinationState(options.filePath);
        const now = Date.now();
        const candidateKey = buildAgentKey(options.candidate.name, options.candidate.agentId);
        const leader = state.leader;
        const leaderExpiry = leader ? Date.parse(leader.expiresAt) : 0;
        const leaderStillValid = leader && leader.goal === options.goal && leaderExpiry > now;
        if (leaderStillValid) {
            const isLeader = leader.key === candidateKey;
            return { leader, isLeader, elected: false };
        }
        const nextLeader = {
            goal: options.goal,
            name: options.candidate.name,
            role: options.candidate.role,
            agentId: options.candidate.agentId,
            key: candidateKey,
            electedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + ttlMs).toISOString()
        };
        state.leader = nextLeader;
        writeCoordinationState(options.filePath, state);
        return { leader: nextLeader, isLeader: true, elected: true };
    }
    finally {
        releaseCoordinationLock(options.lockPath);
    }
}
export class ResourceLockManager {
    filePath;
    lockPath;
    owner;
    ttlMs;
    constructor(options) {
        this.filePath = options.filePath;
        this.lockPath = options.lockPath;
        this.owner = options.owner;
        this.ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    }
    async acquire(resourceKey, options) {
        const waitMs = options?.waitMs ?? 5000;
        const pollMs = options?.pollMs ?? 200;
        const ttlMs = options?.ttlMs ?? this.ttlMs;
        const start = Date.now();
        while (Date.now() - start < waitMs) {
            if (this.tryAcquireOnce(resourceKey, ttlMs)) {
                return true;
            }
            await delay(pollMs);
        }
        return false;
    }
    release(resourceKey) {
        if (!tryAcquireCoordinationLock(this.lockPath)) {
            return;
        }
        try {
            const state = readCoordinationState(this.filePath);
            const lock = state.locks[resourceKey];
            if (lock && lock.owner === this.owner) {
                delete state.locks[resourceKey];
                writeCoordinationState(this.filePath, state);
            }
        }
        finally {
            releaseCoordinationLock(this.lockPath);
        }
    }
    tryAcquireOnce(resourceKey, ttlMs) {
        if (!tryAcquireCoordinationLock(this.lockPath)) {
            return false;
        }
        try {
            const now = Date.now();
            const state = readCoordinationState(this.filePath);
            const lock = state.locks[resourceKey];
            const isExpired = lock ? Date.parse(lock.expiresAt) <= now : true;
            if (!lock || isExpired || lock.owner === this.owner) {
                state.locks[resourceKey] =
                    {
                        owner: this.owner,
                        ownerSince: new Date(now).toISOString(),
                        expiresAt: new Date(now + ttlMs).toISOString()
                    };
                writeCoordinationState(this.filePath, state);
                return true;
            }
            return false;
        }
        finally {
            releaseCoordinationLock(this.lockPath);
        }
    }
}
function readCoordinationState(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return { leader: null, locks: {} };
        }
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw);
        return pruneExpiredLocks(parsed);
    }
    catch {
        return { leader: null, locks: {} };
    }
}
function writeCoordinationState(filePath, state) {
    const normalized = pruneExpiredLocks(state);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
}
function pruneExpiredLocks(state) {
    const now = Date.now();
    const locks = state.locks ?? {};
    const cleaned = {};
    for (const [key, value] of Object.entries(locks)) {
        if (Date.parse(value.expiresAt) > now) {
            cleaned[key] = value;
        }
    }
    const leader = state.leader && Date.parse(state.leader.expiresAt) > now ? state.leader : null;
    return { leader, locks: cleaned };
}
function tryAcquireCoordinationLock(lockPath) {
    try {
        const fd = fs.openSync(lockPath, "wx");
        fs.closeSync(fd);
        return true;
    }
    catch {
        return false;
    }
}
function releaseCoordinationLock(lockPath) {
    try {
        fs.unlinkSync(lockPath);
    }
    catch {
        return;
    }
}
function buildAgentKey(name, agentId) {
    return agentId !== null ? `agent-${agentId}` : `agent-${name}`;
}
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
