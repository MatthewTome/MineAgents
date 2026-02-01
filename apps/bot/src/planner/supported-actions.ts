export const SUPPORTED_ACTIONS: Record<string, string> =
{
    chat: "Send a chat message. params: { message }",
    perceive: "Check inventory or surroundings. params: { check: string }",
    craft: "Craft an item. params: { recipe: string, count?: number, craftingTable?: {x,y,z} }",
    move: "Move. params: { position:{x,y,z} } or { entityName?: string, range?: number }",
    mine: "Break block. params: { block?:string, position:{x,y,z} }",
    gather: "Collect items by mining, looting chests, or picking drops. params: { item?:string }",
    build: "Place structure. params: { structure: 'platform'|'wall'|'walls'|'tower'|'roof'|'door', origin?:{x,y,z}, material?:string, width?:number, height?:number, length?:number, door?:boolean }",
    loot: "Open a nearby chest and inspect/withdraw contents. params: { position?:{x,y,z}, maxDistance?: number, item?: string, count?: number }",
    eat: "Eat a food item from inventory. params: { item?: string }",
    smith: "Use an anvil to combine or rename items. params: { item1: string, item2?: string, name?: string }",
    hunt: "Hunt mob.",
    fight: "Fight mob.",
    fish: "Fish.",
    give: "Give items to a teammate. params: { target: string, item: string, count?: number, method?: 'drop'|'chest' }",
    drop: "Drop items on ground. params: { item?: string, count?: number } - use item:'all' to drop everything",
    requestResource: "Request items from team via chat. params: { item: string, count?: number, urgent?: boolean }",
    pickup: "Pick up nearby dropped items. params: { item?: string }"
};