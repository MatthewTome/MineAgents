// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StatusCard from "../../src/components/StatusCard";
import '@testing-library/jest-dom/vitest';

describe("StatusCard", () => {
  it("renders agent status and inventory", () => {
    render(
      <StatusCard
        stuck={true}
        agent={{
          sessionId: "s1",
          name: "Builder",
          intent: "Build shelter",
          inventory: [{ name: "planks", count: 12 }]
        } as any}
      />
    );

    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("Stuck")).toBeInTheDocument();
    expect(screen.getByText("12 planks")).toBeInTheDocument();
  });
});