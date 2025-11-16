import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import type { Bot } from "mineflayer";
import { PerceptionCollector } from "./perception";
import { describe, it, expect } from "vitest";

// --- Mocks -------------------------------------------------------------------

interface MockBlock {
  name: string;
  boundingBox?: string;
}

class MockBot extends EventEmitter {
  public entity =
    {
      id: 1,
      position: new Vec3(10, 65, 10),
      velocity: new Vec3(0, 0, 0),
      yaw: 0,
      pitch: 0.25,
      onGround: true,
      biome: { name: "plains" }
    };

  public health = 18;
  public food = 15;
  public oxygenLevel = 8;
  public time = { time: 6000 };
  public game = { dimension: "minecraft:overworld" };
  public isRaining = true;

  public inventory:
    {
      items: () => any[];
      slots: (null | { name: string; count: number })[];
    };

  public entities: Record<number, any>;

  private readonly inventoryItems =
    [
      { name: "oak_planks", stackSize: 64, count: 32 },
      { name: "stone", stackSize: 64, count: 16 },
      { name: "bread", stackSize: 64, count: 5 },
      { name: "cooked_beef", stackSize: 64, count: 3 },
      { name: "coal", stackSize: 64, count: 9 },
      { name: "charcoal", stackSize: 64, count: 4 },
      { name: "iron_pickaxe", stackSize: 1, count: 1 }
    ];

  private readonly blocks = new Map<string, MockBlock>();

  constructor() {
    super();

    const slots = Array.from({ length: 46 }, () => null as null | { name: string; count: number });
    slots[36] = { name: "stone_pickaxe", count: 1 };
    slots[37] = { name: "bread", count: 2 };

    this.inventory =
    {
      slots,
      items: () => this.inventoryItems
    };

    const origin = this.entity.position;
    const groundY = origin.y - 1;

    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const key = this.blockKey(origin.x + dx, groundY, origin.z + dz);
        this.blocks.set(key, { name: dx === 0 && dz === 0 ? "stone" : "dirt", boundingBox: "block" });
      }
    }

    this.blocks.set(this.blockKey(origin.x, origin.y, origin.z + 1), { name: "oak_log", boundingBox: "block" });
    this.blocks.set(this.blockKey(origin.x + 1, groundY, origin.z), { name: "lava" });

    this.entities =
    {
      2:
      {
        id: 2,
        name: "Zombie",
        type: "mob",
        position: new Vec3(origin.x + 2, origin.y, origin.z),
        velocity: new Vec3(0.2, 0, 0)
      },
      3:
      {
        id: 3,
        name: "Villager",
        type: "player",
        position: new Vec3(origin.x, origin.y, origin.z + 3),
        velocity: new Vec3(0, 0, 0)
      },
      4:
      {
        id: 4,
        name: "Cow",
        type: "mob",
        position: new Vec3(origin.x, origin.y, origin.z + 4),
        velocity: new Vec3(0, 0, 0)
      }
    };
  }

  public blockAt(vec: Vec3): MockBlock | null {
    const key = this.blockKey(vec.x, vec.y, vec.z);
    return this.blocks.get(key) ?? null;
  }

  private blockKey(x: number, y: number, z: number): string {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }
}

// --- Helpers -----------------------------------------------------------------

const makeCollector = (cfg: Record<string, unknown> = {}) => {
  const bot = new MockBot();
  const collector = new PerceptionCollector(bot as unknown as Bot, cfg as any);
  return { bot, collector };
};

// --- Tests -------------------------------------------------------------------

describe("PerceptionCollector", function () {
  it("builds a complete snapshot from the bot state", function () {
    const { bot, collector } = makeCollector({ chatBuffer: 3, nearbyRange: 20, blockSampleRadiusXY: 1 });

    (collector as any).wireEvents();
    bot.emit("chat", "Alex", "hello");
    bot.emit("chat", "Steve", "world");

    const snapshot = collector.getSnapshot();

    assert.equal(snapshot.pose.position.x, bot.entity.position.x);
    assert.equal(snapshot.pose.health, bot.health);
    assert.equal(snapshot.environment.dimension, "overworld");
    assert.equal(snapshot.environment.dayCycle, "day");
    assert.equal(snapshot.environment.isRaining, true);

    assert.equal(snapshot.inventory.totalSlots, 46);
    assert.equal(snapshot.inventory.hotbar.length, 9);
    assert.equal(snapshot.inventory.hotbar[0].name, "stone_pickaxe");
    assert.equal(snapshot.inventory.keyCounts.blocks, 48);
    assert.equal(snapshot.inventory.keyCounts.food, 8);
    assert.equal(snapshot.inventory.keyCounts.fuel, 13);
    assert.equal(snapshot.inventory.keyCounts.tools, 1);

    assert.equal(snapshot.nearby.maxRange, 20);
    assert.ok(snapshot.nearby.entities.some(e => e.name === "Zombie" && e.kind === "hostile"));
    assert.ok(snapshot.nearby.entities.some(e => e.name === "Villager" && e.kind === "player"));
    assert.ok(snapshot.nearby.entities.some(e => e.name === "Cow" && e.kind === "passive"));

    assert.equal(snapshot.blocks.solidBelow, true);
    assert.equal(snapshot.blocks.airAhead, false);
    assert.equal(snapshot.blocks.sample5x5.length, 9);

    assert.equal(snapshot.hazards.nearLava, true);
    assert.equal(snapshot.hazards.dropEdge, false);

    assert.deepEqual(snapshot.chatWindow.lastMessages, ["hello", "world"]);
  });

  it("marks the snapshot as dirty when Mineflayer emits world events", function () {
    const { bot, collector } = makeCollector();
    let dirtyCount = 0;

    (collector as any).markDirty = () => { dirtyCount++; };
    (collector as any).wireEvents();

    const events = ["move", "health", "time", "blockUpdate", "entitySpawn", "entityGone", "entityMoved"];
    events.forEach((name, idx) => {
      bot.emit(name);
      assert.equal(dirtyCount, idx + 1);
    });

    bot.emit("chat", "Alex", "hey");
    assert.equal(dirtyCount, events.length + 1);
  });

  it("keeps only the newest messages in the configured chat buffer", function () {
    const { bot, collector } = makeCollector({ chatBuffer: 2 });

    (collector as any).wireEvents();

    bot.emit("chat", "Alex", "msg1");
    bot.emit("chat", "Alex", "msg2");
    bot.emit("chat", "Alex", "msg3");

    const snapshot = collector.getSnapshot();
    assert.deepEqual(snapshot.chatWindow.lastMessages, ["msg2", "msg3"]);
  });
});
