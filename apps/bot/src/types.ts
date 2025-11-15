export type EntityKind =
    | "player"
    | "hostile"
    | "passive"
    | "item"
    | "projectile"
    | "other";

export interface Vec3Like
{
    x: number;
    y: number;
    z: number;
}

export interface NearbyEntity
{
    id: number;
    kind: EntityKind;
    name: string;
    position: Vec3Like;
    distance: number;
    velocity: Vec3Like;
    healthApprox?: number;
}

export interface InventorySummary
{
    totalSlots: number;
    usedSlots: number;
    hotbar:
    {
        slot: number;
        name: string;
        count: number;
    }[];
    keyCounts:
    {
        blocks: number;
        food: number;
        fuel: number;
        tools: number;
    };
}

export interface Environment
{
    dimension: "overworld" | "nether" | "end" | "unknown";
    isRaining: boolean;
    timeTicks: number;
    dayCycle: "day" | "night" | "dawn" | "dusk";
    biome?: string;
}

export interface Hazards
{
    nearLava: boolean;
    nearFire: boolean;
    nearVoid: boolean;
    nearCactus: boolean;
    dropEdge: boolean;
}

export interface LocalBlocks
{
    solidBelow: boolean;
    airAhead: boolean;
    sample5x5:
    {
        relative: Vec3Like;
        name: string | null;
    }[];
}

export interface PlayerPose
{
    position: Vec3Like;
    yaw: number;
    pitch: number;
    onGround: boolean;
    health: number;
    food: number;
    oxygen: number;
}

export interface PerceptionSnapshot
{
    version: string;
    ts: number;
    tickId: number;
    pose: PlayerPose;
    environment: Environment;
    inventory: InventorySummary;
    hazards: Hazards;
    nearby:
    {
        maxRange: number;
        entities: NearbyEntity[];
    };
    blocks: LocalBlocks;
    chatWindow:
    {
        lastMessages: string[];
    };
}