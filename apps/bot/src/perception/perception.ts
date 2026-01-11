import type { Bot } from "mineflayer";
import { Vec3 } from "vec3";
import {
    PerceptionSnapshot,
    PlayerPose,
    Environment,
    Hazards,
    LocalBlocks,
    InventorySummary,
    NearbyEntity,
    EntityKind,
    ChestMemoryEntry
} from "../settings/types.js";
import { listChestMemory, markChestInvalid, rememberChest } from "./chest-memory.js";

type PerceptionConfig =
{
    hz: number;
    nearbyRange: number;
    blockSampleRadiusXY: number;
    blockSampleHalfHeight: number;
    maxNearbyEntities: number;
    chatBuffer: number;
};

const DEFAULTS: PerceptionConfig =
{
    hz: 8,
    nearbyRange: 24,
    blockSampleRadiusXY: 4,
    blockSampleHalfHeight: 2,
    maxNearbyEntities: 48,
    chatBuffer: 20
};

export class PerceptionCollector
{
    private bot: Bot;
    private cfg: PerceptionConfig;
    private tickId = 0;
    private dirty = true;
    private interval?: NodeJS.Timeout;
    private chatRing: string[] = [];

    constructor(bot: Bot, cfg?: Partial<PerceptionConfig>)
    {
        this.bot = bot;
        this.cfg = { ...DEFAULTS, ...cfg };
    }

    start(onSnapshot?: (snap: PerceptionSnapshot) => void): void
    {
        this.wireEvents();

        const periodMs = Math.max(50, Math.round(1000 / this.cfg.hz));

        this.interval = setInterval(() =>
        {
            if (!this.dirty)
            {
                return;
            }

            const snap = this.buildSnapshot();

            this.dirty = false;

            if (onSnapshot)
            {
                onSnapshot(snap);
            }
        }, periodMs);
    }

    stop(): void
    {
        if (this.interval)
        {
            clearInterval(this.interval);
            this.interval = undefined;
        }
        this.unwireEvents();
    }

    getSnapshot(): PerceptionSnapshot
    {
        return this.buildSnapshot();
    }

    private wireEvents(): void
    {
        this.bot.on("move", () => this.markDirty());
        this.bot.on("health", () => this.markDirty());
        this.bot.on("time", () => this.markDirty());
        this.bot.on("blockUpdate", () => this.markDirty());
        this.bot.on("entitySpawn", () => this.markDirty());
        this.bot.on("entityGone", () => this.markDirty());
        this.bot.on("entityMoved", () => this.markDirty());

        this.bot.on("chat", (_username: string, message: string) =>
        {
            this.chatRing.push(message);
            if (this.chatRing.length > this.cfg.chatBuffer)
            {
                this.chatRing.shift();
            }
            this.markDirty();
        });
    }

    private unwireEvents(): void
    {
        this.bot.removeAllListeners("move");
        this.bot.removeAllListeners("health");
        this.bot.removeAllListeners("time");
        this.bot.removeAllListeners("blockUpdate");
        this.bot.removeAllListeners("entitySpawn");
        this.bot.removeAllListeners("entityGone");
        this.bot.removeAllListeners("entityMoved");
        this.bot.removeAllListeners("chat");
    }

    private markDirty(): void
    {
        this.dirty = true;
    }

    private buildSnapshot(): PerceptionSnapshot
    {
        const pose = this.collectPose();
        const environment = this.collectEnvironment();
        const inventory = this.collectInventory();
        const nearby = this.collectNearby();
        const blocks = this.collectLocalBlocks();
        const nearbyChests = this.collectNearbyChests();
        const hazards = this.deriveHazards(pose, blocks);
        const chatWindow = { lastMessages: [...this.chatRing] };

        const snap: PerceptionSnapshot =
        {
            version: "1.0.0",
            ts: Date.now(),
            tickId: this.tickId++,
            pose,
            environment,
            inventory,
            hazards,
            nearby,
            blocks,
            nearbyChests,
            chatWindow
        };

        return snap;
    }

    private collectPose(): PlayerPose
    {
        const e = this.bot.entity;

        return {
            position:
            {
                x: e.position.x,
                y: e.position.y,
                z: e.position.z
            },
            yaw: e.yaw,
            pitch: e.pitch,
            onGround: this.bot.entity.onGround ?? false,
            health: this.bot.health ?? 0,
            food: this.bot.food ?? 0,
            oxygen: this.bot.oxygenLevel ?? 0
        };
    }

