import { describe, it, expect } from "vitest";
import * as types from "../src/types";

describe("types module", () => {
  it("exports type placeholders", () => {
    expect(types).toBeDefined();
  });
});