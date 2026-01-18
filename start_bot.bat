@echo off
title MineAgents Launcher
echo Starting Setup Wizard...

cd apps\bot

if not exist "node_modules" (
    echo Installing dependencies...
    call pnpm install
)

call npx tsx src/settings/launcher.ts

pause