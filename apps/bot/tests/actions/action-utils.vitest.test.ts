import { describe, it, expect } from "vitest";
import { expandMaterialAliases, isItemMatch, resolveItemName, resolveWoodType } from "../../src/actions/action-utils.js";
import { makeMockBot } from "../test-helpers.js";

describe("actions/action-utils.ts", () => {
  it("expands material aliases for logs and dirt", () => {
    const bot = makeMockBot({
      registryItems: {
        oak_log: { id: 1 },
        spruce_log: { id: 2 },
        oak_planks: { id: 3 }
      }
    });

    expect(expandMaterialAliases(bot as any, "log")).toContain("oak_log");
    expect(expandMaterialAliases(bot as any, "dirt")).toContain("coarse_dirt");
  });

  it("resolves wood type from inventory and matches categories", () => {
    const bot = makeMockBot({
      items: [{ name: "spruce_planks", count: 2 }]
    });

    expect(resolveWoodType(bot as any)).toBe("spruce");
    expect(isItemMatch("oak_log", "log")).toBe(true);
  });

  it("normalizes item names for crafting and smelting", () => {
    const bot = makeMockBot({
      registryItems: { iron_ingot: { id: 4, name: "iron_ingot" } }
    });

    expect(resolveItemName(bot as any, "iron ingot")).toBe("iron_ingot");
  });
});