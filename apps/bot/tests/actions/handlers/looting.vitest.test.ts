import { describe, it, expect, vi } from "vitest";
import { handleLoot } from "../../../src/actions/handlers/looting.js";
import { makeMockBot, makePosition } from "../../test-helpers.js";

vi.mock("../../../src/perception/chest-memory.js", () => ({
  recordChestContents: vi.fn()
}));

vi.mock("../../../src/actions/handlers/movement.js", () => ({
  moveToward: vi.fn()
}));

import { recordChestContents } from "../../../src/perception/chest-memory.js";
import { moveToward } from "../../../src/actions/handlers/movement.js";

describe("actions/handlers/looting.ts", () => {
  it("withdraws target items and records chest contents", async () => {
    const chestPosition = makePosition(1, 64, 1);
    const bot = makeMockBot({
      registryBlocks: { chest: { id: 54 } }
    });
    (bot.findBlock as any).mockReturnValue({ position: chestPosition });
    const chest = {
      containerItems: () => [{ name: "oak_log", count: 3, type: 1 }],
      withdraw: vi.fn(),
      close: vi.fn()
    };
    (bot.openContainer as any).mockResolvedValue(chest);

    await handleLoot(bot as any, { params: { item: "oak_log", count: 2 } });

    expect(moveToward).toHaveBeenCalledWith(bot, chestPosition, 2.5, 15000);
    expect(recordChestContents).toHaveBeenCalledWith(chestPosition, [{ name: "oak_log", count: 3 }]);
    expect(chest.withdraw).toHaveBeenCalledWith(1, null, 2);
    expect(chest.close).toHaveBeenCalled();
  });
});