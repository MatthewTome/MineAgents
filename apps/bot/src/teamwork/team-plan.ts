import fs from "node:fs";
import type { AgentRole } from "./roles.js";

export type TeamPlanStep = {
    id: string;
    description?: string;
    owner_role?: string;
    action?: string;
};

export type TeamPlanDocument = {
    intent?: string;
    steps?: TeamPlanStep[];
};

export type TeamPlanFile = {
    goal: string;
    status: "drafting" | "ready";
    createdAt: string;
    updatedAt: string;
    leader: {
        name: string;
        role: AgentRole;
        agentId: number | null;
    };
    teamPlan: TeamPlanDocument | null;
    planning: {
        mode: "agent-id" | "name-lock";
        agentCount?: number;
        currentAgentId?: number;
        completedAgentIds?: number[];
        owner?: string | null;
        ownerSince?: string | null;
        completedOwners?: string[];
    };
    claims: Record<string, { stepIds: string[]; updatedAt: string }>;
    sharedOrigin?: { x: number; y: number; z: number };
};

const OWNER_STALE_MS = 60000;

export function readTeamPlanFile(filePath: string): TeamPlanFile | null
{
    try
    {
        if (!fs.existsSync(filePath)) { return null; }
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw) as TeamPlanFile;
    }
    catch
    {
        return null;
    }
}

export function writeTeamPlanFile(filePath: string, data: TeamPlanFile): void
{
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function tryAcquireTeamPlanLock(lockPath: string): boolean
{
    try
    {
        const fd = fs.openSync(lockPath, "wx");
        fs.closeSync(fd);
        return true;
    }
    catch
    {
        return false;
    }
}

export function releaseTeamPlanLock(lockPath: string): void
{
    try
    {
        fs.unlinkSync(lockPath);
    }
    catch
    {
        return;
    }
}

export function initTeamPlanFile(options:
{
    goal: string;
    leader: { name: string; role: AgentRole; agentId: number | null };
    agentCount?: number | null;
    origin?: { x: number; y: number; z: number };
}): TeamPlanFile
{
    const now = new Date().toISOString();
    const planning = options.agentCount && options.agentCount > 1 && options.leader.agentId !== null
        ? {
            mode: "agent-id" as const,
            agentCount: options.agentCount,
            currentAgentId: 1,
            completedAgentIds: []
        }
        : {
            mode: "name-lock" as const,
            owner: null,
            ownerSince: null,
            completedOwners: []
        };

    return {
        goal: options.goal,
        status: "drafting",
        createdAt: now,
        updatedAt: now,
        leader: options.leader,
        teamPlan: null,
        planning,
        claims: {},
        sharedOrigin: options.origin
    };
}

export function isTeamPlanReady(plan: TeamPlanFile | null, goal: string): plan is TeamPlanFile
{
    return Boolean(plan && plan.goal === goal && plan.status === "ready" && plan.teamPlan);
}

export function claimPlanningTurn(plan: TeamPlanFile, agentKey: string, agentId: number | null): { plan: TeamPlanFile; allowed: boolean }
{
    const updated = { ...plan, planning: { ...plan.planning } } as TeamPlanFile;
    if (updated.planning.mode === "agent-id")
    {
        if (agentId === null || updated.planning.currentAgentId === undefined) { return { plan: updated, allowed: false }; }
        const completed = updated.planning.completedAgentIds ?? [];
        if (completed.includes(agentId)) { return { plan: updated, allowed: false }; }
        return { plan: updated, allowed: updated.planning.currentAgentId === agentId };
    }

    const completed = updated.planning.completedOwners ?? [];
    if (completed.includes(agentKey)) { return { plan: updated, allowed: false }; }

    const owner = updated.planning.owner;
    const ownerSince = updated.planning.ownerSince ? Date.parse(updated.planning.ownerSince) : null;
    const ownerIsStale = ownerSince ? Date.now() - ownerSince > OWNER_STALE_MS : false;

    if (!owner || ownerIsStale || owner === agentKey)
    {
        updated.planning.owner = agentKey;
        updated.planning.ownerSince = new Date().toISOString();
        return { plan: updated, allowed: true };
    }

    return { plan: updated, allowed: false };
}

export function advancePlanningTurn(plan: TeamPlanFile, agentKey: string, agentId: number | null): TeamPlanFile
{
    const updated = { ...plan, planning: { ...plan.planning } } as TeamPlanFile;
    if (updated.planning.mode === "agent-id")
    {
        if (agentId !== null && updated.planning.currentAgentId === agentId)
        {
            const completed = updated.planning.completedAgentIds ?? [];
            updated.planning.completedAgentIds = Array.from(new Set([...completed, agentId]));
            if (updated.planning.agentCount && updated.planning.currentAgentId < updated.planning.agentCount)
            {
                updated.planning.currentAgentId += 1;
            }
        }
        return updated;
    }

    const completed = updated.planning.completedOwners ?? [];
    updated.planning.completedOwners = Array.from(new Set([...completed, agentKey]));
    updated.planning.owner = null;
    updated.planning.ownerSince = null;
    return updated;
}

export function recordTeamPlanClaim(plan: TeamPlanFile, agentKey: string, stepIds: string[]): TeamPlanFile
{
    if (stepIds.length === 0) { return plan; }
    const updated = { ...plan, claims: { ...plan.claims } };
    updated.claims[agentKey] = {
        stepIds: Array.from(new Set(stepIds)),
        updatedAt: new Date().toISOString()
    };
    updated.updatedAt = new Date().toISOString();
    return updated;
}

export function listClaimedSteps(plan: TeamPlanFile): string[]
{
    return Object.values(plan.claims).flatMap(entry => entry.stepIds);
}

export function summarizeTeamPlan(plan: TeamPlanFile, maxSteps: number = 4): string
{
    const steps = plan.teamPlan?.steps ?? [];
    if (steps.length === 0)
    {
        return `Team plan ready for "${plan.goal}".`;
    }

    const summary = steps.slice(0, maxSteps).map(step =>
    {
        const role = step.owner_role ? ` (${step.owner_role})` : "";
        const desc = step.description ?? step.action ?? "step";
        return `${step.id}: ${desc}${role}`;
    }).join("; ");

    const more = steps.length > maxSteps ? ` (+${steps.length - maxSteps} more)` : "";
    return `Team plan ready: ${summary}${more}`;
}