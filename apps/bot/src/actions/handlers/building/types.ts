import { Vec3 } from "vec3";

export interface BuildParams {
    structure: 'platform' | 'wall' | 'walls' | 'tower' | 'roof' | 'door_frame' | 'door' | 'shelter';
    origin: { x: number, y: number, z: number };
    material?: string;
    width?: number;
    height?: number;
    length?: number;
    door?: boolean; 
}

export interface PlaceParams {
    item: string;
    position: { x: number, y: number, z: number };
}

export type ScoutedBuildSite = {
    origin: Vec3;
    size: number;
    radius: number;
    flatness: number;
    coverage: number;
    obstructions: number;
};

export type BuildSiteOptions = {
    size: number;
    maxRadius: number;
    heightTolerance: number;
    minCoverage: number;
};