import type { PerceptionSnapshot } from "../settings/types.js";

export type GoalStatus = "pending" | "pass" | "fail";

export interface GoalDefinition
{
    name: string;
    steps: string[];
    successSignal: GoalSignal;
    failureSignals?: GoalSignal[];
    timeoutMs?: number;
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
}

interface TrackedGoal
{
    id: string;
    definition: GoalDefinition;
    status: GoalStatus;
    startedAt: number;
}

export class InMemoryGoalDashboard
{
    private readonly events: GoalEvent[] = [];

    record(event: GoalEvent): void
    {
        this.events.push(event);
    }

    getEvents(): GoalEvent[]
    {
        return [...this.events];
    }

    latestFor(goalId: string): GoalEvent | undefined
    {
        return [...this.events].reverse().find(e => e.id === goalId);
    }
}

export class GoalTracker
{
    private readonly goals: Map<string, TrackedGoal> = new Map();
    private readonly dashboard: InMemoryGoalDashboard;
    private counter = 0;

    constructor(dashboard?: InMemoryGoalDashboard)
    {
        this.dashboard = dashboard ?? new InMemoryGoalDashboard();
    }

    addGoal(definition: GoalDefinition, now: number = Date.now()): string
    {
        const id = `goal-${++this.counter}`;
        const tracked: TrackedGoal =
        {
            id,
            definition,
            status: "pending",
            startedAt: now
        };

        this.goals.set(id, tracked);
        return id;
    }

    getDashboard(): InMemoryGoalDashboard
    {
        return this.dashboard;
    }

    ingestSnapshot(snapshot: PerceptionSnapshot, now: number = Date.now()): GoalEvent[]
    {
        const events: GoalEvent[] = [];

        for (const goal of this.goals.values())
        {
            if (goal.status !== "pending")
            {
                continue;
            }

            if (goal.definition.timeoutMs && now - goal.startedAt >= goal.definition.timeoutMs)
            {
                const event = this.recordEvent(goal, "fail", now, "Timed out");
                events.push(event);
                continue;
            }

            if (this.signalMatched(goal.definition.successSignal, snapshot))
            {
                const reason = goal.definition.successSignal.description ?? "Success criteria met";
                const event = this.recordEvent(goal, "pass", now, reason);
                events.push(event);
                continue;
            }

            if (goal.definition.failureSignals)
            {
                const failed = goal.definition.failureSignals.find(sig => this.signalMatched(sig, snapshot));
                if (failed)
                {
                    const reason = failed.description ?? "Failure criteria met";
                    const event = this.recordEvent(goal, "fail", now, reason);
                    events.push(event);
                }
            }
        }

        return events;
    }

    notifyEvent(channel: string, payload: unknown, now: number = Date.now()): GoalEvent[]
    {
        const events: GoalEvent[] = [];

        for (const goal of this.goals.values())
        {
            if (goal.status !== "pending")
            {
                continue;
            }

            const matched = goal.definition.successSignal.type === "event"
                && goal.definition.successSignal.channel === channel
                && (!goal.definition.successSignal.match || goal.definition.successSignal.match(payload));

            if (matched)
            {
                const reason = goal.definition.successSignal.description ?? `Signal ${channel} matched`;
                events.push(this.recordEvent(goal, "pass", now, reason));
            }
        }

        return events;
    }

    private recordEvent(goal: TrackedGoal, status: Exclude<GoalStatus, "pending">, ts: number, reason: string): GoalEvent
    {
        goal.status = status;
        const event: GoalEvent =
        {
            id: goal.id,
            name: goal.definition.name,
            status,
            ts,
            reason
        };

        this.dashboard.record(event);
        return event;
    }

    private signalMatched(signal: GoalSignal, snapshot: PerceptionSnapshot): boolean
    {
        if (signal.type === "predicate")
        {
            return signal.test(snapshot);
        }

        if (signal.type === "chat")
        {
            const messages = snapshot.chatWindow.lastMessages.join("\n");
            if (signal.includes instanceof RegExp)
            {
                return signal.includes.test(messages);
            }
            return messages.includes(signal.includes);
        }

        return false;
    }
}