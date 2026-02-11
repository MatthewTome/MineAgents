import type { PerceptionSnapshot } from "../../settings/types.js";
import { GoalDefinition, GoalStatus, GoalEvent, GoalSignal } from "./types.js";
import { InMemoryGoalDashboard } from "./dashboard.js";

export interface TrackedGoal
{
    id: string;
    definition: GoalDefinition;
    status: GoalStatus;
    startedAt: number;
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

    getActiveGoal(): TrackedGoal | undefined
    {
        for (const goal of this.goals.values())
        {
            if (goal.status === "pending")
            {
                return goal;
            }
        }
        return undefined;
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
            
            if (goal.definition.failureSignals) {
                const failed = goal.definition.failureSignals.find(sig => 
                    sig.type === "event" && 
                    sig.channel === channel && 
                    (!sig.match || sig.match(payload))
                );
                
                if (failed) {
                    const reason = failed.description ?? `Signal ${channel} indicated failure`;
                    events.push(this.recordEvent(goal, "fail", now, reason));
                }
            }
        }

        return events;
    }

    private recordEvent(goal: TrackedGoal, status: Exclude<GoalStatus, "pending">, ts: number, reason: string): GoalEvent
    {
        goal.status = status;
        const durationMs = ts - goal.startedAt;
        const event: GoalEvent =
        {
            id: goal.id,
            name: goal.definition.name,
            status,
            ts,
            reason,
            durationMs,
            metadata: goal.definition.metadata
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