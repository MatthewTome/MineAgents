import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricsResponse } from "../types";
import BoxPlot from "./BoxPlot";

interface ResearchAnalyticsViewProps {
  apiBase: string;
}

export default function ResearchAnalyticsView({ apiBase }: ResearchAnalyticsViewProps) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadMetrics = async () => {
      try {
        const res = await fetch(`${apiBase}/metrics`);
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.message ?? "Failed to load metrics");
        }
        const payload = await res.json();
        setMetrics(payload as MetricsResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load metrics");
      }
    };
    loadMetrics();
  }, [apiBase]);

  const successRateData = useMemo(() => {
    if (!metrics) {
      return [];
    }
    return Object.entries(metrics.conditions).map(([condition, values]) => ({
      condition,
      successRate: Number((values.successRate * 100).toFixed(1))
    }));
  }, [metrics]);

  const actionUsage = metrics?.actionUsage ?? [];
  const ragPoints = metrics?.ragEffectiveness.points ?? [];

  const downloadData = async (format: "json" | "csv") => {
    if (!metrics) {
      return;
    }
    try {
      const endpoint = `${apiBase}/exports/trials.${format}`;
      const res = await fetch(endpoint);
      if (!res.ok) {
        throw new Error(`Failed to download ${format.toUpperCase()} export.`);
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      const fileName = match?.[1] ?? `mineagents_trials.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download export.");
    }
  };

  return (
    <section>
      <div className="section-header">
        <h2>Research & Analytics</h2>
        <div className="download-buttons">
          <button onClick={() => downloadData("json")}>Download JSON</button>
          <button onClick={() => downloadData("csv")}>Download CSV</button>
        </div>
      </div>
      {error && <div className="banner error">{error}</div>}
      {!metrics && !error && <div className="banner">Loading metrics...</div>}
      {metrics && (
        <div className="grid columns-2">
        <div className="card chart-card">
            <h3>Run Summary (per condition)</h3>
            <table className="metrics-table">
              <thead>
                <tr>
                  <th>Condition</th>
                  <th>Success Rate</th>
                  <th>Avg Duration (sec)</th>
                  <th>Avg Action Steps</th>
                  <th>Avg Plan Steps</th>
                  <th>Avg Attempts</th>
                  <th>Avg LLM Calls</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.conditions).map(([condition, values]) => (
                  <tr key={condition}>
                    <td>{condition}</td>
                    <td>{(values.successRate * 100).toFixed(1)}%</td>
                    <td>{values.averageDurationSec.toFixed(1)}</td>
                    <td>{values.averageActions.toFixed(1)}</td>
                    <td>{values.averagePlanSteps.toFixed(1)}</td>
                    <td>{values.averageActionAttempts.toFixed(1)}</td>
                    <td>{values.averageLlmCalls.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card chart-card">
            <h3>Success Rate Comparison</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={successRateData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="condition" />
                <YAxis unit="%" />
                <Tooltip />
                <Legend />
                <Bar dataKey="successRate" fill="#3c82f6" name="Success Rate" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h3>Time-to-Completion (Box Plot)</h3>
            <BoxPlot data={metrics.boxPlot} />
          </div>
          <div className="card chart-card">
            <h3>Action & LLM Usage</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={actionUsage}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="condition" />
                <YAxis label={{ value: "Count", angle: -90, position: "insideLeft" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="actions" fill="#10b981" name="Action Steps" />
                <Bar dataKey="attempts" fill="#22d3ee" name="Attempts" />
                <Bar dataKey="llmCalls" fill="#f59e0b" name="LLM Calls" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h3>RAG Effectiveness</h3>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="retrievals" name="Memory Retrievals" />
                <YAxis dataKey="success" name="Success" domain={[0, 1]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                <Legend />
                <Scatter name="Trials" data={ragPoints} fill="#8b5cf6" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}