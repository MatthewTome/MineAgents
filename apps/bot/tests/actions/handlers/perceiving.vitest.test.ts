import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePerceive } from "../../../src/actions/handlers/perceiving/perceive.js";
import * as movement from "../../../src/actions/handlers/moving/move.js";
import * as utils from "../../../src/actions/utils.js";

vi.mock("../../../src/actions/handlers/moving/move.js", () => ({
    waitForNextTick: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../../src/actions/utils.js", () => ({
    resolveItemName: vi.fn((_bot, name) => name)
}));

describe("actions/handlers/perceiving/perceive.ts", () => {
    let mockBot: any;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();

        mockBot = {
            registry: {
                itemsByName: {
                    "oak_log": { id: 1, name: "oak_log" },
                    "cobblestone": { id: 2, name: "cobblestone" },
                    "iron_ingot": { id: 3, name: "iron_ingot" }
                }
            },
            inventory: {
                items: vi.fn().mockReturnValue([])
            }
        };

        (utils.resolveItemName as any).mockImplementation((_bot: any, name: string) => name);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("General Handling", () => {
        it("handles missing params by waiting for tick", async () => {
            await handlePerceive(mockBot, {});
            expect(movement.waitForNextTick).toHaveBeenCalledWith(mockBot);
        });

        it("handles null/undefined check param", async () => {
            await handlePerceive(mockBot, { params: undefined });
            expect(movement.waitForNextTick).toHaveBeenCalledWith(mockBot);
        });

        it("handles general observation (no specific item found) by waiting for tick", async () => {
            await handlePerceive(mockBot, { params: { check: "look around" } });
            expect(movement.waitForNextTick).toHaveBeenCalledWith(mockBot);
        });
    });

    describe("Query Parsing Strategy", () => {
        it("strategy 1: extracts count and item from '3 oak_log'", async () => {
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 3 }]);
            await handlePerceive(mockBot, { params: { check: "3 oak_log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });

        it("strategy 2: resolves exact item name 'oak_log' (defaults count to 1)", async () => {
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 1 }]);
            await handlePerceive(mockBot, { params: { check: "oak_log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });

        it("strategy 3: finds item token in sentence 'Check inventory for oak_log'", async () => {
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 1 }]);
            await handlePerceive(mockBot, { params: { check: "Check inventory for oak_log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });

        it("strategy 3 (edge case): ignores stop words/numbers in tokens", async () => {
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 1 }]);
            await handlePerceive(mockBot, { params: { check: "check 1 oak_log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });

        it("strategy 4: finds item from word pairs 'oak log'", async () => {
            (utils.resolveItemName as any).mockImplementation((_b: any, n: string) => n);
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 1 }]);
            await handlePerceive(mockBot, { params: { check: "oak log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });

        it("uses aliases via resolveItemName", async () => {
            (utils.resolveItemName as any).mockReturnValue("oak_log");
            mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 1 }]);
            await handlePerceive(mockBot, { params: { check: "log" } });
            expect(mockBot.inventory.items).toHaveBeenCalled();
        });
    });

    describe("Inventory Verification (Wait & Retry)", () => {
        it("succeeds immediately if items are present", async () => {
            mockBot.inventory.items.mockReturnValue([{ name: "cobblestone", count: 5 }]);
            await handlePerceive(mockBot, { params: { check: "5 cobblestone" } });
            expect(mockBot.inventory.items).toHaveBeenCalledTimes(1);
        });

        it("waits and retries if item is missing initially but appears later", async () => {
            mockBot.inventory.items
                .mockReturnValueOnce([])
                .mockReturnValueOnce([])
                .mockReturnValue([{ name: "cobblestone", count: 5 }]);

            const promise = handlePerceive(mockBot, { params: { check: "5 cobblestone" } });
            await vi.advanceTimersByTimeAsync(1000); 
            await expect(promise).resolves.toBeUndefined();
            expect(mockBot.inventory.items.mock.calls.length).toBeGreaterThan(1);
        });

        it("throws error if item never appears within timeout (3000ms)", async () => {
            mockBot.inventory.items.mockReturnValue([]); 

            const promise = handlePerceive(mockBot, { params: { check: "1 oak_log" } });
            const assertion = expect(promise).rejects.toThrow("Perception check failed: Found 0 oak_log, required 1.");
            
            await vi.advanceTimersByTimeAsync(4500);
            await assertion;
        });

        it("throws error if partial amount found but not enough", async () => {
             mockBot.inventory.items.mockReturnValue([{ name: "oak_log", count: 2 }]);

             const promise = handlePerceive(mockBot, { params: { check: "5 oak_log" } });
             const assertion = expect(promise).rejects.toThrow("Perception check failed: Found 2 oak_log, required 5.");
             
             await vi.advanceTimersByTimeAsync(4500);
             await assertion;
        });
        
        it("sums counts of multiple stacks of the same item", async () => {
             mockBot.inventory.items.mockReturnValue([
                 { name: "oak_log", count: 1 },
                 { name: "oak_log", count: 1 },
                 { name: "oak_log", count: 1 }
             ]);

             await handlePerceive(mockBot, { params: { check: "3 oak_log" } });
             expect(mockBot.inventory.items).toHaveBeenCalledTimes(1);
        });
    });
});