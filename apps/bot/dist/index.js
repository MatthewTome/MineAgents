import mineflayer from "mineflayer";
import { PerceptionCollector } from "./perception";
function createBot() {
    const bot = mineflayer.createBot({
        host: "127.0.0.1",
        port: 25565,
        username: "MineAgent",
        version: "1.21",
    });
    bot.once("spawn", () => {
        console.log("[bot] spawned");
        const perception = new PerceptionCollector(bot, {
            hz: 5,
            nearbyRange: 12,
            blockSampleRadiusXY: 2,
            blockSampleHalfHeight: 1,
            maxNearbyEntities: 24,
            chatBuffer: 10
        });
        let lastLog = 0;
        perception.start((snap) => {
            const now = Date.now();
            if (now - lastLog > 1000) {
                lastLog = now;
                const minimal = {
                    tickId: snap.tickId,
                    pos: snap.pose.position,
                    day: snap.environment.dayCycle,
                    dim: snap.environment.dimension,
                    health: snap.pose.health,
                    food: snap.pose.food,
                    nearby: snap.nearby.entities.slice(0, 3).map(e => ({ kind: e.kind, name: e.name, d: e.distance })),
                    hazards: snap.hazards
                };
                console.clear();
                console.log(JSON.stringify(minimal, null, 2));
            }
        });
        bot.on("end", () => {
            perception.stop();
        });
    });
    bot.on("kicked", (reason) => {
        console.error("[bot] kicked:", reason);
    });
    bot.on("error", (err) => {
        console.error("[bot] error:", err);
    });
    return bot;
}
createBot();
