import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { dump as dumpYaml } from "js-yaml";
import { BotConfig } from "./config.js";

export async function runSetupWizard(destinationPath: string): Promise<void>
{
    console.clear();
    console.log("\n" + "=".repeat(60));
    console.log("WELCOME TO MINEAGENTS!");
    console.log("=".repeat(60));
    console.log("   It looks like this is your first time running the bot.");
    console.log("   I need to know where your Minecraft server is located.");
    console.log("");
    console.log("   INSTRUCTIONS:");
    console.log("   - If the default value (shown in brackets) is correct,");
    console.log("     simply press the [ENTER] key.");
    console.log("   - Otherwise, type the correct value and press [ENTER].");
    console.log("=".repeat(60) + "\n");

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (title: string, description: string, defaultValue: string): Promise<string> =>
    {
        return new Promise((resolve) => {
            console.log(`\nQUESTION: ${title}`);
            console.log(`   ${description}`);
            
            rl.question(`   Type value or press ENTER to accept [${defaultValue}]: `, (answer) => {
                const finalValue = answer.trim() || defaultValue;
                console.log(`Selected: ${finalValue}`);
                resolve(finalValue);
            });
        });
    };

    const host = await ask(
        "Server IP Address", 
        "What is the IP address of your Minecraft server?\n   (If the server is running on this same computer, keep 127.0.0.1)", 
        "127.0.0.1"
    );

    const portStr = await ask(
        "Server Port", 
        "What port is the server listening on?\n   (Java Edition defaults to 25565)", 
        "25565"
    );

    const username = await ask(
        "Bot Name", 
        "What should this agent be called in-game?", 
        "MineAgent"
    );

    const version = await ask(
        "Minecraft Version", 
        "Which version of Minecraft is the server running?", 
        "1.21"
    );

    rl.close();

    console.log("\n" + "-".repeat(60));
    console.log("Saving configuration...");

    const config: BotConfig = {
        connection: {
            host,
            port: parseInt(portStr, 10),
            username,
            version
        },
        perception: {
            hz: 8,
            nearbyRange: 24,
            blockSampleRadiusXY: 4,
            blockSampleHalfHeight: 2,
            maxNearbyEntities: 48,
            chatBuffer: 20
        },
        safety: {
            allowedActions: [
                "chat", "perceive", "analyzeInventory", "move", "mine", 
                "gather", "craft", "smelt", "build", "loot", 
                "eat", "smith", "hunt", "fight", "fish"
            ],
            blockedMaterials: [
                "tnt", "lava", "flint_and_steel", "fire_charge", "fire"
            ],
            customProfanityList: [
                "kys", "kill yourself"
            ],
            rateLimits: {
                global: { max: 24, windowMs: 10000 },
                perAction: {
                    chat: { max: 4, windowMs: 2000 },
                    build: { max: 2, windowMs: 2000 },
                    mine: { max: 6, windowMs: 2000 }
                }
            }
        }
    };

    const dir = path.dirname(destinationPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const yamlStr = dumpYaml(config);
    fs.writeFileSync(destinationPath, yamlStr, "utf8");

    console.log(`Setup complete! Settings saved to:`);
    console.log(`   ${destinationPath}`);
    console.log("-".repeat(60));
    console.log("Starting bot now...\n");
}