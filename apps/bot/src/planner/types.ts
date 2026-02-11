import type { PerceptionSnapshot } from "../settings/types.js";
import type { ActionStep } from "../actions/executor.js";
import type { SessionLogger } from "../logger/session-logger.js";
import type { DebugTracer } from "../logger/debug-trace.js";

export interface PlanRequest
{
    goal: string;
    perception?: PerceptionSnapshot;
    context?: string;
    ragEnabled?: boolean;
    teamPlan?: unknown;
    claimedSteps?: string[];
    assignedSteps?: string[];
    planningMode?: "single" | "team" | "individual";
}

export interface PlanResult
{
    intent: string;
    steps: ActionStep[];
    model: string;
    backend: "local" | "remote";
    raw: string;
    knowledgeUsed?: string[];
    teamPlan?: unknown;
    claimedStepIds?: string[];
}

export interface HuggingFacePlannerOptions
{
    model: string;
    temperature: number;
    maxTokens: number;
    cacheDir?: string;
    device?: "auto" | "cpu" | "gpu";
    token?: string;
    inferenceEndpoint?: string;
    backend?: "auto" | "local" | "remote";
    quantized?: boolean;
    remoteMode?: "inference_api" | "hf_api";
    logger?: SessionLogger;
    tracer?: DebugTracer;
    recipesDir?: string;
}