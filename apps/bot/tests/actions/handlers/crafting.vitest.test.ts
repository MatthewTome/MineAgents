import { describe, it, expect, vi } from "vitest";
import { craftFromInventory } from "../../../src/actions/handlers/crafting.js";
import { makeMockBot } from "../../test-helpers.js";

describe("actions/handlers/crafting.ts", () => {
  it("skips crafting when inventory already satisfies the request", async () => {
    const bot = makeMockBot({
      items: [{ name: "oak_planks", count: 4 }]
    });
    (bot.registry.itemsByName as any).oak_planks = { id: 1, name: "oak_planks" };
    const recipesFor = vi.fn().mockReturnValue([{ id: 1, requiresTable: false }]);
    (bot as any).recipesFor = recipesFor;

    await craftFromInventory(bot as any, { recipe: "oak_planks", count: 2 });

    expect(bot.craft).not.toHaveBeenCalled();
  });

  it("falls back to material when crafting structure aliases", async () => {
    const bot = makeMockBot({
      items: [{ name: "oak_log", count: 2 }],
      registryItems: {
        oak_planks: { id: 2, name: "oak_planks" }
      }
    });
    const recipe = { id: 2, requiresTable: false };
    const recipesFor = vi.fn().mockReturnValue([recipe]);
    (bot as any).recipesFor = recipesFor;

    await craftFromInventory(bot as any, { recipe: "platform", material: "oak_planks", count: 1 });

    expect(recipesFor).toHaveBeenCalledWith(2, null, 1, false);
    expect(bot.craft).toHaveBeenCalledWith(recipe, 1, undefined);
  });
});