import type { ActionStep } from "../actions/action-executor.js";
import type { PlanResult } from "./planner-types.js";
import { SUPPORTED_ACTIONS } from "./supported-actions.js";

export function extractText(json: unknown): string
{
    if (Array.isArray(json) && json[0] && typeof json[0].generated_text === "string")
    {
        return json[0].generated_text as string;
    }

    if (typeof json === "object" && json && "generated_text" in json && typeof (json as any).generated_text === "string")
    {
        return (json as any).generated_text as string;
    }

    const asString = typeof json === "string" ? json : JSON.stringify(json);
    return asString;
}

export function parsePlan(text: string, model: string): Omit<PlanResult, "backend">
{
    const block = extractJsonBlock(text);

    let parsed: any;
    try
    {
        parsed = JSON.parse(block);
    }
    catch (err)
    {
        console.warn("[planner] JSON parse failed, attempting to repair...", err);
        parsed = repairAndParseJson(block, text);
    }

    const teamPlan = parsed.team_plan ?? parsed.teamPlan;
    const individualPlan = parsed.individual_plan ?? parsed.individualPlan;

    let planSource = individualPlan ?? parsed;

    if ((typeof planSource.intent !== "string" || !Array.isArray(planSource.steps)) && teamPlan)
    {
        console.warn("[planner] Response has team_plan but missing individual_plan. Generating default lead action.");
        planSource = {
            intent: "Distribute team plan",
            steps: [
                {
                    action: "chat",
                    params: { message: "I have generated the team plan. Let's proceed." }
                }
            ]
        };
    }

    const rawClaimIds = planSource.claim_ids ?? planSource.claimed_step_ids ?? planSource.claimedSteps ?? planSource.claimIds;
    const claimedStepIds = Array.isArray(rawClaimIds) ? rawClaimIds.map((id: any) => String(id)) : [];

    if (typeof planSource.intent !== "string" || !Array.isArray(planSource.steps))
    {
        throw new Error("Planner response missing intent or steps");
    }

    const steps: ActionStep[] = planSource.steps.map((step: any, idx: number) =>
    {
        if (typeof step !== "object" || !step)
        {
            throw new Error(`Invalid step at index ${idx}`);
        }

        const action = String(step.action ?? "unknown");
        if (!SUPPORTED_ACTIONS[action])
        {
            console.warn(`[planner] Warning: Model suggested unsupported action '${action}'`);
        }

        return {
            id: String(step.id ?? `step-${idx}`),
            action,
            params: step.params,
            description: step.description
        } satisfies ActionStep;
    });

    return {
        intent: planSource.intent.trim(),
        steps,
        model,
        raw: text,
        teamPlan,
        claimedStepIds
    };
}

function repairAndParseJson(block: string, rawText: string): any
{
    const strategies: Array<(s: string) => string> = [
        (s) => s
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/,\s*([}\]])/g, "$1")
            .replace(/([{,]\s*)'([a-zA-Z0-9_]+)'(\s*:)/g, '$1"$2"$3'),

        (s) => s
            .replace(/\/\/.*$/gm, "")
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/,\s*([}\]])/g, "$1")
            .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3'),

        (s) =>
        {
            let fixed = s
                .replace(/\/\/.*$/gm, "")
                .replace(/,\s*([}\]])/g, "$1")
                .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

            fixed = fixed.replace(/,\s*"[^"]*$/, "");
            fixed = fixed.replace(/,\s*$/, "");

            let braces = 0;
            let brackets = 0;
            let inStr = false;
            let esc = false;
            for (const ch of fixed)
            {
                if (esc) { esc = false; continue; }
                if (ch === "\\") { esc = true; continue; }
                if (ch === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (ch === "{") braces++;
                if (ch === "}") braces--;
                if (ch === "[") brackets++;
                if (ch === "]") brackets--;
            }
            while (brackets > 0) { fixed += "]"; brackets--; }
            while (braces > 0) { fixed += "}"; braces--; }

            return fixed;
        }
    ];

    for (const strategy of strategies)
    {
        try
        {
            const fixed = strategy(block);
            return JSON.parse(fixed);
        }
        catch { }
    }

    const reExtracted = extractBalancedJson(rawText);
    if (reExtracted)
    {
        for (const strategy of strategies)
        {
            try { return JSON.parse(strategy(reExtracted)); }
            catch { }
        }
    }

    console.error("[planner] FATAL: Could not parse JSON after all repair strategies. Raw output below:");
    console.error(rawText);
    throw new Error("Planner response was not valid JSON after exhaustive repair attempts.");
}

function stripThinkingPreamble(text: string): string
{
    let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "");

    cleaned = cleaned.trim();
    if (cleaned.startsWith("{")) return cleaned;

    const lastBrace = cleaned.lastIndexOf("{");
    if (lastBrace !== -1)
    {
        const candidate = cleaned.slice(lastBrace);
        if (/"intent"/.test(candidate) || /"team_plan"/.test(candidate) || /"steps"/.test(candidate))
        {
            return candidate;
        }
    }

    cleaned = cleaned
        .replace(/^[\s\S]*?(?=\{)/m, "");

    return cleaned.trim();
}

function extractJsonBlock(text: string): string
{
    const stripped = stripThinkingPreamble(text);

    const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(stripped);
    if (fenceMatch?.[1])
    {
        const content = fenceMatch[1].trim();
        if (content.startsWith("{")) return content;
    }

    const result = extractBalancedJson(stripped);
    if (result) return result;

    const fallback = extractBalancedJson(text);
    if (fallback) return fallback;

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace)
    {
        return text.slice(firstBrace, lastBrace + 1);
    }

    return text;
}

function extractBalancedJson(text: string): string | null
{
    let start = -1;
    let depth = 0;
    let inString = false;
    let escape = false;

    const candidates: string[] = [];

    for (let i = 0; i < text.length; i++)
    {
        const ch = text[i];

        if (escape) { escape = false; continue; }
        if (ch === "\\") { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === "{")
        {
            if (depth === 0) start = i;
            depth++;
        }
        else if (ch === "}")
        {
            depth--;
            if (depth === 0 && start !== -1)
            {
                const candidate = text.slice(start, i + 1);
                if (/"intent"/.test(candidate) || /"steps"/.test(candidate)
                    || /"team_plan"/.test(candidate) || /"individual_plan"/.test(candidate))
                {
                    candidates.push(candidate);
                }
                start = -1;
            }
            if (depth < 0) depth = 0;
        }
    }

    if (candidates.length > 0)
    {
        return candidates[candidates.length - 1];
    }

    if (start !== -1)
    {
        const lastBrace = text.lastIndexOf("}");
        if (lastBrace > start)
        {
            return text.slice(start, lastBrace + 1);
        }
    }

    return null;
}