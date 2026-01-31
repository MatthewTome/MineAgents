import type { AgentStatus } from "../types";

interface StatusCardProps {
  agent: AgentStatus;
  stuck: boolean;
}

export default function StatusCard({ agent, stuck }: StatusCardProps) {
  return (
    <div className={`card ${stuck ? "stuck" : ""}`}>
      <div className="section-header">
        <h2>{agent.name}</h2>
        {stuck ? <span className="tag alert">Stuck</span> : <span className="tag">Active</span>}
      </div>
      <div className="status-grid">
        <span>Intent: {agent.intent ?? "Idle"}</span>
        <span>Current Goal: {agent.currentGoal ?? "None"}</span>
        <span>Active Tool: {agent.activeTool ?? agent.currentAction ?? "None"}</span>
        <span>Task: {agent.currentAction ?? "None"}</span>
        <span>Thought State: {agent.thoughtState ?? "Monitoring"}</span>
        <span>
          Location: {agent.location ? `${agent.location.x}, ${agent.location.y}, ${agent.location.z}` : "Unknown"}
        </span>
        <span>Health: {agent.health ?? "--"}</span>
        <span>Food: {agent.food ?? "--"}</span>
      </div>

      <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #1c2433" }}>
        <h3 style={{ fontSize: "14px", margin: "0 0 8px 0", color: "#aab5c5" }}>Inventory</h3>
        {agent.inventory && agent.inventory.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {agent.inventory.map((item, idx) => (
              <span key={idx} className="tag" style={{ fontSize: "11px", padding: "2px 8px" }}>
                {item.count} {item.name}
              </span>
            ))}
          </div>
        ) : (
          <span style={{ fontSize: "13px", color: "#5c6b85" }}>Empty</span>
        )}
      </div>
    </div>
  );
}