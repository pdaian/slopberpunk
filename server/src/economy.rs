// Shared item catalog and authoritative inventory rules. GPL-3.0-or-later.
use super::*;

// All currency values are integer thousandths of gold, including content and saves.
pub(super) const MAX_GOLD: u64 = 9_000_000_000; // 9,000,000 gold.
const MAX_STACKS: usize = 160;
const SLOTS: [&str; 8] = [
    "weapon", "armor", "implant", "helmet", "gloves", "boots", "belt", "charm",
];
pub(super) const STATS: [&str; 15] = [
    "health",
    "energy",
    "speed",
    "crit",
    "damage",
    "shield",
    "healing",
    "regen",
    "armor",
    "haste",
    "efficiency",
    "penetration",
    "leech",
    "combo",
    "goldFind",
];

#[derive(Deserialize)]
struct Part {
    id: String,
    name: String,
    stats: HashMap<String, f64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Generation {
    version: u32,
    drop_chance: f64,
    rarity_weights: Vec<u32>,
    materials: Vec<String>,
    slots: Vec<Part>,
    frames: Vec<Part>,
    prefixes: Vec<Part>,
    suffixes: Vec<Part>,
}

#[derive(Deserialize)]
pub(super) struct Tier {
    pub id: u32,
    name: String,
    pub level: u32,
}
#[derive(Deserialize)]
pub(super) struct Rarity {
    pub id: String,
    name: String,
    color: String,
}
#[derive(Deserialize)]
pub(super) struct Item {
    pub id: String,
    pub name: String,
    pub tier: u32,
    pub rarity: String,
    pub kind: String,
    #[serde(default)]
    pub slot: String,
    pub level: u32,
    pub stack: u32,
    pub value: u64,
    #[serde(default)]
    stats: HashMap<String, f64>,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    group: String,
}
#[derive(Deserialize)]
pub(super) struct Drop {
    enemy: String,
    tier: u32,
    item: String,
    chance: f64,
    min: u32,
    max: u32,
}
#[derive(Deserialize)]
pub(super) struct Recipe {
    item: String,
    quantity: u32,
    #[serde(alias = "credits")]
    gold: u64,
    ingredients: HashMap<String, u32>,
}
#[derive(Deserialize)]
pub(super) struct Class {
    branch: String,
    name: String,
    points: u32,
    stats: HashMap<String, f64>,
}
#[derive(Deserialize)]
pub(super) struct Order {
    pub id: String,
    pub name: String,
    pub tier: u32,
    pub target: String,
    pub count: u32,
    pub level: u32,
    pub xp: u64,
    pub gold: u64,
}
#[derive(Deserialize)]
pub(super) struct Catalog {
    format: String,
    version: u32,
    pub tiers: Vec<Tier>,
    pub rarities: Vec<Rarity>,
    pub items: Vec<Item>,
    drops: Vec<Drop>,
    recipes: Vec<Recipe>,
    classes: Vec<Class>,
    pub orders: Vec<Order>,
    generation: Generation,
    #[serde(skip)]
    item_index: HashMap<String, usize>,
    #[serde(skip)]
    recipe_index: HashMap<String, usize>,
    #[serde(skip)]
    pools: HashMap<(u32, usize), Vec<usize>>,
}
impl Catalog {
    pub fn item(&self, id: &str) -> Option<&Item> {
        self.item_index.get(id).map(|&n| &self.items[n])
    }
    // Expand once at startup. The same ordered components and rounding live in item-catalog.js.
    pub fn prepare(&mut self) -> io::Result<()> {
        let g = &self.generation;
        let fail = || io::Error::other("Invalid economy generation");
        if g.version != 1
            || g.slots.len() != 8
            || g.frames.len() != 6
            || g.prefixes.len() != 10
            || g.suffixes.len() != 10
            || self.tiers.len() != 5
            || self.rarities.len() != 5
            || g.materials.len() != 5
            || g.rarity_weights.len() != 5
            || g.rarity_weights.iter().any(|&w| w == 0 || w > 1000)
            || !g.drop_chance.is_finite()
            || !(0.0..=1.0).contains(&g.drop_chance)
            || g.drop_chance == 0.0
            || g.slots.iter().any(|s| !SLOTS.contains(&s.id.as_str()))
            || g.materials.iter().any(|id| {
                !self
                    .items
                    .iter()
                    .any(|i| &i.id == id && i.kind == "material")
            })
        {
            return Err(fail());
        }
        for parts in [&g.slots, &g.frames, &g.prefixes, &g.suffixes] {
            if parts.iter().map(|p| &p.id).collect::<HashSet<_>>().len() != parts.len()
                || parts.iter().any(|p| {
                    p.id.is_empty()
                        || p.id.len() > 12
                        || !p
                            .id
                            .bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                        || p.name.is_empty()
                        || p.stats.is_empty()
                        || p.stats.iter().any(|(k, v)| {
                            !STATS.contains(&k.as_str())
                                || !v.is_finite()
                                || *v <= 0.0
                                || *v > 1000.0
                        })
                })
            {
                return Err(fail());
            }
        }
        for tier in &self.tiers {
            if !(1..=5).contains(&tier.id) {
                return Err(fail());
            }
            for slot in &g.slots {
                for frame in &g.frames {
                    for (p, prefix) in g.prefixes.iter().enumerate() {
                        for (s, suffix) in g.suffixes.iter().enumerate() {
                            let grade = (p + s) % 5;
                            let scale = f64::from(tier.id) * (1.0 + grade as f64 * 0.15);
                            let mut stats = HashMap::new();
                            for part in [slot, frame, prefix, suffix] {
                                for (key, value) in &part.stats {
                                    *stats.entry(key.clone()).or_insert(0.0) += value;
                                }
                            }
                            for value in stats.values_mut() {
                                *value = (*value * scale * 10000.0).round() / 10000.0;
                            }
                            let id = format!(
                                "mod-{}-{}-{}-{}-{}",
                                tier.id, slot.id, frame.id, prefix.id, suffix.id
                            );
                            let value = u64::from(tier.id) * 20 + grade as u64 * 12;
                            self.pools
                                .entry((tier.id, grade))
                                .or_default()
                                .push(self.items.len());
                            self.items.push(Item {
                                id: id.clone(),
                                name: format!(
                                    "{} {} {} {} {}",
                                    tier.name, prefix.name, frame.name, slot.name, suffix.name
                                ),
                                tier: tier.id,
                                rarity: self.rarities[grade].id.clone(),
                                kind: "equipment".into(),
                                slot: slot.id.clone(),
                                level: tier.level,
                                stack: 99,
                                value,
                                stats,
                                duration: 0.0,
                                group: String::new(),
                            });
                            let mut ingredients = HashMap::from([(
                                g.materials[tier.id as usize - 1].clone(),
                                10 + tier.id * 4 + grade as u32 * 4,
                            )]);
                            if tier.id > 1 {
                                ingredients.insert(
                                    g.materials[tier.id as usize - 2].clone(),
                                    6 + grade as u32 * 2,
                                );
                            }
                            self.recipes.push(Recipe {
                                item: id,
                                quantity: 1,
                                gold: value * 4,
                                ingredients,
                            });
                        }
                    }
                }
            }
        }
        self.item_index = self
            .items
            .iter()
            .enumerate()
            .map(|(n, i)| (i.id.clone(), n))
            .collect();
        self.recipe_index = self
            .recipes
            .iter()
            .enumerate()
            .map(|(n, r)| (r.item.clone(), n))
            .collect();
        Ok(())
    }
    pub fn tier(&self, level: u32) -> u32 {
        self.tiers
            .iter()
            .rev()
            .find(|t| t.level <= level)
            .map_or(1, |t| t.id)
    }
    pub fn rarity(&self, id: &str) -> usize {
        self.rarities.iter().position(|r| r.id == id).unwrap_or(0)
    }
    pub fn validate(&self, data: &Content) -> io::Result<()> {
        let fail = || io::Error::other("Invalid economy catalog");
        let stats_ok = |stats: &HashMap<String, f64>| {
            stats.iter().all(|(key, v)| {
                STATS.contains(&key.as_str()) && v.is_finite() && *v > 0.0 && *v <= 1000.0
            })
        };
        if self.format != "sloperberpunk-economy"
            || self.version != 1
            || self.tiers.is_empty()
            || self.tiers[0].level != 0
            || self.tiers.iter().enumerate().any(|(n, t)| {
                t.id != n as u32 + 1 || t.name.is_empty() || t.level > data.r("levelCap") as u32
            })
            || self.tiers.windows(2).any(|t| t[0].level >= t[1].level)
            || self.rarities.is_empty()
            || self.rarities.iter().any(|r| {
                r.id.is_empty()
                    || r.name.is_empty()
                    || r.color.len() != 7
                    || !r.color.starts_with('#')
                    || !r.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
            })
            || self
                .rarities
                .iter()
                .map(|r| &r.id)
                .collect::<HashSet<_>>()
                .len()
                != self.rarities.len()
            || self.items.is_empty()
            || self.items.len() > 25_000
            || self
                .items
                .iter()
                .map(|i| &i.id)
                .collect::<HashSet<_>>()
                .len()
                != self.items.len()
        {
            return Err(fail());
        }
        for i in &self.items {
            if i.id.is_empty()
                || i.id.len() > 64
                || !i
                    .id
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                || i.name.is_empty()
                || i.stack == 0
                || i.stack > 999
                || i.value == 0
                || i.value > 1_000_000
                || !self.tiers.iter().any(|t| t.id == i.tier)
                || !self.rarities.iter().any(|r| r.id == i.rarity)
                || i.level > data.r("levelCap") as u32
                || !stats_ok(&i.stats)
                || !["material", "equipment", "consumable"].contains(&i.kind.as_str())
                || (i.kind == "equipment"
                    && (!SLOTS.contains(&i.slot.as_str())
                        || i.stats.is_empty()
                        || i.level < self.tiers[(i.tier - 1) as usize].level))
                || (i.kind != "equipment" && !i.slot.is_empty())
                || (i.kind == "material" && !i.stats.is_empty())
                || (i.kind == "consumable"
                    && i.id != "medkit"
                    && (i.group.is_empty()
                        || !i.duration.is_finite()
                        || !(1.0..=3600.0).contains(&i.duration)
                        || i.stats.is_empty()))
            {
                return Err(fail());
            }
        }
        if self.item("medkit").is_none_or(|i| {
            i.kind != "consumable" || i.stack != data.rule("inventory", "slots") as u32
        }) {
            return Err(fail());
        }
        let mut drops = HashSet::new();
        for d in &self.drops {
            if !drops.insert((&d.enemy, d.tier, &d.item))
                || !data.enemies.iter().any(|e| text(&e["id"]) == d.enemy)
                || self
                    .item(&d.item)
                    .is_none_or(|i| i.tier != d.tier || d.max > i.stack)
                || !d.chance.is_finite()
                || d.chance <= 0.0
                || d.chance > 1.0
                || d.min == 0
                || d.min > d.max
            {
                return Err(fail());
            }
        }
        let mut recipes = HashSet::new();
        for r in &self.recipes {
            if !recipes.insert(&r.item)
                || self
                    .item(&r.item)
                    .is_none_or(|i| r.quantity == 0 || r.quantity > i.stack)
                || r.gold > 1_000_000
                || r.ingredients.is_empty()
                || r.ingredients.iter().any(|(id, n)| {
                    *n == 0
                        || self
                            .item(id)
                            .is_none_or(|i| i.kind != "material" || *n > i.stack)
                })
            {
                return Err(fail());
            }
        }
        let mut classes = HashSet::new();
        let mut orders = HashSet::new();
        for o in &self.orders {
            if !orders.insert(&o.id)
                || o.name.is_empty()
                || !(1..=100).contains(&o.count)
                || !self
                    .tiers
                    .iter()
                    .any(|t| t.id == o.tier && t.level == o.level)
                || !data
                    .map
                    .enemy_spawns
                    .iter()
                    .any(|s| s.kind == o.target && self.tier(s.level) == o.tier)
                || o.xp == 0
                || o.xp > 100_000
                || o.gold == 0
                || o.gold > 100_000
            {
                return Err(fail());
            }
        }
        for class in &self.classes {
            let available: u32 = data
                .talents
                .iter()
                .filter(|t| t.branch == class.branch)
                .map(|t| t.max_rank)
                .sum();
            if !classes.insert(&class.branch)
                || class.name.is_empty()
                || class.points == 0
                || class.points > available
                || class.stats.is_empty()
                || !stats_ok(&class.stats)
            {
                return Err(fail());
            }
        }
        Ok(())
    }
}

pub(super) fn grant_gold(c: &mut Character, amount: u64) -> u64 {
    let granted = amount.min(MAX_GOLD.saturating_sub(c.gold));
    c.gold += granted;
    granted
}
pub(super) fn count(c: &Character, id: &str) -> u32 {
    if id == "medkit" {
        c.medkits
    } else {
        c.items.get(id).copied().unwrap_or(0)
    }
}
fn room(c: &Character, item: &Item) -> u32 {
    if item.id != "medkit" && !c.items.contains_key(&item.id) && c.items.len() >= MAX_STACKS {
        0
    } else {
        item.stack.saturating_sub(count(c, &item.id))
    }
}
pub(super) fn add(c: &mut Character, item: &Item, quantity: u32) -> u32 {
    let current = count(c, &item.id);
    let taken = quantity.min(room(c, item));
    if taken > 0 {
        if item.id == "medkit" {
            c.medkits += taken;
        } else {
            c.items.insert(item.id.clone(), current + taken);
        }
    }
    taken
}
pub(super) fn remove(c: &mut Character, id: &str, quantity: u32) -> ResultApi<()> {
    let current = count(c, id);
    if quantity == 0 || quantity > current {
        return Err(bad("Not enough of that item in your pack."));
    }
    if id == "medkit" {
        c.medkits -= quantity;
    } else if quantity == current {
        c.items.remove(id);
    } else {
        c.items.insert(id.into(), current - quantity);
    }
    Ok(())
}
pub(super) fn apply_stats(c: &Character, data: &Content, stats: &mut Stats) {
    let mut apply = |bonuses: &HashMap<String, f64>| {
        for (stat, value) in bonuses {
            stats.add(stat, *value);
        }
    };
    for (slot, id) in &c.equipment {
        if let Some(i) = data
            .economy
            .item(id)
            .filter(|i| i.kind == "equipment" && &i.slot == slot && c.level >= i.level)
        {
            apply(&i.stats);
        }
    }
    for class in &data.economy.classes {
        let points: u32 = data
            .talents
            .iter()
            .filter(|t| t.branch == class.branch)
            .map(|t| c.talents.get(&t.id).copied().unwrap_or(0).min(t.max_rank))
            .sum();
        if points >= class.points {
            apply(&class.stats);
        }
    }
    for (id, remaining) in &c.buffs {
        if *remaining > 0.0 {
            if let Some(i) = data
                .economy
                .item(id)
                .filter(|i| i.kind == "consumable" && i.duration > 0.0)
            {
                apply(&i.stats);
            }
        }
    }
}
pub(super) fn tick(c: &mut Character, data: &Content, dt: f64) {
    if c.health <= 0.0 || c.buffs.is_empty() {
        return;
    }
    c.buffs.retain(|_, seconds| {
        *seconds = (*seconds - dt).max(0.0);
        *seconds > 0.0
    });
    let stats = Stats::new(c, data);
    c.health = c.health.min(stats.health);
    c.energy = c.energy.min(stats.energy);
}
pub(super) fn loot(p: &mut Player, e: &Enemy, data: &Content, seed: &mut u32) {
    // Event/expedition actors never generate farmable loot or journal kill credit.
    if e.instance.is_some() || e.event.is_some() || e.health > 0.0 {
        return;
    }
    let killed = p.c.mob_kills.entry(e.kind.clone()).or_default();
    *killed = killed.saturating_add(1);
    let tier = data.economy.tier(e.level);
    for d in data
        .economy
        .drops
        .iter()
        .filter(|d| d.enemy == e.kind && d.tier == tier)
    {
        if lcg(seed) >= d.chance {
            continue;
        }
        let quantity = d.min + (lcg(seed) * f64::from(d.max - d.min + 1)).floor() as u32;
        let Some(item) = data.economy.item(&d.item) else {
            continue;
        };
        let taken = add(&mut p.c, item, quantity);
        let overflow = u64::from(quantity - taken) * item.value;
        let gold = overflow.min(MAX_GOLD.saturating_sub(p.c.gold));
        p.c.gold += gold;
        emit(
            p,
            json!({"type":"loot","item":item.id,"quantity":taken,"salvaged":quantity-taken,"gold":gold}),
        );
    }
    let g = &data.economy.generation;
    if lcg(seed) < g.drop_chance {
        let mut roll = lcg(seed) * f64::from(g.rarity_weights.iter().sum::<u32>());
        let grade = g
            .rarity_weights
            .iter()
            .position(|&w| {
                roll -= f64::from(w);
                roll < 0.0
            })
            .unwrap_or(4);
        if let Some(pool) = data.economy.pools.get(&(tier, grade)) {
            let item = &data.economy.items[pool[(lcg(seed) * pool.len() as f64) as usize]];
            let taken = add(&mut p.c, item, 1);
            let gold = if taken == 0 {
                item.value.min(MAX_GOLD.saturating_sub(p.c.gold))
            } else {
                0
            };
            p.c.gold += gold;
            emit(
                p,
                json!({"type":"loot","item":item.id,"quantity":taken,"salvaged":1-taken,"gold":gold}),
            );
        }
    }
    p.dirty = true;
}

// Invoked inside the existing durable social transaction, including idempotency receipts.
pub(super) fn action(c: &mut Character, request: &Value, data: &Content) -> ResultApi<Value> {
    if c.health <= 0.0 {
        return Err(bad(
            "Return to life before changing equipment or using supplies.",
        ));
    }
    let kind = text(&request["action"]);
    let id = text(&request["item"]);
    if matches!(kind, "craft" | "sell" | "salvage" | "respec")
        && !data.npcs.iter().any(|n| {
            n.id == "merchant" && dist(c.position, n.position) < data.r("interactionRadius")
        })
    {
        return Err(bad("Visit Patch in Afterlight Commons to craft or sell."));
    }
    if kind == "respec" {
        let price = progression::respec_cost(c, data);
        if c.talents.is_empty() || c.gold < price {
            return Err(bad(
                "You need spent talent points and enough gold to reset them.",
            ));
        }
        c.gold -= price;
        c.talents.clear();
    } else if kind == "unequip" {
        let slot = text(&request["slot"]);
        let previous = c
            .equipment
            .get(slot)
            .ok_or_else(|| bad("That equipment slot is empty."))?
            .clone();
        let item = data
            .economy
            .item(&previous)
            .ok_or_else(|| bad("Unknown equipment."))?;
        if room(c, item) == 0 {
            return Err(bad("Make room for this equipment first."));
        }
        add(c, item, 1);
        c.equipment.remove(slot);
    } else {
        let item = data.economy.item(id).ok_or_else(|| bad("Unknown item."))?;
        match kind {
            "equip" => {
                if item.kind != "equipment" || c.level < item.level {
                    return Err(bad("This item cannot be equipped at your level."));
                }
                if c.equipment.get(&item.slot).is_some_and(|old| old == id) {
                    return Err(bad("That item is already equipped."));
                }
                let previous = c
                    .equipment
                    .get(&item.slot)
                    .and_then(|id| data.economy.item(id));
                if previous.is_some_and(|i| {
                    count(c, &i.id) >= i.stack || (room(c, i) == 0 && count(c, id) != 1)
                }) {
                    return Err(bad("Make room for your previous equipment first."));
                }
                remove(c, id, 1)?;
                if let Some(old) = previous {
                    add(c, old, 1);
                }
                c.equipment.insert(item.slot.clone(), id.into());
            }
            "consume" => {
                if item.kind != "consumable" || item.duration <= 0.0 || c.level < item.level {
                    return Err(bad("Reach this item’s required level before using it."));
                }
                remove(c, id, 1)?;
                c.buffs.retain(|other, _| {
                    data.economy
                        .item(other)
                        .is_some_and(|i| i.group != item.group)
                });
                c.buffs.insert(id.into(), item.duration);
            }
            "craft" => {
                let recipe = data
                    .economy
                    .recipe_index
                    .get(id)
                    .map(|&n| &data.economy.recipes[n])
                    .ok_or_else(|| bad("This item has no recipe."))?;
                if c.level < item.level
                    || c.gold < recipe.gold
                    || recipe.ingredients.iter().any(|(id, n)| count(c, id) < *n)
                {
                    return Err(bad("Check the recipe's level, materials, and gold cost."));
                }
                if recipe.quantity > room(c, item) {
                    return Err(bad("Make room for the crafted items first."));
                }
                for (id, n) in &recipe.ingredients {
                    remove(c, id, *n)?;
                }
                c.gold -= recipe.gold;
                add(c, item, recipe.quantity);
            }
            "salvage" => {
                if item.kind != "equipment" || !id.starts_with("mod-") {
                    return Err(bad(
                        "Only modular equipment can be broken down for materials.",
                    ));
                }
                let material = data
                    .economy
                    .item(&data.economy.generation.materials[item.tier as usize - 1])
                    .ok_or_else(|| bad("Unknown salvage material."))?;
                let quantity = item.tier + data.economy.rarity(&item.rarity) as u32 + 1;
                let price = u64::from(item.tier) * 2;
                if c.gold < price || quantity > room(c, material) {
                    return Err(bad(
                        "Breaking down equipment needs gold and inventory space for the materials.",
                    ));
                }
                remove(c, id, 1)?;
                c.gold -= price;
                add(c, material, quantity);
            }
            "sell" => {
                let quantity = request["quantity"]
                    .as_u64()
                    .filter(|n| *n > 0 && *n <= u64::from(count(c, id)))
                    .ok_or_else(|| bad("Choose an available whole quantity."))?
                    as u32;
                let value = u64::from(quantity) * item.value;
                if value > MAX_GOLD.saturating_sub(c.gold) {
                    return Err(bad("Your wallet is full."));
                }
                remove(c, id, quantity)?;
                c.gold += value;
            }
            _ => return Err(bad("Unknown inventory action.")),
        }
    }
    let stats = Stats::new(c, data);
    c.health = c.health.min(stats.health);
    c.energy = c.energy.min(stats.energy);
    Ok(json!({"inventory":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }
    fn runner(data: &Content) -> Character {
        let mut c: Character = serde_json::from_value(json!({"version":2,"id":"runner","name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":1000,"position":[0,0,0],"yaw":0,"health":100,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        c.position = data
            .npcs
            .iter()
            .find(|n| n.id == "merchant")
            .unwrap()
            .position;
        c
    }
    fn player(data: &Content) -> Player {
        let (output, _) = mpsc::channel(32);
        Player {
            elevator: None,
            live_social: live_social::Session::default(),
            instance: None,
            owner: "owner".into(),
            c: runner(data),
            output,
            input: Movement::default(),
            last_input: 0.0,
            velocity: [0.0; 3],
            previous_position: [0.0; 3],
            ghost_trail: GhostTrail::default(),
            grounded: true,
            coyote: 0.0,
            jump_buffer: 0.0,
            dash: 0.0,
            dash_ready: 0.0,
            cooldowns: HashMap::new(),
            global_ready: 0.0,
            shield: 0.0,
            shield_until: 0.0,
            last_combat: 0.0,
            dead_at: 0.0,
            last_interact: 0.0,
            last_sequence: 0,
            dirty: false,
        }
    }
    fn enemy() -> Enemy {
        Enemy {
            id: "drone".into(),
            instance: None,
            event: None,
            kind: "drone".into(),
            name: "Drone".into(),
            model: "drone".into(),
            color: "#ffffff".into(),
            position: [0.0; 3],
            level: 10,
            health: 1.0,
            max_health: 1.0,
            yaw: 0.0,
            home: [0.0; 3],
            damage: 0.0,
            speed: 0.0,
            attack_at: 0.0,
            attack: None,
            last_move: None,
            stun_until: 0.0,
            exposed_until: 0.0,
            respawn_at: 0.0,
            aggro: None,
        }
    }
    #[test]
    fn generated_equipment_matches_client_fixture_and_recipe_sink() {
        let data = content();
        assert_eq!(data.economy.items.len(), 24_031);
        let item = data
            .economy
            .item("mod-5-charm-prospector-gilded-fortune")
            .unwrap();
        assert_eq!(item.name, "Afterlight Gilded Prospector relay of Fortune");
        assert_eq!(item.rarity, "epic");
        assert_eq!(item.value, 136);
        assert_eq!(
            item.stats,
            HashMap::from([
                ("regen".into(), 1.0875),
                ("goldFind".into(), 0.1088),
                ("leech".into(), 0.0145)
            ])
        );
        for pool in data.economy.pools.values() {
            assert_eq!(pool.len(), 960);
        }
        for r in &data.economy.recipes {
            let output = data.economy.item(&r.item).unwrap();
            let value = r.gold
                + r.ingredients
                    .iter()
                    .map(|(id, n)| u64::from(*n) * data.economy.item(id).unwrap().value)
                    .sum::<u64>();
            assert!(u64::from(r.quantity) * output.value < value);
        }
    }
    #[test]
    fn pack_limits_preserve_swaps_and_salvage_and_refunds_do_not_mint_value() {
        let data = content();
        let mut c = runner(&data);
        let first = "mod-1-armor-bastion-tempered-shelter";
        let second = "mod-1-armor-arc-tempered-shelter";
        c.items.insert(first.into(), 1);
        c.equipment.insert("armor".into(), second.into());
        for i in data
            .economy
            .items
            .iter()
            .filter(|i| i.kind == "equipment" && i.id != first && i.id != second)
            .take(MAX_STACKS - 1)
        {
            c.items.insert(i.id.clone(), 1);
        }
        assert_eq!(c.items.len(), MAX_STACKS);
        assert_eq!(add(&mut c, data.economy.item("ceramic").unwrap(), 3), 0);
        action(&mut c, &json!({"action":"equip","item":first}), &data).unwrap();
        assert_eq!(count(&c, second), 1);
        assert_eq!(c.items.len(), MAX_STACKS);
        assert!(action(&mut c, &json!({"action":"unequip","slot":"armor"}), &data).is_err());
        c.items.clear();
        c.items.insert(first.into(), 1);
        let before = c.gold;
        action(&mut c, &json!({"action":"salvage","item":first}), &data).unwrap();
        assert_eq!(c.gold, before - 2);
        assert_eq!(count(&c, "wire-scrap"), 2);
        assert_eq!(count(&c, first), 0);
        c.talents.insert("plating".into(), 3);
        c.health = 80.0;
        c.energy = 40.0;
        action(&mut c, &json!({"action":"respec"}), &data).unwrap();
        assert_eq!(c.gold, before - 102);
        assert!(c.talents.is_empty());
        assert_eq!((c.health, c.energy), (80.0, 40.0));
        let saved = serde_json::to_value(&c).unwrap();
        assert!(action(&mut c, &json!({"action":"respec"}), &data).is_err());
        assert_eq!(serde_json::to_value(&c).unwrap(), saved);
        c.gold = MAX_GOLD - 1;
        assert_eq!(grant_gold(&mut c, u64::MAX), 1);
        assert_eq!(c.gold, MAX_GOLD);
    }
    #[test]
    fn attack_combinations_consume_setups_and_siphon_uses_actual_damage() {
        let data = content();
        let mut p = player(&data);
        let mut e = enemy();
        e.level = 0;
        e.health = 10_000.0;
        e.max_health = 10_000.0;
        fn strike(p: &mut Player, e: &mut Enemy, data: &Content, id: &str, time: f64) -> f64 {
            let before = e.health;
            let mut seed = 1000;
            damage_enemy(
                p,
                e,
                data.abilities.iter().find(|a| a.id == id).unwrap(),
                data,
                time,
                &mut seed,
                [0.0; 3],
                1.0,
            );
            before - e.health
        }
        let normal = strike(&mut p, &mut e, &data, "arc", 1.0);
        strike(&mut p, &mut e, &data, "breach", 2.0);
        assert_eq!(e.exposed_until, 10.0);
        assert!(strike(&mut p, &mut e, &data, "arc", 3.0) > normal);
        strike(&mut p, &mut e, &data, "echo", 4.0);
        assert_eq!(e.exposed_until, 0.0);
        let plain = strike(&mut p, &mut e, &data, "lance", 5.0);
        strike(&mut p, &mut e, &data, "surge", 6.0);
        assert!(e.stun_until > 6.0);
        assert!(strike(&mut p, &mut e, &data, "lance", 7.0) > plain);
        assert_eq!(e.stun_until, 0.0);
        p.c.health = 50.0;
        let dealt = strike(&mut p, &mut e, &data, "siphon", 8.0);
        assert!((p.c.health - 50.0 - dealt * 0.4).abs() < 1e-9);
        let plain = strike(&mut p, &mut e, &data, "execute", 9.0);
        e.health = 200.0;
        e.max_health = 1000.0;
        assert!(strike(&mut p, &mut e, &data, "execute", 10.0) > plain);
        e.health = 1.0;
        e.event = Some("incident".into());
        p.c.health = 50.0;
        strike(&mut p, &mut e, &data, "siphon", 11.0);
        assert!((p.c.health - 50.4).abs() < 1e-9);
    }
    #[test]
    fn work_orders_ignore_other_tiers_and_instances_and_cannot_be_claimed_twice() {
        let data = content();
        let mut p = player(&data);
        let mut e = enemy();
        e.health = 0.0;
        let request = json!({"id":"order-1-drone","operation":"accept"});
        progression::order_action(&mut p, &data, &request);
        progression::order_progress(&mut p.c, &e, &data);
        assert_eq!(
            serde_json::to_value(&p.c).unwrap()["workOrder"]["progress"],
            0
        );
        e.level = 0;
        e.instance = Some(1);
        progression::order_progress(&mut p.c, &e, &data);
        e.instance = None;
        e.event = Some("incident".into());
        progression::order_progress(&mut p.c, &e, &data);
        assert_eq!(
            serde_json::to_value(&p.c).unwrap()["workOrder"]["progress"],
            0
        );
        e.event = None;
        for _ in 0..6 {
            progression::order_progress(&mut p.c, &e, &data);
        }
        let gold = p.c.gold;
        let xp = p.c.xp;
        let claim = json!({"id":"order-1-drone","operation":"claim"});
        progression::order_action(&mut p, &data, &claim);
        assert_eq!(
            (p.c.gold, p.c.xp, p.c.orders_completed),
            (gold + 60, xp + 84, 1)
        );
        assert!(p.c.work_order.is_none());
        progression::order_action(&mut p, &data, &claim);
        assert_eq!(p.c.gold, gold + 60);
    }
    #[test]
    fn crafting_equipping_and_selling_conserve_items_and_do_not_refill_vitals() {
        let data = content();
        let mut c = runner(&data);
        assert!(c.items.is_empty() && c.equipment.is_empty() && c.buffs.is_empty());
        c.items.insert("wire-scrap".into(), 8);
        action(
            &mut c,
            &json!({"action":"craft","item":"shelter-vest"}),
            &data,
        )
        .unwrap();
        assert_eq!(c.gold, 988);
        assert_eq!(count(&c, "wire-scrap"), 0);
        assert_eq!(count(&c, "shelter-vest"), 1);
        action(
            &mut c,
            &json!({"action":"equip","item":"shelter-vest"}),
            &data,
        )
        .unwrap();
        assert_eq!(count(&c, "shelter-vest"), 0);
        assert_eq!(Stats::new(&c, &data).health, 155.0);
        assert_eq!(c.health, 100.0);
        action(&mut c, &json!({"action":"unequip","slot":"armor"}), &data).unwrap();
        action(
            &mut c,
            &json!({"action":"sell","item":"shelter-vest","quantity":1}),
            &data,
        )
        .unwrap();
        assert_eq!(c.gold, 1000);
        assert!(c.equipment.is_empty() && c.items.is_empty());
        let restored: Character =
            serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        assert_eq!(restored.gold, c.gold);
    }
    #[test]
    fn invalid_inventory_actions_are_rejected_before_spending() {
        let data = content();
        let mut c = runner(&data);
        c.items.insert("wire-scrap".into(), 8);
        c.items.insert("afterlight-coil".into(), 1);
        for request in [
            json!({"action":"equip","item":"afterlight-coil"}),
            json!({"action":"equip","item":"wire-scrap"}),
            json!({"action":"consume","item":"medkit"}),
            json!({"action":"sell","item":"wire-scrap","quantity":-1}),
            json!({"action":"sell","item":"wire-scrap","quantity":0.5}),
            json!({"action":"sell","item":"wire-scrap","quantity":9}),
            json!({"action":"craft","item":"district-coil"}),
            json!({"action":"equip","item":"first-signal-halo"}),
        ] {
            let before = serde_json::to_value(&c).unwrap();
            assert!(action(&mut c, &request, &data).is_err());
            assert_eq!(serde_json::to_value(&c).unwrap(), before);
        }
        c.items.insert("street-coil".into(), 99);
        assert!(
            action(
                &mut c,
                &json!({"action":"craft","item":"street-coil"}),
                &data
            )
            .is_err()
        );
        c.items.remove("street-coil");
        c.position = [900.0, 0.0, 900.0];
        assert!(
            action(
                &mut c,
                &json!({"action":"craft","item":"street-coil"}),
                &data
            )
            .is_err()
        );
        c.health = 0.0;
        c.items.insert("street-coil".into(), 1);
        assert!(
            action(
                &mut c,
                &json!({"action":"equip","item":"street-coil"}),
                &data
            )
            .is_err()
        );
    }
    #[test]
    fn equipment_swap_requires_space_and_never_duplicates_the_old_item() {
        let data = content();
        let mut c = runner(&data);
        c.level = 10;
        c.equipment.insert("weapon".into(), "street-coil".into());
        c.items.insert("street-coil".into(), 99);
        c.items.insert("district-coil".into(), 1);
        assert!(
            action(
                &mut c,
                &json!({"action":"equip","item":"district-coil"}),
                &data
            )
            .is_err()
        );
        assert_eq!(count(&c, "district-coil"), 1);
        remove(&mut c, "street-coil", 1).unwrap();
        action(
            &mut c,
            &json!({"action":"equip","item":"district-coil"}),
            &data,
        )
        .unwrap();
        assert_eq!(count(&c, "street-coil"), 99);
        assert_eq!(count(&c, "district-coil"), 0);
        assert_eq!(c.equipment["weapon"], "district-coil");
        assert!(
            action(
                &mut c,
                &json!({"action":"equip","item":"district-coil"}),
                &data
            )
            .is_err()
        );
    }
    #[test]
    fn provisions_replace_pause_and_expire_and_class_buffs_match_client_totals() {
        let data = content();
        let mut c = runner(&data);
        c.level = 30;
        c.talents.insert("plating".into(), 3);
        c.talents.insert("capacitor".into(), 3);
        let stats = Stats::new(&c, &data);
        assert_eq!(stats.health, 650.0);
        assert_eq!(stats.energy, 140.0);
        assert_eq!(stats.shield, 10.0);
        assert!((stats.damage - 1.04).abs() < 1e-10);
        c.items.insert("kitchen-broth".into(), 2);
        c.items.insert("spark-tonic".into(), 1);
        action(
            &mut c,
            &json!({"action":"consume","item":"kitchen-broth"}),
            &data,
        )
        .unwrap();
        assert_eq!(Stats::new(&c, &data).healing, 8.0);
        action(
            &mut c,
            &json!({"action":"consume","item":"spark-tonic"}),
            &data,
        )
        .unwrap();
        assert_eq!(c.buffs.len(), 1);
        assert_eq!(Stats::new(&c, &data).healing, 0.0);
        c.health = 0.0;
        tick(&mut c, &data, 300.0);
        assert_eq!(c.buffs["spark-tonic"], 300.0);
        c.health = 100.0;
        c.energy = 150.0;
        tick(&mut c, &data, 300.0);
        assert!(c.buffs.is_empty());
        assert_eq!(c.energy, 140.0);
    }
    #[test]
    fn kills_roll_tiered_loot_once_and_exclude_incident_and_expedition_actors() {
        let data = content();
        let mut p = player(&data);
        let mut enemy = enemy();
        p.c.level = 10;
        let ability = data.abilities.iter().find(|a| a.id == "arc").unwrap();
        let mut seed = 1000;
        damage_enemy(
            &mut p, &mut enemy, ability, &data, 0.0, &mut seed, [0.0; 3], 100.0,
        );
        assert_eq!(p.c.mob_kills["drone"], 1);
        assert!((1..=3).contains(&count(&p.c, "ceramic")));
        assert_eq!(count(&p.c, "wire-scrap"), 0);
        let before = serde_json::to_value(&p.c).unwrap();
        damage_enemy(
            &mut p, &mut enemy, ability, &data, 0.0, &mut seed, [0.0; 3], 100.0,
        );
        assert_eq!(serde_json::to_value(&p.c).unwrap(), before);
        enemy.event = Some("incident".into());
        loot(&mut p, &enemy, &data, &mut seed);
        enemy.event = None;
        enemy.instance = Some(1);
        loot(&mut p, &enemy, &data, &mut seed);
        assert_eq!(serde_json::to_value(&p.c).unwrap(), before);
    }
}
