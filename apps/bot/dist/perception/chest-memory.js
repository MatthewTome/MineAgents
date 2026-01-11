const chestMemory = new Map();
export function chestKey(position) {
    return `${Math.floor(position.x)},${Math.floor(position.y)},${Math.floor(position.z)}`;
}
export function rememberChest(position) {
    const key = chestKey(position);
    const existing = chestMemory.get(key);
    if (existing) {
        return existing;
    }
    const entry = {
        position: { ...position },
        status: "unknown"
    };
    chestMemory.set(key, entry);
    return entry;
}
export function recordChestContents(position, items) {
    const key = chestKey(position);
    chestMemory.set(key, {
        position: { ...position },
        status: "known",
        items: [...items],
        lastUpdated: Date.now()
    });
}
export function markChestInvalid(position) {
    const key = chestKey(position);
    chestMemory.set(key, {
        position: { ...position },
        status: "invalid",
        lastUpdated: Date.now()
    });
}
export function listChestMemory() {
    return [...chestMemory.values()];
}
