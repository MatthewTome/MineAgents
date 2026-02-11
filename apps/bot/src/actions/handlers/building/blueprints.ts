import { Vec3 } from "vec3";

export function generatePlatform(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

export function generateWalls(origin: Vec3, w: number, l: number, h: number, doorPos: Vec3 | null): Vec3[] {
    const blocks: Vec3[] = [];
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            for (let z = 0; z < l; z++) {
                if (x === 0 || x === w - 1 || z === 0 || z === l - 1) {
                    const absPos = origin.offset(x, y, z);
                    if (doorPos && absPos.x === doorPos.x && absPos.z === doorPos.z && y < 2) { 
                        continue; 
                    }
                    blocks.push(absPos);
                }
            }
        }
    }
    return blocks;
}

export function generateRoof(origin: Vec3, w: number, l: number): Vec3[] {
    const blocks: Vec3[] = [];
    for (let x = 0; x < w; x++) {
        for (let z = 0; z < l; z++) {
            blocks.push(origin.offset(x, 0, z));
        }
    }
    return blocks;
}

export function generateDoorFrame(origin: Vec3): Vec3[] {
    return [
        origin.offset(-1, 0, 0), origin.offset(1, 0, 0), 
        origin.offset(-1, 1, 0), origin.offset(1, 1, 0),
        origin.offset(-1, 2, 0), origin.offset(0, 2, 0), origin.offset(1, 2, 0)
    ];
}