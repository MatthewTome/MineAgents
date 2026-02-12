export const SUPPORTED_ACTIONS: Record<string, string> =
{
    analyzeInventory: "Alias for perceive. params: { check: string }",
    build: "Place structure. params: { structure: 'platform'|'wall'|'walls'|'tower'|'roof'|'door', origin?:{x,y,z}, material?:string, width?:number, height?:number, length?:number, door?:boolean }",
    chat: "Send a chat message. params: { message }",
    craft: "Craft an item. params: { recipe: string, count?: number, craftingTable?: {x,y,z} }",
    drop: "Drop items on ground. params: { item?: string, count?: number } - use item:'all' to drop everything",
    equip: "Equip an item. params: { item: string, destination?: 'hand'|'off-hand'|'head'|'torso'|'legs'|'feet' }",
    gather: "Collect items by mining, looting chests, or picking drops. params: { item?:string }",
    give: "Give items to a teammate. params: { target: string, item: string, count?: number, method?: 'drop'|'chest' }",
    loot: "Open a nearby chest and inspect/withdraw contents. params: { position?:{x,y,z}, maxDistance?: number, item?: string, count?: number }",
    mine: "Break block. params: { block?:string, position?:{x,y,z}, count?: number }",
    perceive: "Check inventory or surroundings. params: { check: string }",
    pickup: "Pick up nearby dropped items. params: { item?: string }",
    place: "Place a specific block. params: { item: string, position: {x,y,z} }", 
    requestResource: "Request items from team via chat. params: { item: string, count?: number, urgent?: boolean }",
    smelt: "Smelt items in a furnace. params: { item: string, fuel?: string, count?: number, furnace?: {x,y,z} }"
};