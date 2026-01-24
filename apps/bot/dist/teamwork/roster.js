import fs from "node:fs";
export function createRoster(agents) {
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
export function readRoster(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return null;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
export function writeRoster(filePath, roster) {
    fs.writeFileSync(filePath, JSON.stringify(roster, null, 2));
}
export function validateRoster(roster, expectedCount) {
    if (!roster) {
        return false;
    }
    if (roster.agentCount !== expectedCount) {
        return false;
    }
    const activeAgents = roster.agents.filter(a => a.status === "active");
    return activeAgents.length === expectedCount;
}
