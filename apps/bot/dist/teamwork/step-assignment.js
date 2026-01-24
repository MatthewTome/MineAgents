export function assignStepsToAgents(steps, roster) {
    const assignments = {};
    const unassigned = [];
    const activeAgents = roster.agents.filter(a => a.status === "active");
    activeAgents.forEach(agent => {
        const key = `agent-${agent.agentId}`;
        assignments[key] = [];
    });
    for (const step of steps) {
        const targetRole = step.owner_role;
        if (!targetRole) {
            const fallback = activeAgents.find(a => a.role === "supervisor" || a.role === "generalist");
            if (fallback) {
                assignments[`agent-${fallback.agentId}`].push(step.id);
            }
            else {
                unassigned.push(step.id);
            }
            continue;
        }
        const matchingAgents = activeAgents.filter(a => a.role === targetRole);
        if (matchingAgents.length === 0) {
            const fallback = activeAgents.find(a => a.role === "generalist" || a.role === "supervisor");
            if (fallback) {
                assignments[`agent-${fallback.agentId}`].push(step.id);
            }
            else {
                unassigned.push(step.id);
            }
            continue;
        }
        const leastBusy = matchingAgents.reduce((min, agent) => {
            const minCount = assignments[`agent-${min.agentId}`].length;
            const agentCount = assignments[`agent-${agent.agentId}`].length;
            return agentCount < minCount ? agent : min;
        });
        assignments[`agent-${leastBusy.agentId}`].push(step.id);
    }
    return { assignments, unassigned };
}
