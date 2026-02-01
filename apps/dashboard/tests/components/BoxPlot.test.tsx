// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import BoxPlot from "../../src/components/BoxPlot";
import '@testing-library/jest-dom/vitest';

describe("BoxPlot", () => {
  it("renders placeholder when no data", () => {
    render(<BoxPlot data={[]} />);
    expect(screen.getByText("No timing data available.")).toBeInTheDocument();
  });

  it("renders labels for each condition", () => {
    render(
      <BoxPlot
        data={[
          { condition: "baseline", min: 1, q1: 2, median: 3, q3: 4, max: 5 }
        ]}
      />
    );
    expect(screen.getByText("baseline")).toBeInTheDocument();
    expect(screen.getByText("Median 3.0s")).toBeInTheDocument();
  });
});