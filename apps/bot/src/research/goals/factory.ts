import { GoalDefinition, GoalMetadata } from "./types.js";
import type { PerceptionSnapshot } from "../../settings/types.js";

export class GoalFactory
{
    static createFromDescription(description: string, metadata?: GoalMetadata): GoalDefinition
    {
        const lower = description.toLowerCase().trim();

        const gatherMatch = lower.match(/^(?:mine|collect|get|acquire)\s+(\d+)\s+(.+?)(?:s)?$/);
        if (gatherMatch)
        {
            const count = parseInt(gatherMatch[1], 10);
            const rawItemName = gatherMatch[2].replace(/\s+/g, "_");
            
            return {
                name: description,
                steps: [],
                successSignal: {
                    type: "predicate",
                    description: `Have ${count} ${rawItemName}`,
                    test: (snap: PerceptionSnapshot) => {
                        const total = (snap.inventory.items ?? [])
                            .filter(i => i.name.includes(rawItemName) || rawItemName.includes(i.name))
                            .reduce((acc, i) => acc + (i.count ?? 0), 0);
                        return total >= count;
                    }
                },
                failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                timeoutMs: 600000,
                metadata
            };
        }

        const craftMatch = lower.match(/^craft\s+(\d+)\s+(.+?)(?:s)?$/);
        if (craftMatch)
        {
            const count = parseInt(craftMatch[1], 10);
            const rawItemName = craftMatch[2].replace(/\s+/g, "_");

            return {
                name: description,
                steps: [],
                successSignal: {
                    type: "predicate",
                    description: `Crafted/Have ${count} ${rawItemName}`,
                    test: (snap: PerceptionSnapshot) => {
                        const total = (snap.inventory.items ?? [])
                            .filter(i => i.name.includes(rawItemName) || rawItemName.includes(i.name))
                            .reduce((acc, i) => acc + (i.count ?? 0), 0);
                        return total >= count;
                    }
                },
                failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
                timeoutMs: 600000,
                metadata
            };
        }

        return {
            name: description,
            steps: [],
            successSignal: { type: "event", channel: "planner.success" },
            failureSignals: [{ type: "event", channel: "planner.fatal_error" }],
            timeoutMs: 1200000,
            metadata
        };
    }
}