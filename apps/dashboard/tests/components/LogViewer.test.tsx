// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LogViewer from "../../src/components/LogViewer";
import '@testing-library/jest-dom/vitest';

describe("LogViewer", () => {
  it("filters log entries by severity", () => {
    render(
      <LogViewer
        agent="agent-1"
        logs={[
          { file: "session.log", ts: 1, level: "info", message: "Info message" } as any,
          { file: "session.log", ts: 2, level: "error", message: "Error message" } as any
        ]}
      />
    );

    expect(screen.getByText("Info message")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Severity"), { target: { value: "error" } });
    expect(screen.queryByText("Info message")).not.toBeInTheDocument();
    expect(screen.getByText("Error message")).toBeInTheDocument();
  });
});