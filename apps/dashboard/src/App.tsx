import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import LiveOperationsView from "./components/LiveOperationsView";
import ReplayDebugView from "./components/ReplayDebugView";
import ResearchAnalyticsView from "./components/ResearchAnalyticsView";
import type { AgentStatus, NarrationEvent } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? API_BASE;

const tabs = [
  { id: "live", label: "Live Operations" },
  { id: "replay", label: "Replay & Debug" },
  { id: "research", label: "Research & Analytics" }
] as const;

type TabId = (typeof tabs)[number]["id"];

type ConnectionState = {
  status: "connecting" | "connected" | "disconnected" | "error";
  message: string;
};

const initialConnection = {
  status: "connecting",
  message: "Connecting to live telemetry..."
} as const;

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("live");
  const [agentMap, setAgentMap] = useState<Map<string, AgentStatus>>(new Map());
  const [narrations, setNarrations] = useState<NarrationEvent[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(initialConnection);
  const agents = useMemo(() => Array.from(agentMap.values()), [agentMap]);

  useEffect(() => {
    const socket: Socket = io(SOCKET_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 2000
    });

    socket.on("connect", () => {
      setConnectionState({ status: "connected", message: "Live feed connected" });
    });

    socket.on("disconnect", () => {
      setConnectionState({ status: "disconnected", message: "Reconnecting to live feed..." });
    });

    socket.on("snapshot", (payload: { agents: AgentStatus[]; narrations: NarrationEvent[] }) => {
      const map = new Map<string, AgentStatus>();
      payload.agents.forEach(agent => map.set(agent.sessionId, agent));
      setAgentMap(map);
      setNarrations(payload.narrations ?? []);
    });

    socket.on("agent.status", (status: AgentStatus) => {
      setAgentMap(prev => {
        const next = new Map(prev);
        next.set(status.sessionId, status);
        return next;
      });
    });

    socket.on("narration", (event: NarrationEvent) => {
      setNarrations(prev => {
        const next = [event, ...prev];
        return next.slice(0, 120);
      });
    });

    socket.on("session.error", (error: { message: string }) => {
      setConnectionState({ status: "error", message: error.message });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>MineAgents Observability Dashboard</h1>
        <div className="nav-tabs">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>
      <main>
        {connectionState.status !== "connected" && (
          <div className={`banner ${connectionState.status === "error" ? "error" : ""}`}>
            {connectionState.message}
          </div>
        )}
        {activeTab === "live" && (
          <LiveOperationsView agents={agents} narrations={narrations} />
        )}
        {activeTab === "replay" && (
          <ReplayDebugView apiBase={API_BASE} />
        )}
        {activeTab === "research" && (
          <ResearchAnalyticsView apiBase={API_BASE} />
        )}
      </main>
    </div>
  );
}