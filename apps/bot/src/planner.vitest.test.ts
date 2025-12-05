import { describe, expect, it, vi } from "vitest";
import { HuggingFacePlanner } from "./planner.js";

describe("HuggingFacePlanner", () =>
{
    it("builds a plan using the Qwen model and parses JSON output", async () =>
    {
        const mockFetch = vi.fn(async () =>
        {
            return {
                ok: true,
                json: async () =>
                [{
                    generated_text: "" +
                        "Planning..." +
                        "```json {\"intent\":\"Test intent\",\"steps\":[{\"id\":\"s1\",\"action\":\"chat\",\"params\":{\"message\":\"hi\"}}]} ```"
                }]
            } as any;
        });

        const planner = new HuggingFacePlanner("token",
        {
            model: "Qwen/Qwen3-VL-2B-Instruct",
            fetcher: mockFetch as any,
            maxTokens: 128
        });

        const result = await planner.createPlan({ goal: "wave" });

        expect(mockFetch).toHaveBeenCalled();
        const url = mockFetch.mock.calls[0][0];
        expect(String(url)).toContain("Qwen3-VL-2B-Instruct");
        expect(result.intent).toBe("Test intent");
        expect(result.steps[0]?.action).toBe("chat");
    });

    it("throws when no JSON can be found in the response", async () =>
    {
        const mockFetch = vi.fn(async () => ({ ok: true, json: async () => [{ generated_text: "no-json-here" }] } as any));
        const planner = new HuggingFacePlanner("token", { fetcher: mockFetch as any });

        await expect(planner.createPlan({ goal: "wave" })).rejects.toThrow(/did not contain JSON/);
    });
});