    private collectEnvironment(): Environment
    {
        const t = this.bot.time?.time ?? 0;
        const dim = this.bot.game?.dimension ?? "overworld";

        const dayCycle =
            t < 1000  ? "dawn" :
            t < 12000 ? "day"  :
            t < 13000 ? "dusk" : "night";

        let dimension: Environment["dimension"] = "unknown";
        if (typeof dim === "string")
        {
            if (dim.includes("overworld")) dimension = "overworld";
            else if (dim.includes("nether")) dimension = "nether";
            else if (dim.includes("end")) dimension = "end";
        }

        return {
            dimension,
            isRaining: Boolean(this.bot.isRaining),
            timeTicks: t,
            dayCycle,
            biome: this.biomeNameAt(this.bot.entity.position)
        };
    }

    private collectInventory(): InventorySummary
    {
        const items = this.bot.inventory?.items() ?? [];

        const hotbar = Array.from({ length: 9 }, (_, i) =>
        {
            const slot = 36 + i;
            const it = this.bot.inventory?.slots?.[slot] ?? null;

            return {
                slot,
                name: it?.name ?? "empty",
                count: it?.count ?? 0
            };
        });

        const keyCounts =
        {
            blocks: items.filter(i => i.stackSize >= 1 && (i.name.includes("planks") || i.name.includes("stone") || i.name.includes("dirt"))).reduce((a, b) => a + (b.count ?? 0), 0),
            food: items.filter(i => i.name.includes("apple") || i.name.includes("bread") || i.name.includes("cooked")).reduce((a, b) => a + (b.count ?? 0), 0),
            fuel: items.filter(i => i.name.includes("coal") || i.name.includes("charcoal")).reduce((a, b) => a + (b.count ?? 0), 0),
            tools: items.filter(i => i.name.includes("pickaxe") || i.name.includes("axe") || i.name.includes("shovel")).length
        };

        return {
            totalSlots: this.bot.inventory?.slots?.length ?? 46,
            usedSlots: items.length,
            hotbar,
            items: items.map((item) => ({ name: item.name, count: item.count ?? 0 })),
            keyCounts
        };
    }

    private collectNearby():
    {
        maxRange: number;
        entities: NearbyEntity[];
    }
    {
        const origin = this.bot.entity.position;
        const entities = Object.values(this.bot.entities ?? {});

        const n = entities
            .filter(e =>
            {
                if (!e.position) return false;
                const dx = e.position.x - origin.x;
                const dy = e.position.y - origin.y;
                const dz = e.position.z - origin.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                return d2 <= this.cfg.nearbyRange * this.cfg.nearbyRange;
            })
            .map(e =>
            {
                const kind: EntityKind = classifyEntity(e.name, e.type ?? "other");
                const dx = e.position.x - origin.x;
                const dy = e.position.y - origin.y;
                const dz = e.position.z - origin.z;
                const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

                const velocity =
                {
                    x: e.velocity?.x ?? 0,
                    y: e.velocity?.y ?? 0,
                    z: e.velocity?.z ?? 0
                };

                const item: NearbyEntity =
                {
                    id: e.id ?? 0,
                    kind,
                    name: e.name ?? "unknown",
                    position:
                    {
                        x: e.position.x,
                        y: e.position.y,
                        z: e.position.z
                    },
                    distance: Number(dist.toFixed(2)),
                    velocity
                };

                return item;
            })
            .sort((a, b) => a.distance - b.distance)
            .slice(0, this.cfg.maxNearbyEntities);

        return {
            maxRange: this.cfg.nearbyRange,
            entities: n
        };
    }

    private collectLocalBlocks(): LocalBlocks
    {
        const me = this.bot.entity.position.floored();
        const below = me.offset(0, -1, 0);

        const solidBelow = !!this.bot.blockAt(below)?.boundingBox && this.bot.blockAt(below)?.name !== "air";

        const lookAhead = this.directionUnit(this.bot.entity.yaw);
        const ahead = me.offset(lookAhead.x, 0, lookAhead.z);

        const aheadBlock = this.bot.blockAt(ahead);
        const airAhead = !aheadBlock || aheadBlock.name === "air";

        const sample: LocalBlocks["sample5x5"] = [];

        for (let dx = -this.cfg.blockSampleRadiusXY; dx <= this.cfg.blockSampleRadiusXY; dx++)
        {
            for (let dz = -this.cfg.blockSampleRadiusXY; dz <= this.cfg.blockSampleRadiusXY; dz++)
            {
                const target = new Vec3(me.x + dx, me.y, me.z + dz);
                const b = this.bot.blockAt(target);
                sample.push({
                    relative:
                    {
                        x: dx, y: 0, z: dz
                    },
                    name: b?.name ?? null
                });
            }
        }

        return {
            solidBelow,
            airAhead,
            sample5x5: sample
        };
    }

