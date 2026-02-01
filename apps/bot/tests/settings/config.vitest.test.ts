import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, createDefaultBotConfig, loadBotConfig } from "../../src/settings/config.js";

const writeTempConfig = (content: string, ext: string) =>
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-config-"));
    const file = path.join(dir, `config${ext}`);
    fs.writeFileSync(file, content, "utf8");
    return file;
};

describe("config loader", () =>
{
    it("applies defaults when fields are missing", () =>
    {
        const cfgPath = writeTempConfig([
            "connection:",
            "  host: localhost"
        ].join("\n"), ".yaml");

        const cfg = loadBotConfig(cfgPath);

        console.log({ actualConfig: cfg, expectedPort: 25565 });

        expect(cfg.connection.port).toBe(25565);
        expect(cfg.connection.username).toBe("MineAgent");
        expect(cfg.perception.hz).toBe(8);
        expect(cfg.perception.maxNearbyEntities).toBe(48);
    });

    it("loads JSON configs", () =>
    {
        const json = JSON.stringify(
        {
            connection:
            {
                host: "10.0.0.5",
                port: 25570,
                username: "Tester",
                version: "1.21"
            },
            perception:
            {
                hz: 8,
                nearbyRange: 16,
                blockSampleRadiusXY: 1,
                blockSampleHalfHeight: 1,
                maxNearbyEntities: 10,
                chatBuffer: 5
            }
        }, null, 2);

        const cfgPath = writeTempConfig(json, ".json");

        const cfg = loadBotConfig(cfgPath);
        expect(cfg.connection.host).toBe("10.0.0.5");
        expect(cfg.perception.nearbyRange).toBe(16);
    });

    it("returns a readable error with line and field", () =>
    {
        const cfgPath = writeTempConfig([
            "perception:",
            "  hz: not-a-number",
            "  nearbyRange: 12",
            "  blockSampleRadiusXY: 2",
            "  blockSampleHalfHeight: 1",
            "  maxNearbyEntities: 24",
            "  chatBuffer: 10",
            "connection:",
            "  host: 127.0.0.1"
        ].join("\n"), ".yaml");

        let caught: ConfigError | null = null;

        try
        {
            loadBotConfig(cfgPath);
        }
        catch (err)
        {
            caught = err as ConfigError;
        }

        console.log({ 
            actualErrorField: caught?.field, 
            actualLine: caught?.line, 
            expectedField: "perception.hz" 
        });

        expect(caught).toBeInstanceOf(ConfigError);
        expect(caught?.field).toBe("perception.hz");
        expect(caught?.line).toBe(2);
        expect(caught?.message).toContain("perception.hz");
    });

    it("creates a fresh default config snapshot", () =>
    {
        const config = createDefaultBotConfig();
        config.connection.host = "mutated";

        const next = createDefaultBotConfig();

        expect(next.connection.host).toBe("127.0.0.1");
        expect(next.features.ragEnabled).toBe(true);
    });
});