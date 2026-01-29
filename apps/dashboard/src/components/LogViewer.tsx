import { useMemo, useState } from "react";
import type { LogEntry } from "../types";

interface LogViewerProps {
  logs: LogEntry[];
  agent: string;
}

const severityOptions = ["all", "info", "warn", "error"] as const;

export default function LogViewer({ logs, agent }: LogViewerProps) {
  const [severity, setSeverity] = useState<(typeof severityOptions)[number]>("all");
  const [activityType, setActivityType] = useState("all");

  const eventOptions = useMemo(() => {
    const set = new Set<string>();
    logs.forEach(entry => {
      if (entry.event) {
        set.add(entry.event);
      }
    });
    return ["all", ...Array.from(set).sort()];
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter(entry => {
      if (severity !== "all" && entry.level !== severity) {
        return false;
      }
      if (activityType !== "all" && entry.event !== activityType) {
        return false;
      }
      return true;
    });
  }, [logs, severity, activityType]);

  return (
    <>
      <div className="controls">
        <label>
          Agent
          <input type="text" value={agent} disabled />
        </label>
        <label>
          Severity
          <select value={severity} onChange={event => setSeverity(event.target.value as typeof severity)}>
            {severityOptions.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          Activity
          <select value={activityType} onChange={event => setActivityType(event.target.value)}>
            {eventOptions.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="log-list">
        {filtered.map((entry, index) => (
          <div className="log-entry" key={`${entry.file}-${entry.ts}-${index}`}>
            <strong>{entry.event ?? entry.file}</strong>
            <div>{entry.message ?? ""}</div>
            <div>{entry.ts ? new Date(entry.ts).toLocaleTimeString() : ""}</div>
            {entry.data && <div>{JSON.stringify(entry.data)}</div>}
          </div>
        ))}
        {filtered.length === 0 && <div className="banner">No log entries match the filters.</div>}
      </div>
    </>
  );
}