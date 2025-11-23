@echo off
title MineAgents Bot
echo Starting MineAgents...

if not exist "node_modules" (
    echo First run detected. Installing libraries...
    call pnpm install
)

cd apps\bot
call pnpm start
pause