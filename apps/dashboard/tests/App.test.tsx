// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import '@testing-library/jest-dom/vitest';

const handlers: Record<string, (...args: any[]) => void> = {};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: (event: string, cb: (...args: any[]) => void) => {
      handlers[event] = cb;
    },
    disconnect: vi.fn()
  }))
}));

import App from "../src/App";

describe("App", () => {
  it("renders the shell and connection banner", async () => {
    render(<App />);
    expect(screen.getByText("MineAgents Observability Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Connecting to live telemetry...")).toBeInTheDocument();
    await waitFor(() => {
      expect(handlers.connect).toBeTypeOf("function");
    });
  });
});