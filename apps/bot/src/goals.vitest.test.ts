import { describe, expect, it, vi } from "vitest";
import { GoalTracker, InMemoryGoalDashboard, type GoalDefinition } from "./goals.js";
import type { PerceptionSnapshot } from "./types.js";

const baseSnapshot: PerceptionSnapshot =
{
    version: "test",
    ts: 0,
    tickId: 0,
    pose:
    {
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        pitch: 0,
        onGround: true,
        health: 20,
        food: 20,
        oxygen: 10
    },
    environment:
    {
        dimension: "overworld",
        isRaining: false,
        timeTicks: 0,
        dayCycle: "day"
    },
    inventory:
    {
        totalSlots: 36,
        usedSlots: 1,
        hotbar: [],
        keyCounts:
        {
            blocks: 0,
            food: 0,
            fuel: 0,
            tools: 0
        }
    },
    hazards:
    {
        nearLava: false,
        nearFire: false,
        nearVoid: false,
        nearCactus: false,
        dropEdge: false
    },
    nearby:
    {
        maxRange: 12,
        entities: []
    },
    blocks:
    {
        solidBelow: true,
        airAhead: true,
        sample5x5: []
    },
    chatWindow:
    {
        lastMessages: []
    }
};

describe("GoalTracker", () =>
{
    it("automatically marks a goal as passed when success predicate matches", () =>
    {
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);
        const goal: GoalDefinition =
        {
            name: "Shelter before night",
            steps: ["Gather wood", "Place walls", "Add roof"],
            successSignal:
            {
                type: "predicate",
                description: "Found shelter tag",
                test: (snap) => snap.chatWindow.lastMessages.some(m => m.includes("shelter built"))
            }
        };

        const id = tracker.addGoal(goal, 0);

        const withMessage: PerceptionSnapshot =
        {
            ...baseSnapshot,
            chatWindow: { lastMessages: ["shelter built near spawn"] }
        };

        const events = tracker.ingestSnapshot(withMessage, 10_000);

        expect(events[0]?.status).toBe("pass");
        const latest = dashboard.latestFor(id);
        expect(latest?.status).toBe("pass");
        expect(latest?.reason).toContain("shelter");
    });

    it("fires fail event when timeout elapses", () =>
    {
        vi.useFakeTimers();
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);

        tracker.addGoal(
        {
            name: "Reach surface",
            steps: ["Climb"],
            timeoutMs: 5_000,
            successSignal:
            {
                type: "predicate",
                test: () => false
            }
        }, 0);

        vi.advanceTimersByTime(5_000);
        const events = tracker.ingestSnapshot(baseSnapshot, 5_000);

        expect(events[0]?.status).toBe("fail");
        expect(events[0]?.reason).toBe("Timed out");
    });
});