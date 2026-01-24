import fs from "node:fs";
import type { AgentRole } from "./roles.js";

export interface AgentRosterEntry
{
    name: string;
    agentId: number;
    role: AgentRole;
    status: "active" | "inactive" | "crashed";
    lastHeartbeat?: string;
}

export interface TeamRoster
{
    createdAt: string;
    updatedAt: string;
    agentCount: number;
    agents: AgentRosterEntry[];
}

export function createRoster(agents: { name: string; agentId: number; role: AgentRole }[]): TeamRoster
{
    return {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentCount: agents.length,
        agents: agents.map(a => ({
            ...a,
            status: "active"
        }))
    };
}

export function readRoster(filePath: string): TeamRoster | null
{
    try
    {
        if (!fs.existsSync(filePath)) { return null; }
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw) as TeamRoster;
    }
    catch
    {
        return null;
    }
}

export function writeRoster(filePath: string, roster: TeamRoster): void
{
    fs.writeFileSync(filePath, JSON.stringify(roster, null, 2));
}

export function validateRoster(roster: TeamRoster | null, expectedCount: number): boolean
{
    if (!roster) { return false; }
    if (roster.agentCount !== expectedCount) { return false; }
    const activeAgents = roster.agents.filter(a => a.status === "active");
    return activeAgents.length === expectedCount;
}
