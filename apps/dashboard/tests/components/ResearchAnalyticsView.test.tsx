// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ResearchAnalyticsView from "../../src/components/ResearchAnalyticsView";
import '@testing-library/jest-dom/vitest';

vi.mock("recharts", () => {
  const Stub = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Bar: Stub,
    BarChart: Stub,
    CartesianGrid: Stub,
    Legend: Stub,
    ResponsiveContainer: Stub,
    Scatter: Stub,
    ScatterChart: Stub,
    Tooltip: Stub,
    XAxis: Stub,
    YAxis: Stub
  };
});

describe("ResearchAnalyticsView", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        trials: [],
        conditions: { 
          baseline: { 
            successRate: 0.5, 
            averageDurationSec: 10, 
            averageActions: 4, 
            averagePlanSteps: 3, 
            averageActionAttempts: 1, 
            averageLlmCalls: 2 
          } 
        },
        boxPlot: [{ condition: "baseline", min: 1, q1: 2, median: 3, q3: 4, max: 5 }],
        actionUsage: [{ condition: "baseline", actions: 4, llmCalls: 2 }],
        ragEffectiveness: { points: [] }
      })
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders analytics once metrics load", async () => {
    render(<ResearchAnalyticsView apiBase="http://localhost:4000" />);

    expect(screen.getByText("Research & Analytics")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/metrics");
    });
    expect(await screen.findByText("Success Rate Comparison")).toBeInTheDocument();
  });
});