    private collectNearbyChests(): ChestMemoryEntry[]
    {
        const chestId = this.bot.registry?.blocksByName?.chest?.id;
        if (typeof chestId !== "number")
        {
            return listChestMemory();
        }

        const chests = this.bot.findBlocks(
        {
            matching: chestId,
            maxDistance: this.cfg.nearbyRange,
            count: 128
        });

        for (const chest of chests)
        {
            rememberChest({ x: chest.x, y: chest.y, z: chest.z });
        }

        const memory = listChestMemory();
        for (const entry of memory)
        {
            const position = new Vec3(entry.position.x, entry.position.y, entry.position.z);
            const dist = this.bot.entity.position.distanceTo(position);
            if (dist > this.cfg.nearbyRange)
            {
                continue;
            }

            const block = this.bot.blockAt(position);
            if (!block || block.name !== "chest")
            {
                markChestInvalid(entry.position);
            }
        }

        return listChestMemory();
    }

    private deriveHazards(pose: PlayerPose, blocks: LocalBlocks): Hazards
    {
        const me = this.bot.entity.position.floored();

        const namesAround = (dx: number, dy: number, dz: number) =>
        {
            const b = this.bot.blockAt(new Vec3(me.x + dx, me.y + dy, me.z + dz));
            return b?.name ?? "air";
        };

        const near = (names: string[]) =>
        {
            for (let dx = -1; dx <= 1; dx++)
            {
                for (let dy = -1; dy <= 1; dy++)
                {
                    for (let dz = -1; dz <= 1; dz++)
                    {
                        const nm = namesAround(dx, dy, dz);
                        if (names.includes(nm)) return true;
                    }
                }
            }
            return false;
        };

        const nearLava = near(["lava", "flowing_lava", "lava_cauldron"]);
        const nearFire = near(["fire", "campfire", "soul_campfire"]);
        const nearCactus = near(["cactus"]);
        const dropEdge = !blocks.solidBelow && pose.position.y % 1 < 0.2;
        const nearVoid = this.bot.entity.position.y < 5;

        return {
            nearLava,
            nearFire,
            nearVoid,
            nearCactus,
            dropEdge
        };
    }

    private directionUnit(yaw: number): { x: number; z: number }
    {
        const x = -Math.sin(yaw);
        const z = Math.cos(yaw);
        const len = Math.hypot(x, z) || 1;
        return {
            x: Math.round((x / len)),
            z: Math.round((z / len))
        };
    }

    private biomeNameAt(pos: Vec3): string | undefined
    {  
        const x = Math.floor(pos.x);
        const z = Math.floor(pos.z);
        const y = 0;

        const biomeId = (this.bot.world as any)?.getBiome?.(new Vec3(x, y, z));
        if (biomeId == null) { return undefined; }

        const biomes = (this.bot as any)?.registry?.biomes;
        if (biomes && biomes[biomeId] && biomes[biomeId].name) { return biomes[biomeId].name as string; }

        return String(biomeId);
    }
}

function classifyEntity(name?: string, type?: string): EntityKind
{
    const n = (name ?? "").toLowerCase();

    if (type === "player" || n === "player") { return "player"; }

    const hostiles = ["zombie", "creeper", "skeleton", "spider", "enderman", "witch", "pillager", "blaze", "guardian"];
    const passive = ["cow", "sheep", "chicken", "pig", "villager", "horse"];
    const items = ["item"];
    const projectiles = ["arrow", "fireball", "snowball", "ender_pearl"];

    if (hostiles.some(h => n.includes(h))) return "hostile";
    if (passive.some(p => n.includes(p))) return "passive";
    if (items.some(i => n.includes(i))) return "item";
    if (projectiles.some(p => n.includes(p))) return "projectile";

    return "other";
}