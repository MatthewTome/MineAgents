import { describe, it, expect } from "vitest";
import { isItemMatch, resolveItemName, resolveWoodType } from "../../src/actions/utils.js";
import { makeMockBot } from "../test-helpers.js";

describe("actions/action-utils.ts", () => {
  it("normalizes item names for crafting and smelting", () => {
    const bot = makeMockBot({
      registryItems: { iron_ingot: { id: 4, name: "iron_ingot" } }
    });

    expect(resolveItemName(bot as any, "iron ingot")).toBe("iron_ingot");
  });
});