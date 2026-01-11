import type { Vec3Like } from "../settings/types.js";

export type ChestStatus = "unknown" | "known" | "invalid";

export interface ChestItemSummary
{
    name: string;
    count: number;
}

export interface ChestMemoryEntry
{
    position: Vec3Like;
    status: ChestStatus;
    items?: ChestItemSummary[];
    lastUpdated?: number;
}

const chestMemory = new Map<string, ChestMemoryEntry>();

export function chestKey(position: Vec3Like): string
{
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}

export function rememberChest(position: Vec3Like): ChestMemoryEntry
{
    const key = chestKey(position);
    const existing = chestMemory.get(key);
    if (existing)
    {
        return existing;
    }

    const entry: ChestMemoryEntry =
    {
        position: { ...position },
        status: "unknown"
    };

    chestMemory.set(key, entry);
    return entry;
}

export function recordChestContents(position: Vec3Like, items: ChestItemSummary[]): void
{
    const key = chestKey(position);
    chestMemory.set(key,
    {
        position: { ...position },
        status: "known",
        items: [...items],
        lastUpdated: Date.now()
    });
}

export function markChestInvalid(position: Vec3Like): void
{
    const key = chestKey(position);
    chestMemory.set(key,
    {
        position: { ...position },
        status: "invalid",
        lastUpdated: Date.now()
    });
}

export function listChestMemory(): ChestMemoryEntry[]
{
    return [...chestMemory.values()];
}