import { describe, expect, it, vi } from "vitest";
import { GoalTracker, InMemoryGoalDashboard, type GoalDefinition } from "../src/goals.js";
import type { PerceptionSnapshot } from "../src/types.js";

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
    it("supports each signal type and captures reasons", () =>
    {
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);
        const predicateGoal: GoalDefinition =
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

        const chatStringGoal: GoalDefinition =
        {
            name: "Receive coords",
            steps: ["Wait"],
            successSignal: { type: "chat", includes: "x=12", description: "Coords received" }
        };

        const chatRegexGoal: GoalDefinition =
        {
            name: "Raid cleared",
            steps: ["Fight"],
            successSignal: { type: "chat", includes: /Raid (over|cleared)/i }
        };

        const eventGoal: GoalDefinition =
        {
            name: "Beacon lit",
            steps: ["Collect blocks"],
            successSignal: { type: "event", channel: "beacon:lit", description: "Beacon activated" }
        };

        const predId = tracker.addGoal(predicateGoal, 0);
        const chatId = tracker.addGoal(chatStringGoal, 0);
        const regexId = tracker.addGoal(chatRegexGoal, 0);
        const eventId = tracker.addGoal(eventGoal, 0);

        const withMessages: PerceptionSnapshot =
        {
            ...baseSnapshot,
            chatWindow: { lastMessages: ["shelter built near spawn", "Raid Cleared!", "coords: x=12 z=4"] }
        };

        const snapshotEvents = tracker.ingestSnapshot(withMessages, 10_000);
        const eventEvents = tracker.notifyEvent("beacon:lit", { from: "player" }, 11_000);

        console.log({ 
            actualIds: snapshotEvents.map(e => e.id), 
            expectedIds: [predId, chatId, regexId, eventId],
            reasons: snapshotEvents.map(e => dashboard.latestFor(e.id)?.reason) 
        });

        expect(snapshotEvents.map(e => e.id)).toContain(predId);
        expect(snapshotEvents.map(e => e.id)).toContain(chatId);
        expect(snapshotEvents.map(e => e.id)).toContain(regexId);
        expect(eventEvents.map(e => e.id)).toContain(eventId);
        expect(dashboard.latestFor(predId)?.reason).toContain("shelter");
        expect(dashboard.latestFor(chatId)?.reason).toContain("Coords received");
        expect(dashboard.latestFor(regexId)?.reason).toContain("Success");
        expect(dashboard.latestFor(eventId)?.reason).toBe("Beacon activated");
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

        console.log({ actualStatus: events[0]?.status, expected: "fail", reason: events[0]?.reason });

        expect(events[0]?.status).toBe("fail");
        expect(events[0]?.reason).toBe("Timed out");
    });

    it("handles simultaneous goals and failure signals with clear reasons", () =>
    {
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);

        const rescueGoal: GoalDefinition =
        {
            name: "Rescue villager",
            steps: ["Find villager", "Escort"],
            successSignal: { type: "chat", includes: "rescued", description: "Villager escorted" },
            failureSignals: [{ type: "chat", includes: "Villager died", description: "Villager perished" }]
        };

        const lavaGoal: GoalDefinition =
        {
            name: "Avoid lava",
            steps: ["Bridge"],
            successSignal: { type: "predicate", test: snap => !snap.hazards.nearLava, description: "Safe" },
            failureSignals: [{ type: "predicate", test: snap => snap.hazards.nearLava, description: "Hit lava" }]
        };

        const rescueId = tracker.addGoal(rescueGoal, 0);
        const lavaId = tracker.addGoal(lavaGoal, 0);

        const failSnapshot: PerceptionSnapshot =
        {
            ...baseSnapshot,
            hazards: { ...baseSnapshot.hazards, nearLava: true },
            chatWindow: { lastMessages: ["Villager died to zombies"] }
        };

        console.log({ 
            rescueStatus: dashboard.latestFor(rescueId)?.status, 
            lavaStatus: dashboard.latestFor(lavaId)?.status 
        });

        const failEvents = tracker.ingestSnapshot(failSnapshot, 1_000);
        expect(failEvents).toHaveLength(2);
        expect(dashboard.latestFor(rescueId)?.status).toBe("fail");
        expect(dashboard.latestFor(rescueId)?.reason).toBe("Villager perished");
        expect(dashboard.latestFor(lavaId)?.status).toBe("fail");
        expect(dashboard.latestFor(lavaId)?.reason).toBe("Hit lava");
    });

    it("emits integration-style pass/fail events from snapshot and event streams", () =>
    {
        vi.useFakeTimers();
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);

        const goals: GoalDefinition[] =
        [
            {
                name: "Obtain food",
                steps: ["Find food"],
                successSignal: { type: "predicate", test: snap => snap.inventory.keyCounts.food > 0, description: "Food collected" },
                timeoutMs: 5_000,
            },
            {
                name: "Trigger beacon",
                steps: ["Place blocks"],
                successSignal: { type: "event", channel: "beacon:lit" },
                failureSignals: [{ type: "chat", includes: "beacon destroyed", description: "Beacon lost" }],
                timeoutMs: 10_000,
            }
        ];

        const foodId = tracker.addGoal(goals[0], 0);
        const beaconId = tracker.addGoal(goals[1], 0);

        tracker.ingestSnapshot(baseSnapshot, 1_000);

        const withFood: PerceptionSnapshot =
        {
            ...baseSnapshot,
            inventory:
            {
                ...baseSnapshot.inventory,
                keyCounts: { ...baseSnapshot.inventory.keyCounts, food: 3 }
            }
        };

        const passEvents = tracker.ingestSnapshot(withFood, 2_000);
        expect(passEvents.find(e => e.id === foodId)?.status).toBe("pass");
        expect(dashboard.latestFor(foodId)?.reason).toBe("Food collected");

        vi.advanceTimersByTime(6_000);
        tracker.notifyEvent("beacon:lit", { powered: true }, 8_000);

        const withFailureChat: PerceptionSnapshot =
        {
            ...baseSnapshot,
            chatWindow: { lastMessages: ["beacon destroyed by creeper"] }
        };

        const mixedEvents = tracker.ingestSnapshot(withFailureChat, 9_500);
        const beaconEvent = dashboard.latestFor(beaconId);
        expect(beaconEvent?.status).toBe("pass");
        expect(beaconEvent?.reason).toContain("Signal beacon:lit matched");
        expect(mixedEvents.some(e => e.id === beaconId && e.status === "fail")).toBe(false);

        vi.advanceTimersByTime(5_000);
        const lateEvents = tracker.ingestSnapshot(baseSnapshot, 15_000);

        console.log({ 
            foodEvent: passEvents.find(e => e.id === foodId)?.status,
            beaconEvent: beaconEvent?.status,
            mixedFailures: mixedEvents.filter(e => e.status === "fail")
        });

        expect(lateEvents.some(e => e.id === beaconId && e.status === "fail")).toBe(false);
        expect(dashboard.getEvents().filter(e => e.status === "pass").map(e => e.id)).toContain(foodId);
    });

    it("automatically passes when MineAgent satisfies inventory condition (Goal Completion)", () =>
    {
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);

        const collectGoal: GoalDefinition =
        {
            name: "Collect Building Blocks",
            steps: ["Mine stone"],
            successSignal:
            {
                type: "predicate",
                test: (snap) => snap.inventory.keyCounts.blocks >= 10,
                description: "Sufficient blocks acquired"
            }
        };

        const goalId = tracker.addGoal(collectGoal);

        tracker.ingestSnapshot(baseSnapshot);

        const successSnapshot: PerceptionSnapshot =
        {
            ...baseSnapshot,
            inventory:
            {
                ...baseSnapshot.inventory,
                keyCounts: { ...baseSnapshot.inventory.keyCounts, blocks: 12 }
            }
        };

        const events = tracker.ingestSnapshot(successSnapshot);
        const latestEvent = dashboard.latestFor(goalId);

        console.log({
            test: "Auto-pass inventory check",
            goal: collectGoal.name,
            inventoryCount: successSnapshot.inventory.keyCounts.blocks,
            expectedStatus: "pass",
            actualStatus: latestEvent?.status,
            reason: latestEvent?.reason
        });

        expect(events).toHaveLength(1);
        expect(latestEvent?.status).toBe("pass");
        expect(latestEvent?.reason).toBe("Sufficient blocks acquired");
    });

    it("simulates 'Build a shelter before nightfall' (Success before failure condition)", () =>
    {
        const dashboard = new InMemoryGoalDashboard();
        const tracker = new GoalTracker(dashboard);

        const shelterGoal: GoalDefinition =
        {
            name: "Build Shelter",
            steps: ["Gather wood", "Build structure"],
            successSignal:
            {
                type: "chat",
                includes: "Shelter complete",
                description: "Structure verified"
            },
            failureSignals:
            [
                {
                    type: "predicate",
                    test: (snap) => snap.environment.dayCycle === "night",
                    description: "Failed: Night fell before completion"
                }
            ]
        };

        const goalId = tracker.addGoal(shelterGoal);

        tracker.ingestSnapshot(baseSnapshot);

        const successSnapshot: PerceptionSnapshot =
        {
            ...baseSnapshot,
            environment: { ...baseSnapshot.environment, dayCycle: "day" },
            chatWindow: { lastMessages: ["Gathering resources...", "Shelter complete"] }
        };

        const events = tracker.ingestSnapshot(successSnapshot);
        const result = dashboard.latestFor(goalId);

        console.log({
            test: "Shelter before nightfall",
            timeOfDay: successSnapshot.environment.dayCycle,
            lastMessage: successSnapshot.chatWindow.lastMessages.at(-1),
            expected: "pass",
            actual: result?.status
        });

        expect(result?.status).toBe("pass");
        expect(result?.reason).toBe("Structure verified");
        
        expect(events.find(e => e.status === "fail")).toBeUndefined();
    });
});