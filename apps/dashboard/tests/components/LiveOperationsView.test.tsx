// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LiveOperationsView from "../../src/components/LiveOperationsView";
import '@testing-library/jest-dom/vitest';

describe("LiveOperationsView", () => {
  it("shows active agents and narration feed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const now = Date.now();
    render(
      <LiveOperationsView
        agents={[
          { sessionId: "a", name: "Agent A", lastUpdated: now - 1000 } as any
        ]}
        narrations={[
          { sessionId: "a", message: "Building shelter", ts: now - 2000 } as any
        ]}
      />
    );

    expect(screen.getByText("1 agents online")).toBeInTheDocument();
    expect(screen.getByText("Agent A")).toBeInTheDocument();
    expect(screen.getByText("Building shelter")).toBeInTheDocument();
    vi.useRealTimers();
  });
});