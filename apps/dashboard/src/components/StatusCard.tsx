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
    </div>
  );
}