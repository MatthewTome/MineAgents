// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ReplayDebugView from "../../src/components/ReplayDebugView";
import '@testing-library/jest-dom/vitest';

describe("ReplayDebugView", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ trials: [{ sessionId: "s1", name: "Trial 1" }] })
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [] })
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ trials: [{ sessionId: "s1", name: "Trial 1" }], entries: [] })
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads trial list and renders the debug view", async () => {
    render(<ReplayDebugView apiBase="http://localhost:4000" />);

    expect(screen.getByText("Replay & Debug View")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/trials");
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/logs/s1");
    });
  });
});