import "mineflayer";

declare module "mineflayer" {
    interface Bot {
        blockAt: (pos: Vec3) => Block | null;
        findBlock: (options: any) => Block | null;
        inventory: {
            items: () => Item[];
            slots: Record<number, Item | null>;
        };
        entity: {
            position: Vec3;
            username?: string;
            displayName?: string;
            name?: string;
            velocity: {
                x: number;
                y: number;
                z: number;
            };
            lookAt: (pos: Vec3, force?: boolean) => void;
            attack: (entity: Entity) => void;
            setControlState: (state: string, value: boolean) => void;
            clearControlStates: () => void;
        };
        registry: {
            itemsByName: Record<string, { id: number, name: string }>;
        };
        recipesFor: (itemId: number, craftingTableId: number | null, craftingTableCount: number | null, skills: boolean) => any[];
        equip: (item: Item, destination: string) => Promise<void>;
        placeBlock: (referenceBlock: Block, faceVector: Vec3) => Promise<void>;
        openFurnace: (block: Block) => Promise<any>;
        craft: (recipe: any, count: number, craftingTable?: Block) => Promise<void>;
        dig: (block: Block, ignoreShape?: boolean) => Promise<void>;
        canDigBlock: (block: Block) => boolean;
        pathfinder?: any;

        collectBlock?: {
            collect: (blocks: Block[] | Block, options?: { ignoreNoPath?: boolean }) => Promise<void>;
        };
        tool?: {
            equipForBlock: (block: Block) => Promise<void>;
            equipForEntity?: (entity: Entity) => Promise<void>;
        };
        movement?: {
            goto?: (target: Vec3, options?: { range?: number; timeout?: number }) => Promise<void>;
            moveTo?: (target: Vec3, options?: { range?: number; timeout?: number }) => Promise<void>;
        };
    }
}

declare class Vec3 {
    constructor(x: number, y: number, z: number);
    x: number;
    y: number;
    z: number;
    offset(x: number, y: number, z: number): Vec3;
    floored(): Vec3;
    plus(other: Vec3): Vec3;
    minus(other: Vec3): Vec3;
    scaled(scalar: number): Vec3;
    distanceTo(other: Vec3): number;
    normalize(): Vec3;
    clone(): Vec3;
    equals(other: Vec3): boolean;
}

declare class Block {
    position: Vec3;
    name: string;
    boundingBox: string;
    material: string;
}

declare class Entity {
    type: "mob" | "player" | "item" | "other";
    position: Vec3;
    username?: string;
    displayName?: string;
    name?: string;
    velocity: { x: number; y: number; z: number };
    getDroppedItem?: () => Item;
}

declare class Item {
    name: string;
    type: number;
    count?: number;
    getDroppedItem?: () => Item;
}

declare module "mineflayer-pathfinder" {
    import { Bot } from "mineflayer";

    export function pathfinder(bot: Bot): void;

    export class Movements {
        constructor(bot: Bot, mcData: unknown);
        allowSprinting?: boolean;
    }

    export namespace goals {
        class GoalNear {
            constructor(x: number, y: number, z: number, range: number);
        }
    }

    const _default: {
        pathfinder: typeof pathfinder;
        Movements: typeof Movements;
        goals: typeof goals;
    };
    export default _default;
}