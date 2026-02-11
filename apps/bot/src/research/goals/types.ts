import type { PerceptionSnapshot } from "../../settings/types.js";

export type GoalStatus = "pending" | "pass" | "fail";

export interface ResearchCondition
{
    role?: string;
    ragEnabled?: boolean;
    narrationEnabled?: boolean;
    safetyEnabled?: boolean;
    agentId?: number;
    agentCount?: number;
    seed?: string;
    trialId?: string;
    notes?: string;
}

export interface GoalMetadata
{
    tags?: string[];
    condition?: ResearchCondition;
}

export interface GoalDefinition
{
    name: string;
    steps: string[];
    successSignal: GoalSignal;
    failureSignals?: GoalSignal[];
    timeoutMs?: number;
    metadata?: GoalMetadata;
}

export type GoalSignal =
    | { type: "predicate"; test: (snapshot: PerceptionSnapshot) => boolean; description?: string }
    | { type: "chat"; includes: string | RegExp; description?: string }
    | { type: "event"; channel: string; match?: (payload: unknown) => boolean; description?: string };

export interface GoalEvent
{
    id: string;
    name: string;
    status: GoalStatus;
    ts: number;
    reason: string;
    durationMs?: number;
    metadata?: GoalMetadata;
}