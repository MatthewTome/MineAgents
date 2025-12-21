import fs from "node:fs";
import path from "node:path";
export class RecipeLibrary {
    directory;
    recipes = [];
    constructor(directory) {
        this.directory = directory;
    }
    loadAll() {
        if (!fs.existsSync(this.directory)) {
            console.warn(`[knowledge] Recipe directory not found: ${this.directory}`);
            return;
        }
        const files = fs.readdirSync(this.directory).filter(f => f.endsWith(".json"));
        this.recipes = [];
        for (const file of files) {
            try {
                const raw = fs.readFileSync(path.join(this.directory, file), "utf-8");
                const recipe = JSON.parse(raw);
                if (recipe.name && recipe.steps && Array.isArray(recipe.steps)) {
                    this.recipes.push(recipe);
                }
            }
            catch (err) {
                console.error(`[knowledge] Failed to load recipe ${file}:`, err);
            }
        }
        console.log(`[knowledge] Loaded ${this.recipes.length} recipes from ${this.directory}`);
    }
    search(query, topK = 3) {
        if (this.recipes.length === 0)
            return [];
        const normalizedQuery = query.toLowerCase();
        const scored = this.recipes.map(recipe => {
            let score = 0;
            if (normalizedQuery.includes(recipe.name.toLowerCase()))
                score += 10;
            if (normalizedQuery.includes(recipe.goal.toLowerCase()))
                score += 5;
            for (const tag of recipe.tags || []) {
                if (normalizedQuery.includes(tag.toLowerCase()))
                    score += 3;
            }
            return { recipe, score };
        });
        const results = scored
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(item => item.recipe);
        return results;
    }
    formatRecipeFact(recipe, maxSteps = 5) {
        const stepChunks = [];
        for (const step of recipe.steps.slice(0, maxSteps)) {
            let detail = step.details;
            if (detail.length > 180) {
                detail = `${detail.slice(0, 177)}...`;
            }
            const checks = step.checks && step.checks.length > 0
                ? ` Checks: ${step.checks.slice(0, 2).join(", ")}`
                : "";
            stepChunks.push(`${step.title} – ${step.action}: ${detail}${checks}`);
        }
        const stepsText = stepChunks.length > 0 ? stepChunks.join(" | ") : "No steps provided";
        const tags = recipe.tags && recipe.tags.length > 0 ? ` Tags: ${recipe.tags.join(", ")}.` : "";
        return `RECIPE: ${recipe.name} — goal: ${recipe.goal}.${tags} Steps: ${stepsText}`;
    }
}
