import type { Bot } from "mineflayer";

export interface RecipeItem {
    id: number;
    metadata: number | null;
    count: number;
}

export interface BuiltRecipe {
    result: RecipeItem;
    inShape?: RecipeItem[][];
    outShape?: RecipeItem[][];
    ingredients?: RecipeItem[];
    delta: RecipeItem[];
    requiresTable: boolean;
}

export interface HardcodedRecipeDefinition {
    resultName: string;
    resultCount: number;
    inShape?: (string | null)[][];
    ingredients?: string[];
    requiresTable: boolean;
}

const WOOD_TYPES = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak", "mangrove", "cherry", "crimson", "warped"];

function createPlankRecipes(): Record<string, HardcodedRecipeDefinition> {
    const recipes: Record<string, HardcodedRecipeDefinition> = {};
    for (const wood of WOOD_TYPES) {
        const logName = wood === "crimson" || wood === "warped" ? `${wood}_stem` : `${wood}_log`;
        recipes[`${wood}_planks`] = {
            resultName: `${wood}_planks`,
            resultCount: 4,
            ingredients: [logName],
            requiresTable: false
        };
    }
    return recipes;
}

export const ESSENTIAL_RECIPES: Record<string, HardcodedRecipeDefinition> = {
    ...createPlankRecipes(),

    "stick": {
        resultName: "stick",
        resultCount: 4,
        inShape: [
            ["#planks"],
            ["#planks"]
        ],
        requiresTable: false
    },

    "crafting_table": {
        resultName: "crafting_table",
        resultCount: 1,
        inShape: [
            ["#planks", "#planks"],
            ["#planks", "#planks"]
        ],
        requiresTable: false
    },

    "wooden_pickaxe": {
        resultName: "wooden_pickaxe",
        resultCount: 1,
        inShape: [
            ["#planks", "#planks", "#planks"],
            [null, "stick", null],
            [null, "stick", null]
        ],
        requiresTable: true
    },

    "wooden_axe": {
        resultName: "wooden_axe",
        resultCount: 1,
        inShape: [
            ["#planks", "#planks"],
            ["#planks", "stick"],
            [null, "stick"]
        ],
        requiresTable: true
    },

    "wooden_shovel": {
        resultName: "wooden_shovel",
        resultCount: 1,
        inShape: [
            ["#planks"],
            ["stick"],
            ["stick"]
        ],
        requiresTable: true
    },

    "wooden_sword": {
        resultName: "wooden_sword",
        resultCount: 1,
        inShape: [
            ["#planks"],
            ["#planks"],
            ["stick"]
        ],
        requiresTable: true
    },

    "stone_pickaxe": {
        resultName: "stone_pickaxe",
        resultCount: 1,
        inShape: [
            ["cobblestone", "cobblestone", "cobblestone"],
            [null, "stick", null],
            [null, "stick", null]
        ],
        requiresTable: true
    },

    "stone_axe": {
        resultName: "stone_axe",
        resultCount: 1,
        inShape: [
            ["cobblestone", "cobblestone"],
            ["cobblestone", "stick"],
            [null, "stick"]
        ],
        requiresTable: true
    },

    "stone_shovel": {
        resultName: "stone_shovel",
        resultCount: 1,
        inShape: [
            ["cobblestone"],
            ["stick"],
            ["stick"]
        ],
        requiresTable: true
    },

    "stone_sword": {
        resultName: "stone_sword",
        resultCount: 1,
        inShape: [
            ["cobblestone"],
            ["cobblestone"],
            ["stick"]
        ],
        requiresTable: true
    },

    "iron_pickaxe": {
        resultName: "iron_pickaxe",
        resultCount: 1,
        inShape: [
            ["iron_ingot", "iron_ingot", "iron_ingot"],
            [null, "stick", null],
            [null, "stick", null]
        ],
        requiresTable: true
    },

    "iron_axe": {
        resultName: "iron_axe",
        resultCount: 1,
        inShape: [
            ["iron_ingot", "iron_ingot"],
            ["iron_ingot", "stick"],
            [null, "stick"]
        ],
        requiresTable: true
    },

    "iron_shovel": {
        resultName: "iron_shovel",
        resultCount: 1,
        inShape: [
            ["iron_ingot"],
            ["stick"],
            ["stick"]
        ],
        requiresTable: true
    },

    "iron_sword": {
        resultName: "iron_sword",
        resultCount: 1,
        inShape: [
            ["iron_ingot"],
            ["iron_ingot"],
            ["stick"]
        ],
        requiresTable: true
    },

    "furnace": {
        resultName: "furnace",
        resultCount: 1,
        inShape: [
            ["cobblestone", "cobblestone", "cobblestone"],
            ["cobblestone", null, "cobblestone"],
            ["cobblestone", "cobblestone", "cobblestone"]
        ],
        requiresTable: true
    },

    "chest": {
        resultName: "chest",
        resultCount: 1,
        inShape: [
            ["#planks", "#planks", "#planks"],
            ["#planks", null, "#planks"],
            ["#planks", "#planks", "#planks"]
        ],
        requiresTable: true
    },

    "torch": {
        resultName: "torch",
        resultCount: 4,
        inShape: [
            ["coal"],
            ["stick"]
        ],
        requiresTable: false
    }
};

