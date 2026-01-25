import fs from "node:fs";
import type { AgentRole } from "./roles.js";

export interface InventoryItem
{
    name: string;
    count: number;
}

export interface AgentInventorySummary
{
    totalItems: number;
    items: InventoryItem[];
    updatedAt: string;
}

export interface AgentRosterEntry
{
    name: string;
    agentId: number;
    role: AgentRole;
    status: "active" | "inactive" | "crashed";
    lastHeartbeat?: string;
    inventory?: AgentInventorySummary;
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

export function updateAgentInventory(
    roster: TeamRoster,
    agentKey: string,
    items: InventoryItem[]
): TeamRoster
{
    const updatedAgents = roster.agents.map(agent =>
    {
        const key = `agent-${agent.agentId}`;
        const nameKey = `agent-${agent.name}`;
        if (key === agentKey || nameKey === agentKey)
        {
            return {
                ...agent,
                inventory: {
                    totalItems: items.reduce((sum, i) => sum + i.count, 0),
                    items,
                    updatedAt: new Date().toISOString()
                }
            };
        }
        return agent;
    });

    return {
        ...roster,
        updatedAt: new Date().toISOString(),
        agents: updatedAgents
    };
}

export function getTeamInventory(roster: TeamRoster): Map<string, number>
{
    const combined = new Map<string, number>();

    for (const agent of roster.agents)
    {
        if (agent.status !== "active" || !agent.inventory) { continue; }

        for (const item of agent.inventory.items)
        {
            const current = combined.get(item.name) ?? 0;
            combined.set(item.name, current + item.count);
        }
    }

    return combined;
}

export function teamHasItem(roster: TeamRoster, itemName: string, requiredCount: number = 1): boolean
{
    const teamInv = getTeamInventory(roster);

    const exact = teamInv.get(itemName) ?? 0;
    if (exact >= requiredCount) { return true; }

    let total = 0;
    for (const [name, count] of teamInv)
    {
        if (name.includes(itemName) || itemName.includes(name))
        {
            total += count;
        }
    }

    return total >= requiredCount;
}

export function getRawMaterialsFor(item: string): { material: string; count: number }[] | null
{
    const recipes: Record<string, { material: string; count: number }[]> = {
        // Wood products
        "planks": [{ material: "log", count: 1 }],
        "oak_planks": [{ material: "oak_log", count: 1 }],
        "spruce_planks": [{ material: "spruce_log", count: 1 }],
        "birch_planks": [{ material: "birch_log", count: 1 }],
        "stick": [{ material: "planks", count: 2 }],
        "crafting_table": [{ material: "planks", count: 4 }],

        // Tools
        "wooden_pickaxe": [{ material: "planks", count: 3 }, { material: "stick", count: 2 }],
        "stone_pickaxe": [{ material: "cobblestone", count: 3 }, { material: "stick", count: 2 }],
        "iron_pickaxe": [{ material: "iron_ingot", count: 3 }, { material: "stick", count: 2 }],

        // Building
        "furnace": [{ material: "cobblestone", count: 8 }],
        "chest": [{ material: "planks", count: 8 }],
        "door": [{ material: "planks", count: 6 }],
        "oak_door": [{ material: "oak_planks", count: 6 }],
        
        // Smelted items
        "iron_ingot": [{ material: "iron_ore", count: 1 }],
        "gold_ingot": [{ material: "gold_ore", count: 1 }],
        "glass": [{ material: "sand", count: 1 }],
        "stone": [{ material: "cobblestone", count: 1 }],
        "smooth_stone": [{ material: "stone", count: 1 }],
    };

    const normalized = item.toLowerCase();
    if (recipes[normalized]) { return recipes[normalized]; }

    for (const [key, value] of Object.entries(recipes))
    {
        if (normalized.includes(key) || key.includes(normalized))
        {
            return value;
        }
    }

    return null;
}