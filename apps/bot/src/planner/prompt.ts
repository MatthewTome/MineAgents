import type { PlanRequest } from "./planner-types.js";
import type { HuggingFacePlannerOptions } from "./planner-types.js";
import { SUPPORTED_ACTIONS } from "./supported-actions.js";

export function buildPlannerPrompt(options: HuggingFacePlannerOptions, request: PlanRequest, knowledge: string[] = []): string
{
    const perception = request.perception ? JSON.stringify(request.perception) : "";
    const context = request.context ?? "";
    const planningMode = request.planningMode ?? "single";

    const actionsList = Object.entries(SUPPORTED_ACTIONS)
        .map(([name, desc]) => `- ${name}: ${desc}`)
        .join("\n");

    const knowledgeSection = knowledge.length > 0
        ? `\nRELEVANT KNOW-HOW (Use these recipes to guide your steps):\n${knowledge.join("\n")}\n`
        : "";

    const teamPlanSection = request.teamPlan
        ? `\nTEAM PLAN (shared, do not modify):\n${JSON.stringify(request.teamPlan)}\n`
        : "";

    const claimedStepsSection = request.claimedSteps && request.claimedSteps.length > 0
        ? `\nAlready claimed step ids: ${request.claimedSteps.join(", ")}\n`
        : "";

    const assignedStepsSection = request.assignedSteps && request.assignedSteps.length > 0
        ? `\nSTEPS ASSIGNED TO YOU: ${request.assignedSteps.join(", ")}\n`
        : "";

    const planningModeRules = planningMode === "team"
        ? [
            "TEAM PLAN MODE:",
            "- You are the team lead. Output JSON with team_plan describing the full team plan.",
            "- team_plan must include intent and steps. Each step must include a unique id and owner_role (gatherer|builder|supervisor|generalist).",
            "- Also include individual_plan with a brief intent and a chat announcement summarizing the team plan.",
            "- Keep step descriptions concise and actionable."
        ].join("\n")
        : request.assignedSteps && request.assignedSteps.length > 0
            ? [
                "SUPERVISOR-ASSIGNED MODE:",
                "- The supervisor has assigned specific steps to you.",
                "- You may ONLY claim and execute the assigned step IDs.",
                "- Return JSON with intent, steps, and claim_ids (must match your assigned steps).",
                "- Do NOT claim steps assigned to other agents."
            ].join("\n")
            : request.teamPlan
                ? [
                    "TEAM EXECUTION MODE:",
                    "- Use the TEAM PLAN above to choose only steps that match your role and are not already claimed.",
                    "- Return JSON with intent, steps, and claim_ids (array of team plan step ids you will handle).",
                    "- The first step MUST be a chat action announcing your claimed steps to the team.",
                    "- Do NOT claim steps assigned to other roles unless absolutely necessary.",
                ].join("\n")
                : "";

    return [
        "You are MineAgent, a Minecraft planning assistant.",
        `YOUR RESPONSE LIMIT IS ${options.maxTokens} TOKENS. You MUST stay well within this limit.`,
        "RESPONSE FORMAT RULES (CRITICAL):",
        "- You MUST output ONLY a single valid JSON object. Nothing else.",
        "- Do NOT output reasoning steps, explanations, chain-of-thought, or any text before or after the JSON.",
        "- Do NOT wrap the JSON in markdown fences (no ```json or ```).",
        "- Do NOT start with phrases like 'Here are my reasoning steps' or 'Let me think'.",
        "- The very first character of your response MUST be '{' and the very last character MUST be '}'.",
        "- If you are a 'thinker' model, put all thinking inside <think> tags and output ONLY JSON after closing </think>.",
        "Return JSON with fields intent (short string) and steps (array of {id, action, params?, description?}).",
        "Only use these actions (others will fail):",
        actionsList,
        knowledgeSection,
        teamPlanSection,
        claimedStepsSection,
        assignedStepsSection,
        "CRITICAL RULES:",
        "1. For multi-part builds (house, base), you MUST pick a specific coordinate (e.g. x:0, y:63, z:0) and use it as the 'origin' for EVERY build step (platform, walls, roof). Do NOT omit the origin.",
        "2. If context includes a scouted build site, use its origin for build steps and move there before building.",
        "3. Be complete (include roof, door).",
        "4. Coordinates must be grounded in the provided Perception snapshot. Only use positions from Perception.pose, Perception.nearby/entities, Perception.blocks, or scouted build site. Do not invent random coordinates.",
        "5. If multiple agents are present (per Context or Perception), return JSON with team_plan and individual_plan fields. team_plan should list shared steps with role assignments, and individual_plan should include intent and steps for this agent plus any chat announcements. If only one agent is present, return intent and steps as usual.",
        "6. When a step requires multiple items or blocks, include params.count with the exact quantity (especially for mine, gather, loot, craft, smelt, drop, give).",
        planningModeRules,
        "Intent should be fewer than 140 characters.",
        `Goal: ${request.goal}`,
        context ? `Context: ${context}` : "",
        perception ? `Perception: ${perception}` : "",
        "Respond with only one JSON object."
    ].filter(Boolean).join("\n");
}