function resolveIngredientName(name: string, bot: Bot): string | null {
    if (name.startsWith("#")) {
        const tag = name.slice(1);
        if (tag === "planks") {
            const plankItem = bot.inventory.items().find(item => item.name.endsWith("_planks"));
            if (plankItem) return plankItem.name;
            const logItem = bot.inventory.items().find(item => item.name.endsWith("_log") || item.name.endsWith("_stem"));
            if (logItem) {
                const woodType = logItem.name.replace(/_log$/, "").replace(/_stem$/, "");
                return `${woodType}_planks`;
            }
            return "oak_planks";
        }
        if (tag === "logs") {
            const logItem = bot.inventory.items().find(item => item.name.endsWith("_log") || item.name.endsWith("_stem"));
            return logItem?.name ?? "oak_log";
        }
    }
    return name;
}

export function buildRecipeFromDefinition(
    bot: Bot,
    definition: HardcodedRecipeDefinition
): BuiltRecipe | null {
    const registry = bot.registry;

    const resultItem = registry.itemsByName[definition.resultName];
    if (!resultItem) {
        console.warn(`[recipe] Unknown result item: ${definition.resultName}`);
        return null;
    }

    const result: RecipeItem = {
        id: resultItem.id,
        metadata: null,
        count: definition.resultCount
    };

    let inShape: RecipeItem[][] | undefined;
    let ingredients: RecipeItem[] | undefined;
    const consumedItems: Map<number, number> = new Map();

    if (definition.inShape) {
        inShape = [];
        for (const row of definition.inShape) {
            const recipeRow: RecipeItem[] = [];
            for (const cell of row) {
                if (cell === null) {
                    recipeRow.push({ id: -1, metadata: null, count: 1 });
                } else {
                    const resolvedName = resolveIngredientName(cell, bot);
                    if (!resolvedName) {
                        console.warn(`[recipe] Could not resolve ingredient: ${cell}`);
                        return null;
                    }
                    const item = registry.itemsByName[resolvedName];
                    if (!item) {
                        console.warn(`[recipe] Unknown ingredient item: ${resolvedName}`);
                        return null;
                    }
                    recipeRow.push({ id: item.id, metadata: null, count: 1 });
                    consumedItems.set(item.id, (consumedItems.get(item.id) ?? 0) + 1);
                }
            }
            inShape.push(recipeRow);
        }
    } else if (definition.ingredients) {
        ingredients = [];
        for (const ingName of definition.ingredients) {
            const resolvedName = resolveIngredientName(ingName, bot);
            if (!resolvedName) {
                console.warn(`[recipe] Could not resolve ingredient: ${ingName}`);
                return null;
            }
            const item = registry.itemsByName[resolvedName];
            if (!item) {
                console.warn(`[recipe] Unknown ingredient item: ${resolvedName}`);
                return null;
            }
            ingredients.push({ id: item.id, metadata: null, count: 1 });
            consumedItems.set(item.id, (consumedItems.get(item.id) ?? 0) + 1);
        }
    }

    const delta: RecipeItem[] = [];
    for (const [id, count] of consumedItems) {
        delta.push({ id, metadata: null, count: -count });
    }
    delta.push({ id: result.id, metadata: null, count: result.count });

    return {
        result,
        inShape,
        ingredients,
        delta,
        requiresTable: definition.requiresTable
    };
}

export function hasIngredientsForRecipe(bot: Bot, recipe: BuiltRecipe): boolean {
    for (const item of recipe.delta) {
        if (item.count < 0) {
            const needed = Math.abs(item.count);
            const have = bot.inventory.items()
                .filter(i => i.type === item.id)
                .reduce((sum, i) => sum + (i.count ?? 1), 0);
            if (have < needed) {
                return false;
            }
        }
    }
    return true;
}

export interface MissingIngredient {
    id: number;
    name: string;
    needed: number;
    have: number;
}

export function getMissingIngredients(bot: Bot, recipe: BuiltRecipe): MissingIngredient[] {
    const missing: MissingIngredient[] = [];
    for (const item of recipe.delta) {
        if (item.count < 0) {
            const needed = Math.abs(item.count);
            const have = bot.inventory.items()
                .filter(i => i.type === item.id)
                .reduce((sum, i) => sum + (i.count ?? 1), 0);
            if (have < needed) {
                const itemInfo = Object.entries(bot.registry.itemsByName)
                    .find(([_, v]) => v.id === item.id);
                missing.push({
                    id: item.id,
                    name: itemInfo ? itemInfo[0] : `item_${item.id}`,
                    needed,
                    have
                });
            }
        }
    }
    return missing;
}

export function resolveRecipeForItem(
    itemName: string,
    bot: Bot
): HardcodedRecipeDefinition | null {
    if (ESSENTIAL_RECIPES[itemName]) {
        return ESSENTIAL_RECIPES[itemName];
    }

    if (itemName === "planks" || itemName.endsWith("_planks")) {
        const logItem = bot.inventory.items().find(item =>
            item.name.endsWith("_log") || item.name.endsWith("_stem")
        );
        if (logItem) {
            const woodType = logItem.name.replace(/_log$/, "").replace(/_stem$/, "");
            const plankName = `${woodType}_planks`;
            if (ESSENTIAL_RECIPES[plankName]) {
                return ESSENTIAL_RECIPES[plankName];
            }
            return {
                resultName: plankName,
                resultCount: 4,
                ingredients: [logItem.name],
                requiresTable: false
            };
        }
    }

    return null;
}