import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { exec, execSync, spawn } from "node:child_process";
import { dump as dumpYaml } from "js-yaml";
import { createRoster, writeRoster } from "../teamwork/roster.js";

interface AgentLaunchConfig {
    name: string;
    role: string;
    configPath: string;
}

export async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ask = (query: string, def: string): Promise<string> => {
        return new Promise(resolve => {
            rl.question(`${query} [${def}]: `, (ans) => {
                resolve(ans.trim() || def);
            });
        });
    };
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

    console.log("\n--- Global Connection Settings ---");
    const host = await ask("What is the IP address of your Minecraft server?\n   (If the server is running on this same computer, keep 127.0.0.1)", "127.0.0.1");
    const port = await ask("What port is the server listening on?\n   (Java Edition defaults to 25565)", "25565");
    const version = await ask("Which version of Minecraft is the server running?", "1.21");

    console.log("\n--- Research Experiment Setup ---");
    console.log("Select Experiment Condition:");
    console.log("1. Baseline (Single Agent, No RAG, No Narration, No Coordination)");
    console.log("2. MineAgents (Multi-Agent, RAG, Narration, Coordination)");
    console.log("3. Custom (Manual Configuration)");
    
    const mode = await ask("Select mode", "2");

    let count = 1;
    let ragEnabled = true;
    let narrationEnabled = true;
    let safetyEnabled = true;
    let nameStrategy = "1";
    let roleStrategy = "1";
    let roles = ["gatherer", "builder", "supervisor"];

    if (mode === "1") {
        console.log("\n[Setup] Configuring BASELINE Condition.");
        console.log("   - Agents: 1");
        console.log("   - Role: Generalist");
        console.log("   - RAG: Disabled");
        console.log("   - Narration: Disabled");
        count = 1;
        ragEnabled = false;
        narrationEnabled = false;
        roles = ["generalist"]; 
    } else if (mode === "2") {
        console.log("\n[Setup] Configuring MINEAGENTS Condition.");
        console.log("   - RAG: Enabled");
        console.log("   - Narration: Enabled");
        const countStr = await ask("How many agents for this trial?", "3");
        count = parseInt(countStr) || 3;
    } else {
        const countStr = await ask("How many agents would you like to spawn?", "1");
        count = parseInt(countStr) || 1;
        
        nameStrategy = await ask("Would you like to customize your agent names? (1: Auto-assign them for me, 2: Customize each)", "1");
        roleStrategy = await ask("Would like to customize your agent roles? (1: Auto-assign them for me, 2: Customize each)", "1");
    }

    const agents: AgentLaunchConfig[] = [];
    const trialId = Date.now().toString();

    for (let i = 0; i < count; i++) {
        const index = i + 1;
        let name = `MineAgent${index}`;
        let role = "generalist";

        if (mode === "1") {
            role = "generalist";
        } else if (mode === "2") {
            role = roles[i % roles.length];
        } else {
            if (count > 1) role = roles[i % roles.length];
            
            if (nameStrategy === "2") {
                name = await ask(`Name for Agent ${index}`, name);
            }
            if (roleStrategy === "2" && count > 1) {
                role = await ask(`Role for ${name} (gatherer/builder/supervisor/generalist)`, role);
            }
        }

        const configDir = path.join(process.cwd(), "config", "generated");
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        
        const configPath = path.join(configDir, `${name}.yaml`);
        
        const botConfig = {
            connection: { host, port: parseInt(port), username: name, version },
            perception: { hz: 8, nearbyRange: 24, blockSampleRadiusXY: 4, blockSampleHalfHeight: 2, maxNearbyEntities: 48, chatBuffer: 20 },
            safety: 
            {
                allowedActions:
                [
                    "analyzeInventory",
                    "build",
                    "chat",
                    "craft",
                    "drop",
                    "equip",
                    "gather",
                    "give",
                    "loot",
                    "mine",
                    "move",
                    "perceive",
                    "pickup",
                    "requestResource",
                    "smelt",
                ],
                blockedMaterials: ["tnt", "lava"],
                customProfanityList: [],
                rateLimits: { global: { max: 24, windowMs: 10000 } } 
            },
            agent: {
                role
            },
            features: { 
                ragEnabled, 
                narrationEnabled, 
                safetyEnabled 
            }
        };

        fs.writeFileSync(configPath, dumpYaml(botConfig));
        agents.push({ name, role, configPath });
    }

    rl.close();

    console.log("\n" + "=".repeat(50));
    console.log("Launching Dashboard Infrastructure...");
    
    const dashboardDir = path.resolve(process.cwd(), "..", "dashboard");
    
    if (fs.existsSync(dashboardDir)) {
        console.log(`[Launcher] Starting Dashboard Server from ${dashboardDir}...`);
        
        const serverProcess = spawn("cmd", ["/c", "npm run server"], { 
            cwd: dashboardDir,
            detached: true,
            stdio: "ignore",
            shell: true
        });
        serverProcess.unref();

        console.log("[Launcher] Starting Dashboard UI...");
        const uiProcess = spawn("cmd", ["/c", "npm run dev"], { 
            cwd: dashboardDir,
            detached: true,
            stdio: "ignore",
            shell: true
        });
        uiProcess.unref();

        setTimeout(() => {
            console.log("[Launcher] Opening Dashboard in browser (http://localhost:5173)...");
            exec("start http://localhost:5173"); 
        }, 3000);
    } else {
        console.warn("[Launcher] Warning: Dashboard directory not found at ../dashboard. Skipping dashboard launch.");
    }

    console.log("=".repeat(50));

    console.log("\n[Launcher] Building bot project...");
    try {
        execSync("pnpm build", { stdio: "inherit" });
    } catch (e) {
        console.error("[Launcher] Build failed. Please check errors above.");
        process.exit(1);
    }

    if (count > 1 || mode === "2") {
        const coordinationDir = path.join(process.cwd(), "dist", "teamwork", ".data");
        
        if (!fs.existsSync(coordinationDir)) {
            fs.mkdirSync(coordinationDir, { recursive: true });
        }

        const oldFiles = ["team-plan.json", "team-plan.lock", "coordination.json", "coordination.lock"];
        oldFiles.forEach(f => {
            try { fs.unlinkSync(path.join(coordinationDir, f)); } catch {}
        });

        const rosterPath = path.join(coordinationDir, "roster.json");
        const roster = createRoster(
            agents.map((a, i) => ({
                name: a.name,
                agentId: i + 1,
                role: a.role as any
            }))
        );

        writeRoster(rosterPath, roster);
        console.log(`[Launcher] Team roster created: ${count} agents`);
    }

    console.log("\n" + "=".repeat(50));
    console.log(`Launching ${count} agents in separate windows...`);
    console.log("=".repeat(50));

    agents.forEach((agent, idx) => {
        
        const envVars = [
            `set BOT_CONFIG=${agent.configPath}`,
            `set BOT_NAME=${agent.name}`,
            `set BOT_ROLE=${agent.role}`,
            `set BOT_AGENT_ID=${idx + 1}`,
            `set BOT_AGENT_COUNT=${count}`,
            `set BOT_TRIAL_ID=${trialId}`,
            `set BOT_ENABLE_RAG=${ragEnabled}`,
            `set BOT_ENABLE_NARRATION=${narrationEnabled}`
        ].join("&& ");
        
        const command = `start "${agent.name}" cmd /c "${envVars}&& node dist/index.js"`;
        
        exec(command, (error) => {
            if (error) console.error(`[Launcher] Error spawning ${agent.name}:`, error);
        });
    });
rl.close();
}

if (process.env.NODE_ENV !== "test") {
    main();
}