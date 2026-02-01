import { describe, it, expect } from "vitest";
import { Vec3 } from "vec3";
import { generateDoorFrame, generatePlatform, generateRoof, generateWalls } from "../../../src/actions/handlers/building.js";

describe("actions/handlers/building.ts", () => {
  it("generates a platform footprint", () => {
    const origin = new Vec3(0, 64, 0);
    const blocks = generatePlatform(origin, 2, 3);
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toEqual(origin);
    expect(blocks[5]).toEqual(origin.offset(1, 0, 2));
  });

  it("carves a door opening in wall layouts", () => {
    const origin = new Vec3(0, 64, 0);
    const doorPos = origin.offset(1, 0, 0);
    const blocks = generateWalls(origin, 3, 3, 3, doorPos);
    const doorBlocks = blocks.filter(block => block.x === doorPos.x && block.z === doorPos.z);
    expect(doorBlocks).toHaveLength(1);
    expect(doorBlocks[0].y).toBe(origin.y + 2);
  });

  it("generates roof tiles and a door frame", () => {
    const origin = new Vec3(0, 64, 0);
    expect(generateRoof(origin, 2, 2)).toHaveLength(4);
    expect(generateDoorFrame(origin)).toEqual([
      origin.offset(-1, 0, 0),
      origin.offset(1, 0, 0),
      origin.offset(-1, 1, 0),
      origin.offset(1, 1, 0),
      origin.offset(-1, 2, 0),
      origin.offset(0, 2, 0),
      origin.offset(1, 2, 0)
    ]);
  });
});