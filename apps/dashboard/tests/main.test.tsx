// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import '@testing-library/jest-dom/vitest';

const render = vi.fn();

vi.mock("react-dom/client", () => ({
  default: { createRoot: vi.fn(() => ({ render })) },
  createRoot: vi.fn(() => ({ render }))
}));

describe("main entry", () => {
  it("mounts the app root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("../src/main");
    expect(render).toHaveBeenCalled();
  });
});