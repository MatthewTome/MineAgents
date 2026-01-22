import fs from "node:fs";

export type LeaderRecord =
{
    goal: string;
    name: string;
    role: string;
    agentId: number | null;
    key: string;
    electedAt: string;
    expiresAt: string;
};

export type ResourceLockRecord =
{
    owner: string;
    ownerSince: string;
    expiresAt: string;
};

export type CoordinationState =
{
    leader: LeaderRecord | null;
    locks: Record<string, ResourceLockRecord>;
};

export type LeaderElectionResult =
{
    leader: LeaderRecord;
    isLeader: boolean;
    elected: boolean;
};

const DEFAULT_LEADER_TTL_MS = 60000;
const DEFAULT_LOCK_TTL_MS = 20000;

export function resolveLeaderForGoal(options:
{
    filePath: string;
    lockPath: string;
    goal: string;
    candidate:
    {
        name: string;
        role: string;
        agentId: number | null;
    };
    ttlMs?: number;
}): LeaderElectionResult | null
{
    if (!tryAcquireCoordinationLock(options.lockPath)) { return null; }

    try
    {
        const ttlMs = options.ttlMs ?? DEFAULT_LEADER_TTL_MS;
        const state = readCoordinationState(options.filePath);
        const now = Date.now();
        const candidateKey = buildAgentKey(options.candidate.name, options.candidate.agentId);
        const leader = state.leader;
        const leaderExpiry = leader ? Date.parse(leader.expiresAt) : 0;
        const leaderStillValid = leader && leader.goal === options.goal && leaderExpiry > now;

        if (leaderStillValid)
        {
            const isLeader = leader.key === candidateKey;
            return { leader, isLeader, elected: false };
        }

        const nextLeader: LeaderRecord =
        {
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
    finally
    {
        releaseCoordinationLock(options.lockPath);
    }
}

export class ResourceLockManager
{
    private filePath: string;
    private lockPath: string;
    private owner: string;
    private ttlMs: number;

    constructor(options: { filePath: string; lockPath: string; owner: string; ttlMs?: number })
    {
        this.filePath = options.filePath;
        this.lockPath = options.lockPath;
        this.owner = options.owner;
        this.ttlMs = options.ttlMs ?? DEFAULT_LOCK_TTL_MS;
    }

    async acquire(resourceKey: string, options?: { ttlMs?: number; waitMs?: number; pollMs?: number }): Promise<boolean>
    {
        const waitMs = options?.waitMs ?? 5000;
        const pollMs = options?.pollMs ?? 200;
        const ttlMs = options?.ttlMs ?? this.ttlMs;
        const start = Date.now();

        while (Date.now() - start < waitMs)
        {
            if (this.tryAcquireOnce(resourceKey, ttlMs)) { return true; }
            await delay(pollMs);
        }
        return false;
    }

    release(resourceKey: string): void
    {
        if (!tryAcquireCoordinationLock(this.lockPath)) { return; }

        try
        {
            const state = readCoordinationState(this.filePath);
            const lock = state.locks[resourceKey];
            if (lock && lock.owner === this.owner)
            {
                delete state.locks[resourceKey];
                writeCoordinationState(this.filePath, state);
            }
        }
        finally
        {
            releaseCoordinationLock(this.lockPath);
        }
    }

    private tryAcquireOnce(resourceKey: string, ttlMs: number): boolean
    {
        if (!tryAcquireCoordinationLock(this.lockPath)) { return false; }

        try
        {
            const now = Date.now();
            const state = readCoordinationState(this.filePath);
            const lock = state.locks[resourceKey];
            const isExpired = lock ? Date.parse(lock.expiresAt) <= now : true;

            if (!lock || isExpired || lock.owner === this.owner)
            {
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
        finally
        {
            releaseCoordinationLock(this.lockPath);
        }
    }
}

function readCoordinationState(filePath: string): CoordinationState
{
    try
    {
        if (!fs.existsSync(filePath))
        {
            return { leader: null, locks: {} };
        }

        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as CoordinationState;
        return pruneExpiredLocks(parsed);
    }
    catch
    {
        return { leader: null, locks: {} };
    }
}

function writeCoordinationState(filePath: string, state: CoordinationState): void
{
    const normalized = pruneExpiredLocks(state);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2));
}

function pruneExpiredLocks(state: CoordinationState): CoordinationState
{
    const now = Date.now();
    const locks = state.locks ?? {};
    const cleaned: Record<string, ResourceLockRecord> = {};

    for (const [key, value] of Object.entries(locks))
    {
        if (Date.parse(value.expiresAt) > now)
        {
            cleaned[key] = value;
        }
    }

    const leader = state.leader && Date.parse(state.leader.expiresAt) > now ? state.leader : null;

    return { leader, locks: cleaned };
}

function tryAcquireCoordinationLock(lockPath: string): boolean
{
    try
    {
        const fd = fs.openSync(lockPath, "wx");
        fs.closeSync(fd);
        return true;
    }
    catch { return false; }
}

function releaseCoordinationLock(lockPath: string): void
{
    try { fs.unlinkSync(lockPath); }
    catch { return; }
}

function buildAgentKey(name: string, agentId: number | null): string
{
    return agentId !== null ? `agent-${agentId}` : `agent-${name}`;
}

function delay(ms: number): Promise<void>
{
    return new Promise(resolve => setTimeout(resolve, ms));
}