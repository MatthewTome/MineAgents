import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { dump as dumpYaml } from "js-yaml";
export async function runSetupWizard(destinationPath) {
    console.clear();
    console.log("\n" + "=".repeat(60));
    console.log("👋  WELCOME TO MINEAGENTS!");
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
    const ask = (title, description, defaultValue) => {
        return new Promise((resolve) => {
            console.log(`\n🔹 QUESTION: ${title}`);
            console.log(`   ${description}`);
            rl.question(`   Type value or press ENTER to accept [${defaultValue}]: `, (answer) => {
                const finalValue = answer.trim() || defaultValue;
                console.log(`   ✅ Selected: ${finalValue}`);
                resolve(finalValue);
            });
        });
    };
    const host = await ask("Server IP Address", "What is the IP address of your Minecraft server?\n   (If the server is running on this same computer, keep 127.0.0.1)", "127.0.0.1");
    const portStr = await ask("Server Port", "What port is the server listening on?\n   (Java Edition defaults to 25565)", "25565");
    const username = await ask("Bot Name", "What should this agent be called in-game?", "MineAgent");
    const version = await ask("Minecraft Version", "Which version of Minecraft is the server running?", "1.21");
    rl.close();
    console.log("\n" + "-".repeat(60));
    console.log("⚙️  Saving configuration...");
    const config = {
        connection: {
            host,
            port: parseInt(portStr, 10),
            username,
            version
        },
        perception: {
            hz: 5,
            nearbyRange: 16,
            blockSampleRadiusXY: 2,
            blockSampleHalfHeight: 1,
            maxNearbyEntities: 24,
            chatBuffer: 10
        }
    };
    const dir = path.dirname(destinationPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const yamlStr = dumpYaml(config);
    fs.writeFileSync(destinationPath, yamlStr, "utf8");
    console.log(`✅ Setup complete! Settings saved to:`);
    console.log(`   ${destinationPath}`);
    console.log("-".repeat(60));
    console.log("🚀 Starting bot now...\n");
}