import type { AgentStatus, NarrationEvent } from "../types";
import StatusCard from "./StatusCard";

interface LiveOperationsViewProps {
  agents: AgentStatus[];
  narrations: NarrationEvent[];
}

const nowMs = () => Date.now();

export default function LiveOperationsView({ agents, narrations }: LiveOperationsViewProps) {
  const now = nowMs();

  return (
    <>
      <section>
        <div className="section-header">
          <h2>Live Agent Operations</h2>
          <span className="tag">{agents.length} agents online</span>
        </div>
        <div className="grid columns-3">
          {agents.map(agent => {
            const lastSuccess = agent.lastSuccessAt ?? agent.lastActionAt ?? agent.lastUpdated ?? 0;
            const stuck = lastSuccess > 0 && now - lastSuccess > 30000;
            return <StatusCard key={agent.sessionId} agent={agent} stuck={stuck} />;
          })}
          {agents.length === 0 && (
            <div className="card">
              <p>No live agents detected. Start a bot session or connect telemetry.</p>
            </div>
          )}
        </div>
      </section>
      <section className="grid columns-2">
        <div className="card">
          <div className="section-header">
            <h2>Intent Narration Feed</h2>
            <span className="tag">{narrations.length} updates</span>
          </div>
          <div className="intent-feed">
            {narrations.map(item => (
              <div className="intent-item" key={`${item.sessionId}-${item.ts}`}>
                <strong>{item.name ?? item.sessionId}</strong>
                <div>{item.message}</div>
                <time>{new Date(item.ts).toLocaleTimeString()}</time>
              </div>
            ))}
            {narrations.length === 0 && (
              <div className="intent-item">No narration yet. Waiting for plans...</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="section-header">
            <h2>Stuck Detection</h2>
            <span className="tag alert">30s threshold</span>
          </div>
          <div className="status-grid">
            {agents.length === 0 && <span>No agent telemetry available.</span>}
            {agents.map(agent => {
              const lastSuccess = agent.lastSuccessAt ?? agent.lastActionAt ?? agent.lastUpdated ?? 0;
              const stuck = lastSuccess > 0 && now - lastSuccess > 30000;
              return (
                <span key={`stuck-${agent.sessionId}`}>
                  {agent.name}: {stuck ? "Stuck" : "Active"}
                </span>
              );
            })}
          </div>
        </div>
      </section>
    </>
  );
}