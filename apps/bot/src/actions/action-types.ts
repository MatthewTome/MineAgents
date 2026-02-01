import type { Vec3Input, MoveParams } from "./handlers/movement.js";

export type { Vec3Input, MoveParams };

export interface MineParams { block?: string; position?: Vec3Input; maxDistance?: number; }
export interface GatherParams { item?: string; maxDistance?: number; timeoutMs?: number; }
export interface CraftParams { recipe: string; count?: number; craftingTable?: Vec3Input; material?: string; }
export interface SmeltParams { item: string; fuel?: string; furnace?: Vec3Input; count?: number; }
export interface LootParams { position?: Vec3Input; maxDistance?: number; item?: string; count?: number; }
export interface EatParams { item?: string; }
export interface SmithParams { item1: string; item2?: string; name?: string; }
export interface HuntParams { target?: string; range?: number; timeoutMs?: number; }
export interface FightParams { target?: string; aggression?: "passive" | "aggressive" | "any"; timeoutMs?: number; }
export interface FishParams { casts?: number; }
export interface PerceiveParams { check?: string; }
export interface GiveParams { target: string; item: string; count?: number; method?: "drop" | "chest"; }
export interface DropParams { item?: string; count?: number; }
export interface RequestResourceParams { item: string; count?: number; urgent?: boolean; }
export interface PickupParams { item?: string; }