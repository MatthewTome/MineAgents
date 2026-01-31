export interface AgentStatus {
  sessionId: string;
  name: string;
  intent?: string;
  currentGoal?: string;
  currentAction?: string;
  activeTool?: string;
  thoughtState?: string;
  location?: { x: number; y: number; z: number };
  health?: number;
  food?: number;
  inventory?: { name: string; count: number }[];
  lastActionAt?: number;
  lastSuccessAt?: number;
  lastUpdated?: number;
}

export interface NarrationEvent {
  sessionId: string;
  message: string;
  ts: number;
  name?: string;
}

export interface TrialSummary {
  sessionId: string;
  name: string;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  success?: boolean;
  condition: "baseline" | "mineagents";
  ragEnabled?: boolean;
  multiAgent?: boolean;
  role?: string;
  mentorMode?: string;
  llmCalls?: number;
  actionCount?: number;
  memoryRetrievals?: number;
  teachingInteractions?: number;
}

export interface MetricsResponse {
  trials: TrialSummary[];
  conditions: Record<string, {
    successRate: number;
    averageDurationSec: number;
    averageActions: number;
    averageLlmCalls: number;
  }>;
  boxPlot: Array<{ condition: string; min: number; q1: number; median: number; q3: number; max: number }>;
  actionUsage: Array<{ condition: string; actions: number; llmCalls: number }>;
  ragEffectiveness: {
    points: Array<{ retrievals: number; success: number; condition: string }>;
  };
}

export interface LogEntry {
  file: string;
  ts?: string;
  level?: string;
  event?: string;
  message?: string;
  data?: Record<string, unknown>;
}