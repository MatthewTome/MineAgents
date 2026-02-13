import { describe, it, expect, vi } from "vitest";
import { handleDrop, clearInventory, handleGive } from "../../../src/actions/handlers/inventory-management/inventory-management.js";
import { findNearestEntity, moveWithMovementPlugin } from "../../../src/actions/handlers/moving/move.js";
import { makeMockBot } from "../../test-helpers.js";

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
  waitForNextTick: vi.fn().mockResolvedValue(undefined),
  moveToward: vi.fn(),
  findNearestEntity: vi.fn(),
  moveWithMovementPlugin: vi.fn().mockResolvedValue(undefined)
}));

describe("actions/handlers/inventory-management.ts", () => {
  it("drops matching items when requested", async () => {
    const bot = makeMockBot({
      items: [
        { name: "dirt", count: 3, type: 1, metadata: 0 },
        { name: "cobblestone", count: 2, type: 2, metadata: 0 }
      ]
    });
    (bot.toss as any).mockResolvedValue(undefined);

    await handleDrop(bot as any, { params: { item: "dirt", count: 2 } });

    expect(bot.toss).toHaveBeenCalledWith(1, 0, 2);
  });

  it("clears inventory by tossing stacks", async () => {
    const bot = makeMockBot({
      items: [
        { name: "stick", count: 1, type: 3 },
        { name: "coal", count: 2, type: 4 }
      ]
    });
    (bot.tossStack as any).mockResolvedValue(undefined);

    await clearInventory(bot as any);

    expect(bot.tossStack).toHaveBeenCalledTimes(2);
  });

  it("gives items to nearby players via tossing", async () => {
    const bot = makeMockBot({
      items: [{ name: "coal", count: 3, type: 9 }]
    });
    (findNearestEntity as any).mockReturnValue({
      type: "player",
      username: "Friend",
      position: { offset: () => ({}) }
    });
    (bot.toss as any).mockResolvedValue(undefined);

    await handleGive(bot as any, { params: { target: "friend", item: "coal", count: 2, method: "drop" } });

    expect(bot.toss).toHaveBeenCalledWith(9, undefined, 2);
    expect(bot.chat).toHaveBeenCalledWith("[team] Tossed 2 coal to friend");
    expect(moveWithMovementPlugin).toHaveBeenCalled();
  });
});