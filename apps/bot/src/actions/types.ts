import type { Vec3Input, MoveParams } from "./handlers/moving/move.js";

export type { Vec3Input, MoveParams };

export interface CraftParams { recipe: string; count?: number; craftingTable?: Vec3Input; material?: string; }
export interface DropParams { item?: string; count?: number; }
export interface EquipParams { item: string; destination?: "hand" | "off-hand" | "head" | "torso" | "legs" | "feet"; }
export interface GatherParams { item?: string; maxDistance?: number; timeoutMs?: number; }
export interface GiveParams { target: string; item: string; count?: number; method?: "drop" | "chest"; }
export interface LootParams { position?: Vec3Input; maxDistance?: number; item?: string; count?: number; }
export interface MineParams { block?: string; position?: Vec3Input; maxDistance?: number; count?: number; }
export interface PerceiveParams { check?: string; }
export interface PickupParams { item?: string; }
export interface RequestResourceParams { item: string; count?: number; urgent?: boolean; }
export interface SmeltParams { item: string; fuel?: string; furnace?: Vec3Input; count?: number; }