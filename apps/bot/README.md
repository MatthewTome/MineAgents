# apps/bot
Mineflayer bot app (TypeScript).

## Configuration

1. Copy `config/bot.sample.yaml` to `config/bot.config.yaml` (or set the `BOT_CONFIG` environment variable to another path).
2. Adjust the `connection` block to point at your Minecraft server.
3. Tweak the `perception` block to control how often the bot samples the world.

The loader accepts YAML or JSON. If something is wrong with the file, it prints a human-friendly message with the field and line number so you can fix it quickly.