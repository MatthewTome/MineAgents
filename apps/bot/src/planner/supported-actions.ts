export const SUPPORTED_ACTIONS: Record<string, string> =
{
    analyzeInventory: "Alias for perceive. params: { check: string }",
    build: "Construct structure (including complete shelter macro). Bot auto-selects location/pathing/order and executes low-level steps. params: { structure: 'platform'|'wall'|'walls'|'tower'|'roof'|'door'|'shelter', material?:string, width?:number, height?:number, length?:number, door?:boolean }",
    chat: "Send a chat message. params: { message }",
    craft: "Craft an item. Bot handles table lookup and movement. params: { recipe: string, count?: number }",
    drop: "Drop items on ground. params: { item?: string, count?: number } - use item:'all' to drop everything",
    equip: "Equip an item. params: { item: string, destination?: 'hand'|'off-hand'|'head'|'torso'|'legs'|'feet' }",
    give: "Give items to a teammate. params: { target: string, item: string, count?: number, method?: 'drop'|'chest' }",
    loot: "Withdraw items from chests. Bot picks chest and moves automatically. params: { item?: string, count?: number }",
    mine: "Mine blocks/items. Bot selects target blocks/tools/movement automatically. params: { block?:string, count?: number }",
    perceive: "Check inventory or surroundings. params: { check: string }",
    pickup: "Pick up nearby dropped items. params: { item?: string }",
    place: "Place a specific block. Bot handles placement position and movement from context. params: { item: string }", 
    requestResource: "Request items from team via chat. params: { item: string, count?: number, urgent?: boolean }",
    smelt: "Smelt items in a furnace. Bot handles furnace/fuel acquisition and movement. params: { item: string, fuel?: string, count?: number }"
};