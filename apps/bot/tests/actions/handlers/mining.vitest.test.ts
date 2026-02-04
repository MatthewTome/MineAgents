import { describe, it, expect, vi, beforeEach } from "vitest";
import * as mining from "../../../src/actions/handlers/mining.js";
import { Vec3 } from "vec3";

vi.mock("../../../src/actions/handlers/movement.js", () => ({
    raceWithTimeout: (promise: Promise<any>) => promise
}));

describe("actions/handlers/mining.ts", () => {
    let mockBot: any;
    let mockLogBlock: any;
    let mockAirBlock: any;

    beforeEach(() => {
        mockLogBlock = {
            position: new Vec3(10, 64, 10),
            type: 2,
            name: "oak_log",
            clone: function() { return { ...this }; }
        };

        mockAirBlock = {
            position: new Vec3(5, 64, 5),
            type: 0,
            name: "air",
            clone: function() { return { ...this }; }
        };

        mockBot = {
            collectBlock: {
                collect: vi.fn().mockResolvedValue(undefined)
            },
            pathfinder: {
                stop: vi.fn()
            },
            stopDigging: vi.fn(),
            blockAt: vi.fn(),
            findBlock: vi.fn(),
            registry: {
                itemsByName: {
                    stone: { id: 1 },
                    oak_log: { id: 2 }
                },
                blocksByName: {
                    stone: { id: 1 },
                    oak_log: { id: 2 }
                }
            }
        };
    });

    it("should export necessary functions", () => {
        expect(mining.collectBlocks).toBeDefined();
        expect(mining.handleMine).toBeDefined();
    });

    describe("collectBlocks", () => {
        it("should throw if collectBlock plugin is missing", async () => {
            mockBot.collectBlock = undefined;
            await expect(mining.collectBlocks(mockBot, [mockLogBlock]))
                .rejects.toThrow("Collect block plugin unavailable");
        });

        it("should return true if mining succeeds and block is removed", async () => {
            mockBot.blockAt.mockReturnValueOnce({ type: 0 });

            const result = await mining.collectBlocks(mockBot, [mockLogBlock]);
            
            expect(mockBot.collectBlock.collect).toHaveBeenCalledWith([mockLogBlock]);
            expect(result).toBe(true);
        });

        it("should throw if mining 'succeeds' but block remains", async () => {
            mockBot.blockAt.mockReturnValueOnce({ type: 2 });

            await expect(mining.collectBlocks(mockBot, [mockLogBlock]))
                .rejects.toThrow("Mining verification failed");
        });
    });

    describe("findBlockTarget", () => {
        it("should prioritize explicit position if it matches the block type", () => {
            const params = { block: "log", position: { x: 10, y: 64, z: 10 } };
            mockBot.blockAt.mockReturnValue(mockLogBlock);

            const result = mining.findBlockTarget(mockBot, params, 32);
            
            expect(result).toBe(mockLogBlock);
            expect(mockBot.blockAt).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 64, z: 10 }));
            expect(mockBot.findBlock).not.toHaveBeenCalled();
        });

        it("should ignore explicit position if it is NOT the correct block (Hallucination check)", () => {
            const params = { block: "log", position: { x: 5, y: 64, z: 5 } };
            
            mockBot.blockAt.mockReturnValue(mockAirBlock);
            mockBot.findBlock.mockReturnValue(mockLogBlock);

            const result = mining.findBlockTarget(mockBot, params, 32);
            
            expect(result).toBe(mockLogBlock);
            expect(mockBot.blockAt).toHaveBeenCalled();
            expect(mockBot.findBlock).toHaveBeenCalled();
        });

        it("should find a block by name if no position provided", () => {
            const params = { block: "log" };
            mockBot.findBlock.mockReturnValue(mockLogBlock);

            const result = mining.findBlockTarget(mockBot, params, 32);
            expect(result).toBe(mockLogBlock);
        });

        it("should resolve 'log' to 'oak_log'", () => {
            const params = { block: "log" };
            mining.findBlockTarget(mockBot, params, 32);
            
            const findCall = mockBot.findBlock.mock.calls[0][0];
            expect(findCall.matching({ name: "oak_log" })).toBe(true);
        });
    });
});