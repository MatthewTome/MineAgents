import { describe, it, expect } from "vitest";
import * as subject from "../src/index.ts";

describe("index.ts", () => {
  it("exports something", () => {
    expect(subject).toBeDefined();
  });
});