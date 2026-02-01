import { vi } from "vitest";

type MockItem = { name: string; count: number; type?: number; metadata?: number };
type MockPosition = { x: number; y: number; z: number; toString: () => string; offset: (dx: number, dy: number, dz: number) => MockPosition; floored: () => MockPosition };

export function makePosition(x: number, y: number, z: number): MockPosition {
  return {
    x,
    y,
    z,
    toString: () => `${x},${y},${z}`,
    offset: (dx, dy, dz) => makePosition(x + dx, y + dy, z + dz),
    floored: () => makePosition(Math.floor(x), Math.floor(y), Math.floor(z))
  };
}

export function makeMockBot(options?: {
  items?: MockItem[];
  registryItems?: Record<string, { id: number; name?: string }>;
  registryBlocks?: Record<string, { id: number }>;
}) {
  const items = options?.items ?? [];
  const registryItems = options?.registryItems ?? {};
  const registryBlocks = options?.registryBlocks ?? {};
  return {
    username: "TestBot",
    entity: { position: makePosition(0, 64, 0) },
    registry: {
      itemsByName: registryItems,
      blocksByName: registryBlocks
    },
    inventory: {
      items: () => items
    },
    findBlock: vi.fn(),
    blockAt: vi.fn(),
    craft: vi.fn(),
    equip: vi.fn(),
    placeBlock: vi.fn(),
    openFurnace: vi.fn(),
    openContainer: vi.fn(),
    toss: vi.fn(),
    tossStack: vi.fn(),
    lookAt: vi.fn(),
    chat: vi.fn(),
    findBlocks: vi.fn(),
    pathfinder: { stop: vi.fn() }
  };
}