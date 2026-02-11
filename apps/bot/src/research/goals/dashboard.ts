import { GoalEvent } from "./types.js";

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