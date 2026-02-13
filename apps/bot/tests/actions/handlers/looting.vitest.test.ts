import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleLoot } from "../../../src/actions/handlers/looting/loot.js";
import { makeMockBot, makePosition } from "../../test-helpers.js";
import { recordChestContents } from "../../../src/perception/chest-memory.js";
import { moveWithMovementPlugin } from "../../../src/actions/handlers/moving/move.js";
import { withResourceLock } from "../../../src/actions/handlers/teamwork/teamwork.js";

vi.mock("../../../src/perception/chest-memory.js", () => ({
  recordChestContents: vi.fn()
}));

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
  moveWithMovementPlugin: vi.fn()
}));

vi.mock("../../../src/actions/handlers/teamwork/teamwork.js", () => ({
  buildLockKey: vi.fn((type, pos) => `${type}-${pos}`),
  withResourceLock: vi.fn(async (manager, key, callback) => callback())
}));

describe("actions/handlers/looting/loot.ts", () => {
  let bot: any;
  let chest: any;
  const defaultChestPosition = makePosition(10, 64, 10);

  beforeEach(() => {
    vi.clearAllMocks();

    bot = makeMockBot({
      registryBlocks: { chest: { id: 54 }, barrel: { id: 300 } }
    });

    bot.registry.blocksByName = {
      chest: { id: 54 },
      trapped_chest: { id: 146 },
      barrel: { id: 300 }
    };

    bot.findBlock = vi.fn().mockReturnValue({
      position: defaultChestPosition,
      name: 'chest',
      type: 54,
      id: 54
    });

    bot.blockAt = vi.fn((pos: any) => ({
      position: pos,
      name: 'chest',
      type: 54,
      id: 54
    }));

    chest = {
      items: vi.fn().mockReturnValue([]),
      inventoryStart: 27,
      withdraw: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
      type: 'chest'
    };
    bot.openContainer = vi.fn().mockResolvedValue(chest);
  });

  it("withdraws target items and records chest contents", async () => {
    chest.items.mockReturnValue([
      { name: "oak_log", count: 3, type: 1, slot: 0 }
    ]);

    await handleLoot(bot, { params: { item: "oak_log", count: 2 } });

    expect(moveWithMovementPlugin).toHaveBeenCalledWith(bot, defaultChestPosition, 2.5, 15000);

    expect(recordChestContents).toHaveBeenCalledWith(defaultChestPosition, [{ name: "oak_log", count: 3 }]);

    expect(chest.withdraw).toHaveBeenCalledWith(1, null, 2);
    expect(chest.close).toHaveBeenCalled();
  });

  it("withdraws all available if count is 0 (or undefined)", async () => {
    chest.items.mockReturnValue([
      { name: "iron_ingot", count: 32, type: 2, slot: 0 }
    ]);

    await handleLoot(bot, { params: { item: "iron_ingot" } });
    expect(chest.withdraw).toHaveBeenCalledWith(2, null, 32);

    vi.clearAllMocks();
    bot.findBlock.mockReturnValue({ position: defaultChestPosition, id: 54 });
    bot.openContainer.mockResolvedValue(chest);
    chest.items.mockReturnValue([
      { name: "iron_ingot", count: 32, type: 2, slot: 0 }
    ]);

    await handleLoot(bot, { params: { item: "iron_ingot", count: 0 } });
    expect(chest.withdraw).toHaveBeenCalledWith(2, null, 32);
  });

  it("withdraws from multiple stacks if needed", async () => {
    chest.items.mockReturnValue([
      { name: "cobblestone", count: 64, type: 3, slot: 0 },
      { name: "cobblestone", count: 10, type: 3, slot: 1 }
    ]);

    await handleLoot(bot, { params: { item: "cobblestone", count: 70 } });

    expect(chest.withdraw).toHaveBeenCalledTimes(2);
    expect(chest.withdraw).toHaveBeenNthCalledWith(1, 3, null, 64);
    expect(chest.withdraw).toHaveBeenNthCalledWith(2, 3, null, 6);
  });

  it("handles partial availability", async () => {
    chest.items.mockReturnValue([
      { name: "diamond", count: 3, type: 4, slot: 0 }
    ]);

    await handleLoot(bot, { params: { item: "diamond", count: 10 } });

    expect(chest.withdraw).toHaveBeenCalledWith(4, null, 3);
  });

  it("matches items by partial name (fuzzy match)", async () => {
    chest.items.mockReturnValue([
      { name: "oak_log", count: 10, type: 1, slot: 0 },
      { name: "birch_log", count: 10, type: 2, slot: 1 }
    ]);

    await handleLoot(bot, { params: { item: "log", count: 20 } });

    expect(chest.withdraw).toHaveBeenCalledTimes(2);
  });

  it("does nothing if item not found in chest", async () => {
    chest.items.mockReturnValue([
      { name: "dirt", count: 64, type: 5, slot: 0 }
    ]);

    await handleLoot(bot, { params: { item: "diamond", count: 1 } });

    expect(chest.withdraw).not.toHaveBeenCalled();
    expect(chest.close).toHaveBeenCalled();
  });

  it("records contents even if no item requested", async () => {
    chest.items.mockReturnValue([
      { name: "gold_ingot", count: 5, type: 6, slot: 0 }
    ]);

    await handleLoot(bot, { params: {} });

    expect(recordChestContents).toHaveBeenCalledWith(defaultChestPosition, [{ name: "gold_ingot", count: 5 }]);
    expect(chest.withdraw).not.toHaveBeenCalled();
    expect(chest.close).toHaveBeenCalled();
  });

  it("uses provided position instead of finding block", async () => {
    const specificPos = makePosition(100, 64, 100);
    bot.blockAt.mockReturnValue({
      position: specificPos,
      name: 'chest',
      type: 54,
      id: 54
    });

    await handleLoot(bot, { params: { position: specificPos, item: "stone" } });

    expect(bot.findBlock).not.toHaveBeenCalled();
    expect(bot.blockAt).toHaveBeenCalled();
    expect(moveWithMovementPlugin).toHaveBeenCalledWith(bot, specificPos, 2.5, 15000);
  });

  it("throws error if no container found", async () => {
    bot.findBlock.mockReturnValue(null);

    await expect(handleLoot(bot, { params: { item: "anything" } }))
      .rejects.toThrow("No chest/container found nearby.");
  });

  it("handles withdraw errors gracefully", async () => {
    chest.items.mockReturnValue([
      { name: "sand", count: 10, type: 7, slot: 0 }
    ]);
    chest.withdraw.mockRejectedValue(new Error("Inventory full"));

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await handleLoot(bot, { params: { item: "sand", count: 10 } });

    expect(consoleSpy).toHaveBeenCalled();
    expect(chest.close).toHaveBeenCalled();
  });

  it("uses resource lock", async () => {
    await handleLoot(bot, { params: { item: "test" } }, {} as any);
    expect(withResourceLock).toHaveBeenCalled();
  });
});