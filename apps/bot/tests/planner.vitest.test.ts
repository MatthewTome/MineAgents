import { describe, expect, it, vi, afterEach } from "vitest";
import { HuggingFacePlanner } from "../src/planner/planner.js";

describe("HuggingFacePlanner", () =>
{
    const originalFetch = global.fetch;

    afterEach(() =>
    {
        global.fetch = originalFetch;
    });

    it("builds a plan using the Router API and parses JSON output", async () =>
    {
        const mockFetch = vi.fn(async (url: any, init: any) =>
        {
            return {
                ok: true,
                json: async () => (
                {
                    choices: [
                    {
                        message:
                        {
                            content: "" +
                                "Here is the plan:\n" +
                                "```json\n" +
                                "{\n" +
                                "  \"intent\": \"Test intent\",\n" +
                                "  \"steps\": [\n" +
                                "    { \"id\": \"s1\", \"action\": \"chat\", \"params\": { \"message\": \"hi\" } }\n" +
                                "  ]\n" +
                                "}\n" +
                                "```"
                        }
                    }]
                })
            } as any;
        });

        global.fetch = mockFetch;

        const planner = new HuggingFacePlanner(
        {
            token: "test-token",
            model: "meta-llama/Meta-Llama-3-8B-Instruct",
            backend: "remote",
            maxTokens: 128
        });

        const result = await planner.createPlan({ goal: "wave" });

        console.log({ 
            actualIntent: result.intent, 
            expected: "Test intent", 
            actualSteps: result.steps 
        });

        expect(mockFetch).toHaveBeenCalled();
        const [url, init] = mockFetch.mock.calls[0];

        expect(String(url)).toContain("router.huggingface.co/v1/chat/completions");

        const body = JSON.parse(init.body as string);
        expect(body.model).toBe("meta-llama/Meta-Llama-3-8B-Instruct");
        expect(Array.isArray(body.messages)).toBe(true);

        expect(result.intent).toBe("Test intent");
        expect(result.steps[0]?.action).toBe("chat");
    });

    it("throws when no JSON can be found in the response", async () =>
    {
        const mockFetch = vi.fn(async (url: any, init: any) => (
        {
            ok: true,
            json: async () => (
            {
                choices: [
                {
                    message: { content: "I cannot do that. I am just a text model." }
                }]
            })
        } as any));

        global.fetch = mockFetch;

        const planner = new HuggingFacePlanner(
        { 
            token: "test-token", 
            backend: "remote" 
        });

        await expect(planner.createPlan({ goal: "wave" })).rejects.toThrow(/not valid JSON/);
    });
});