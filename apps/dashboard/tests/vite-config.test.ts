// @vitest-environment node
import { describe, it, expect } from "vitest";
import config from "../vite.config";

describe("vite config", () => {
  it("exposes expected server port", () => {
    expect(config.server?.port).toBe(5173);
  });
});