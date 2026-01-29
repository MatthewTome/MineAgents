import { useEffect, useMemo, useState } from "react";
import type { LogEntry, TrialSummary } from "../types";
import LogViewer from "./LogViewer";

interface ReplayDebugViewProps {
  apiBase: string;
}

interface LogsResponse {
  sessionId: string;
  entries: LogEntry[];
}

export default function ReplayDebugView({ apiBase }: ReplayDebugViewProps) {
  const [trials, setTrials] = useState<TrialSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scrubIndex, setScrubIndex] = useState(0);

  useEffect(() => {
    const loadTrials = async () => {
      try {
        const res = await fetch(`${apiBase}/trials`);
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load trials");
        }
        const payload = await res.json();
        setTrials(payload.trials ?? []);
        if (payload.trials?.length > 0 && !selectedSession) {
          setSelectedSession(payload.trials[0].sessionId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trials");
      }
    };
    loadTrials();
  }, [apiBase, selectedSession]);

  useEffect(() => {
    if (!selectedSession) {
      return;
    }
    const loadLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/logs/${encodeURIComponent(selectedSession)}`);
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load logs");
        }
        const payload = (await res.json()) as LogsResponse;
        setLogs(payload.entries ?? []);
        setScrubIndex(0);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load logs");
      } finally {
        setLoading(false);
      }
    };
    loadLogs();
  }, [apiBase, selectedSession]);

  const perceptionTimeline = useMemo(() => {
    return logs
      .filter(entry => entry.file === "perception.log" && entry.data)
      .map(entry => ({ ts: entry.ts ? new Date(entry.ts).getTime() : 0, data: entry.data }))
      .filter(entry => entry.ts > 0)
      .sort((a, b) => a.ts - b.ts);
  }, [logs]);

  const currentSnapshot = perceptionTimeline[scrubIndex];

  const thoughtSnapshot = useMemo(() => {
    if (!currentSnapshot) {
      return null;
    }
    const ts = currentSnapshot.ts;
    const plannerEntries = logs
      .filter(entry => entry.event === "planner.parsed" || entry.event === "planner.result")
      .filter(entry => entry.ts && new Date(entry.ts).getTime() <= ts)
      .sort((a, b) => new Date(a.ts ?? 0).getTime() - new Date(b.ts ?? 0).getTime());
    return plannerEntries[plannerEntries.length - 1];
  }, [currentSnapshot, logs]);

  const narrationSnapshot = useMemo(() => {
    if (!currentSnapshot) {
      return null;
    }
    const ts = currentSnapshot.ts;
    const narrations = logs
      .filter(entry => entry.event === "planner.narration")
      .filter(entry => entry.ts && new Date(entry.ts).getTime() <= ts)
      .sort((a, b) => new Date(a.ts ?? 0).getTime() - new Date(b.ts ?? 0).getTime());
    return narrations[narrations.length - 1];
  }, [currentSnapshot, logs]);

  return (
    <section>
      <div className="section-header">
        <h2>Replay & Debug View</h2>
      </div>
      {error && <div className="banner error">{error}</div>}
      <div className="card">
        <div className="controls">
          <label>
            Session
            <select value={selectedSession} onChange={event => setSelectedSession(event.target.value)}>
              {trials.map(trial => (
                <option key={trial.sessionId} value={trial.sessionId}>
                  {trial.name} ({trial.sessionId})
                </option>
              ))}
            </select>
          </label>
          <label>
            Timeline
            <input
              type="range"
              min={0}
              max={Math.max(perceptionTimeline.length - 1, 0)}
              value={scrubIndex}
              onChange={event => setScrubIndex(Number(event.target.value))}
            />
          </label>
          {loading && <span>Loading logs...</span>}
        </div>
      </div>
      <div className="grid columns-2">
        <div className="card">
          <div className="section-header">
            <h2>State Snapshot</h2>
            {currentSnapshot && (
              <span className="tag">{new Date(currentSnapshot.ts).toLocaleTimeString()}</span>
            )}
          </div>
          {!currentSnapshot && <div className="banner">No perception data available.</div>}
          {currentSnapshot && (
            <div className="status-grid">
              <span>Location: {JSON.stringify(currentSnapshot.data?.pos)}</span>
              <span>Goal: {String(currentSnapshot.data?.currentGoal ?? "")}</span>
              <span>Planning: {String(currentSnapshot.data?.isPlanning ?? false)}</span>
              <span>Health: {String(currentSnapshot.data?.health ?? "")}</span>
              <span>Food: {String(currentSnapshot.data?.food ?? "")}</span>
              <span>Hazards: {JSON.stringify(currentSnapshot.data?.hazards)}</span>
              <span>Nearby: {JSON.stringify(currentSnapshot.data?.nearby)}</span>
            </div>
          )}
        </div>
        <div className="card">
          <div className="section-header">
            <h2>Thought Trace</h2>
          </div>
          {!thoughtSnapshot && <div className="banner">No planner data available.</div>}
          {thoughtSnapshot && (
            <div className="status-grid">
              <span>Intent: {String(thoughtSnapshot.data?.intent ?? "")}</span>
              <span>Steps: {JSON.stringify(thoughtSnapshot.data?.steps ?? [])}</span>
            </div>
          )}
          {narrationSnapshot && (
            <div className="intent-item">
              <strong>Narration</strong>
              <div>{String(narrationSnapshot.data?.message ?? "")}</div>
              <time>{new Date(narrationSnapshot.ts ?? 0).toLocaleTimeString()}</time>
            </div>
          )}
        </div>
      </div>
      <div className="card">
        <div className="section-header">
          <h2>Log Viewer</h2>
        </div>
        <LogViewer logs={logs} agent={selectedSession} />
      </div>
    </section>
  );
}