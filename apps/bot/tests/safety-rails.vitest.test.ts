import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { ActionStep } from "../src/actions/action-executor.js";
import { SafetyRails, type SafetyRailsConfig } from "../src/safety/safety-rails.js";

function buildConfig(overrides?: Partial<SafetyRailsConfig>): SafetyRailsConfig
{
    return {
        allowedActions: ["chat", "build", "move", "craft"],
        blockedMaterials: ["tnt", "lava"],
        customProfanityList: ["dang"],
        rateLimits: {
            global: { max: 50, windowMs: 1000 },
            perAction: {
                chat: { max: 10, windowMs: 1000 },
                move: { max: 10, windowMs: 1000 }
            }
        },
        ...overrides
    };
}

function makeLogger()
{
    return {
        logSafety: vi.fn()
    };
}

function logOutput(testName: string, actual: any, expected: any)
{
    console.log(`\n--- TEST: ${testName} ---`);
    console.log("EXPECTED:", JSON.stringify(expected, null, 2));
    console.log("ACTUAL:  ", JSON.stringify(actual, null, 2));
}

describe("SafetyRails", () =>
{
    beforeEach(() =>
    {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    });

    afterEach(() =>
    {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it("blocks actions that are not on the allowlist", () =>
    {
        const safety = new SafetyRails({ config: buildConfig({ allowedActions: ["chat"] }) });
        const step: ActionStep = { id: "step-1", action: "build", params: { material: "oak_planks" } };

        const result = safety.checkStep(step);
        
        logOutput("blocks actions not on allowlist", result.allowed, false);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("not approved");
    });

    it("filters custom configured profanity (overrides)", () =>
    {
        const logger = makeLogger();
        const safety = new SafetyRails({ config: buildConfig(), logger: logger as any });
        const step: ActionStep = { id: "step-2", action: "chat", params: { message: "dang plan" } };

        const result = safety.checkStep(step);
        const actualMessage = result.step?.params?.message;
        const expectedMessage = "**** plan";

        logOutput("filters custom profanity", actualMessage, expectedMessage);

        expect(result.allowed).toBe(true);
        expect(actualMessage).toBe(expectedMessage);
        expect(logger.logSafety).toHaveBeenCalled();
    });

    it("filters standard library profanity automatically", () =>
    {
        const logger = makeLogger();
        const safety = new SafetyRails({ config: buildConfig({ customProfanityList: [] }), logger: logger as any });
        const step: ActionStep = { id: "step-2b", action: "chat", params: { message: "what the hell" } };

        const result = safety.checkStep(step);
        const actualMessage = result.step?.params?.message;
        const expectedMessage = "what the ****";

        logOutput("filters standard profanity", actualMessage, expectedMessage);

        expect(result.allowed).toBe(true);
        expect(actualMessage).toBe(expectedMessage);
    });

    it("blocks unsafe materials like TNT in build actions", () =>
    {
        const safety = new SafetyRails({ config: buildConfig() });
        const step: ActionStep = { id: "step-3", action: "build", params: { material: "tnt" } };

        const result = safety.checkStep(step);

        logOutput("blocks unsafe materials", result.allowed, false);

        expect(result.allowed).toBe(false);
        expect(result.reason).toContain("unsafe material");
    });

    it("rate limits spammy actions", () =>
    {
        const config = buildConfig({
            rateLimits: {
                global: { max: 10, windowMs: 1000 },
                perAction: { move: { max: 1, windowMs: 1000 } }
            }
        });
        const safety = new SafetyRails({ config });
        const step: ActionStep = { id: "step-4", action: "move", params: { position: { x: 1, y: 2, z: 3 } } };

        const first = safety.checkStep(step);
        const second = safety.checkStep({ ...step, id: "step-5" });

        logOutput("rate limits (first attempt)", first.allowed, true);
        logOutput("rate limits (second attempt)", second.allowed, false);

        expect(first.allowed).toBe(true);
        expect(second.allowed).toBe(false);
        expect(second.reason).toContain("rate limit");
    });

    it("resets rate limits after the window expires", () =>
        {
            const safety = new SafetyRails({ 
                config: buildConfig({ 
                    rateLimits: { 
                        global: { max: 10, windowMs: 1000 },
                        perAction: { move: { max: 1, windowMs: 100 } } 
                    } 
                }) 
            });

            const step: ActionStep = { id: "step-6", action: "move", params: {} };

            const r1 = safety.checkStep(step).allowed;
            const r2 = safety.checkStep({ ...step, id: "step-7" }).allowed;

            vi.advanceTimersByTime(101);

            const r3 = safety.checkStep({ ...step, id: "step-8" }).allowed;

            console.log("\n--- TEST: resets rate limits ---");
            console.log(`Attempt 1 (Fresh): ${r1} (Expected: true)`);
            console.log(`Attempt 2 (Spam):  ${r2} (Expected: false)`);
            console.log(`Attempt 3 (After): ${r3} (Expected: true)`);

            expect(r1).toBe(true);
            expect(r2).toBe(false);
            expect(r3).toBe(true);
        });

        it("handles undefined or empty messages gracefully", () =>
        {
            const safety = new SafetyRails({ config: buildConfig() });
            
            const stepUndefined: ActionStep = { id: "s1", action: "chat", params: {} };
            const result1 = safety.checkStep(stepUndefined);
            
            const stepSpace: ActionStep = { id: "s2", action: "chat", params: { message: "   " } };
            const result2 = safety.checkStep(stepSpace);
            
            logOutput("handles undefined message", result1.step?.params?.message, "[filtered]");
            logOutput("handles empty message", result2.step?.params?.message, "[filtered]");

            expect(result1.allowed).toBe(true);
            expect(result1.step?.params?.message).toBe("[filtered]");
            expect(result2.allowed).toBe(true);
            expect(result2.step?.params?.message).toBe("[filtered]");
        });

        it("detects unsafe materials hidden in different param fields", () =>
        {
            const safety = new SafetyRails({ config: buildConfig() });
            
            const stepRecipe: ActionStep = { 
                id: "s3", 
                action: "craft", 
                params: { recipe: "tnt_block" } 
            };
            const r1 = safety.checkStep(stepRecipe);

            const stepTarget: ActionStep = { 
                id: "s4", 
                action: "move", 
                params: { target: "lava_pool" } 
            };
            const r2 = safety.checkStep(stepTarget);

            logOutput("hidden unsafe material (recipe)", r1.allowed, false);
            logOutput("hidden unsafe material (target)", r2.allowed, false);

            expect(r1.allowed).toBe(false);
            expect(r2.allowed).toBe(false);
        });

        it("is case-insensitive for unsafe materials", () =>
        {
            const safety = new SafetyRails({ config: buildConfig() });
            const step: ActionStep = { 
                id: "s5", 
                action: "build", 
                params: { material: "TNT" } 
            };

            const result = safety.checkStep(step);
            
            logOutput("case-insensitive unsafe material", result.allowed, false);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("unsafe material");
        });

        it("handles standard profanity bypass attempts", () =>
        {
            const safety = new SafetyRails({ config: buildConfig() });
            
            const stepCaps: ActionStep = { id: "s6", action: "chat", params: { message: "HELL no" } };
            const res1 = safety.checkStep(stepCaps);
            
            const stepMixed: ActionStep = { id: "s7", action: "chat", params: { message: "What the Hell" } };
            const res2 = safety.checkStep(stepMixed);

            logOutput("bypass CAPS", res1.step?.params?.message, "**** no");
            logOutput("bypass Mixed", res2.step?.params?.message, "What the ****");

            expect(res1.step?.params?.message).toBe("**** no");
            expect(res2.step?.params?.message).toBe("What the ****");
        });

        it("does not consume rate limit tokens if the action was blocked by safety checks", () =>
        {
            const safety = new SafetyRails({ 
                config: buildConfig({
                    rateLimits: { 
                        global: { max: 50, windowMs: 1000 },
                        perAction: { build: { max: 1, windowMs: 1000 } } 
                    }
                })
            });

            const badStep: ActionStep = { id: "b1", action: "build", params: { material: "tnt" } };
            const goodStep: ActionStep = { id: "g1", action: "build", params: { material: "dirt" } };

            const blockedRes = safety.checkStep(badStep);
            
            const allowedRes = safety.checkStep(goodStep);

            logOutput("blocked action allowed?", blockedRes.allowed, false);
            logOutput("subsequent valid action allowed?", allowedRes.allowed, true);

            expect(blockedRes.allowed).toBe(false);
            expect(allowedRes.allowed).toBe(true);
        });
    });