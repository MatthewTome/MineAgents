# Manual action testing with `!act`

This folder contains the bot's action handlers. You can trigger **any action directly** from in‑game chat without the LLM by using the `!act` command. This is helps with reproducing bugs, running controlled experiments, and validating behavior.

## Command format (plain English)

```
!act [id=my-id] <action> {jsonParams}
```

- `id=` is optional. If you don’t include it, the bot generates one.
- `<action>` is the name of the action you want the bot to run.
- `{jsonParams}` is optional JSON data with the settings for that action.

**Important:** JSON must use double quotes around keys and values.

### Quick examples

```
!act move {"position":{"x":10,"y":64,"z":-5}}
!act gather {"item":"log"}
!act craft {"recipe":"wooden_pickaxe","count":1}
!act build {"structure":"wall","material":"oak_planks","width":5,"height":3}
```

## Actions you can run

Below is a guide to each action, along with example chat commands.

### chat
Send a message as the bot.
```
!act chat {"message":"Hello from the bot!"}
```

### perceive
Have the bot check nearby information or inventory.
```
!act perceive {"check":"inventory"}
```

### analyzeInventory
Same as `perceive`, just a different name.
```
!act analyzeInventory {"check":"inventory"}
```

### move
Walk to a position or toward an entity.
```
!act move {"position":{"x":5,"y":64,"z":5}}
!act move {"entityName":"cow","range":2}
```

### mine
Break a specific block.
```
!act mine {"block":"oak_log"}
!act mine {"position":{"x":3,"y":63,"z":-2}}
```

### gather
Get an item by looting, mining, or picking up drops. (This is a key action for research testing.)
```
!act gather {"item":"log"}
!act gather {"item":"iron_ingot","timeoutMs":60000}
```

### pickup
Pick up nearby dropped items.
```
!act pickup {"item":"stick"}
```

### craft
Craft items in the crafting grid or at a crafting table.
```
!act craft {"recipe":"stone_pickaxe","count":1}
```

### smelt
Smelt items in a furnace.
```
!act smelt {"item":"raw_iron","fuel":"coal","count":9}
```

### build
Place a simple structure.
```
!act build {"structure":"wall","material":"oak_planks","width":4,"height":3}
!act build {"structure":"platform","material":"cobblestone","width":5,"length":5}
```

### loot
Open a chest and take items.
```
!act loot {"item":"apple","maxDistance":8}
```

### give
Give items to a teammate.
```
!act give {"target":"TeammateName","item":"oak_log","count":4,"method":"drop"}
```

### drop
Drop items on the ground.
```
!act drop {"item":"cobblestone","count":16}
!act drop {"item":"all"}
```

### requestResource
Ask teammates for items via chat.
```
!act requestResource {"item":"iron_ingot","count":3,"urgent":true}
```

## Notes for research testing

- `!act` is designed for **reproducibility**: you can run the same action repeatedly to compare results.
- Combine `!act` with in‑game logs to verify what the bot **intended** to do and what it actually did.
- If an action doesn’t run, check the safety allowlist in settings to confirm the action is permitted.