import type { AgentStatus, NarrationEvent } from "../types";
import StatusCard from "./StatusCard";

interface LiveOperationsViewProps {
  agents: AgentStatus[];
  narrations: NarrationEvent[];
}

const nowMs = () => Date.now();
const ACTIVE_THRESHOLD_MS = 60000;

export default function LiveOperationsView({ agents, narrations }: LiveOperationsViewProps) {
  const now = nowMs();

  const activeAgents = agents.filter(agent => {
      const lastUpdate = agent.lastUpdated ?? 0;
      return (now - lastUpdate) < ACTIVE_THRESHOLD_MS;
  });

  const activeNarrations = narrations.filter(n => (now - n.ts) < ACTIVE_THRESHOLD_MS * 5); 

  return (
    <>
      <section>
        <div className="section-header">
          <h2>Live Agent Operations</h2>
          <span className="tag">{activeAgents.length} agents online</span>
        </div>
        <div className="grid columns-3">
          {activeAgents.map(agent => {
            const lastSuccess = agent.lastSuccessAt ?? agent.lastActionAt ?? agent.lastUpdated ?? 0;
            const stuck = lastSuccess > 0 && now - lastSuccess > 30000;
            return <StatusCard key={agent.sessionId} agent={agent} stuck={stuck} />;
          })}
          {activeAgents.length === 0 && (
            <div className="card">
              <p>No live agents detected. Launch the bot to see telemetry.</p>
            </div>
          )}
        </div>
      </section>
      <section className="grid columns-2">
        <div className="card">
          <div className="section-header">
            <h2>Intent Narration Feed</h2>
            <span className="tag">Live Feed</span>
          </div>
          <div className="intent-feed">
            {activeNarrations.map(item => (
              <div className="intent-item" key={`${item.sessionId}-${item.ts}`}>
                <strong>{item.name ?? item.sessionId}</strong>
                <div>{item.message}</div>
                <time>{new Date(item.ts).toLocaleTimeString()}</time>
              </div>
            ))}
            {activeNarrations.length === 0 && (
              <div className="intent-item">No active narration.</div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="section-header">
            <h2>Stuck Detection</h2>
            <span className="tag alert">30s threshold</span>
          </div>
          <div className="status-grid">
            {activeAgents.length === 0 && <span>No live agents.</span>}
            {activeAgents.map(agent => {
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