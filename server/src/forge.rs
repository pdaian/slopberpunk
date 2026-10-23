// Server-owned cosmetic unlocks, outfits and collection prestige. GPL-3.0-or-later.
use super::*;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct State {
    pub appearance: Option<Appearance>,
    pub loadouts: [Option<Appearance>; 3],
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Appearance {
    frame: String,
    primary: String,
    secondary: String,
    energy: String,
    finish: String,
    pattern: String,
    parts: HashMap<String, String>,
}
#[derive(Deserialize)]
struct Choice {
    id: String,
}
#[derive(Deserialize)]
struct Frame {
    id: String,
    width: f64,
}
#[derive(Deserialize)]
struct Swatch {
    id: String,
    hex: String,
}
#[derive(Deserialize)]
struct Rarity {
    id: String,
    color: String,
    score: u32,
}
#[derive(Deserialize)]
struct Unlock {
    stat: String,
    target: u64,
    label: String,
}
#[derive(Deserialize)]
struct Item {
    id: String,
    slot: String,
    design: String,
    rarity: String,
    unlock: Option<Unlock>,
}
#[derive(Deserialize)]
pub(super) struct Catalog {
    version: u32,
    slots: Vec<Choice>,
    frames: Vec<Frame>,
    colors: Vec<Swatch>,
    finishes: Vec<Choice>,
    patterns: Vec<Choice>,
    rarities: Vec<Rarity>,
    default: Appearance,
    items: Vec<Item>,
}
const SLOTS: [&str; 6] = ["head", "shoulders", "core", "arms", "legs", "back"];
const STATS: [&str; 6] = [
    "level",
    "contracts",
    "kills",
    "orders",
    "expeditions",
    "routes",
];

fn progress(c: &Character, stat: &str) -> u64 {
    match stat {
        "level" => u64::from(c.level),
        "contracts" => c.completed.iter().collect::<HashSet<_>>().len() as u64,
        "kills" => c
            .mob_kills
            .values()
            .fold(0_u64, |n, k| n.saturating_add(u64::from(*k))),
        "orders" => u64::from(c.orders_completed),
        "expeditions" => c
            .dungeon_history
            .values()
            .fold(0_u64, |n, h| n.saturating_add(h.clears)),
        "routes" => c.dungeon_history.values().filter(|h| h.clears > 0).count() as u64,
        _ => 0,
    }
}
fn unlocked(item: &Item, c: &Character) -> bool {
    item.unlock
        .as_ref()
        .is_none_or(|u| progress(c, &u.stat) >= u.target)
}
impl Catalog {
    pub fn validate(&self) -> io::Result<()> {
        let unique = |ids: Vec<&str>| {
            !ids.is_empty()
                && ids.iter().all(|id| !id.is_empty() && id.len() <= 32)
                && ids.iter().copied().collect::<HashSet<_>>().len() == ids.len()
        };
        let hex = |s: &str| {
            s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
        };
        let valid = self.version == 1
            && self.slots.len() == SLOTS.len()
            && self.slots.iter().all(|s| SLOTS.contains(&s.id.as_str()))
            && unique(self.slots.iter().map(|s| s.id.as_str()).collect())
            && unique(self.frames.iter().map(|s| s.id.as_str()).collect())
            && self.frames.iter().all(|f| (0.8..=1.25).contains(&f.width))
            && unique(self.colors.iter().map(|s| s.id.as_str()).collect())
            && self.colors.iter().all(|c| hex(&c.hex))
            && unique(self.finishes.iter().map(|s| s.id.as_str()).collect())
            && unique(self.patterns.iter().map(|s| s.id.as_str()).collect())
            && unique(self.rarities.iter().map(|s| s.id.as_str()).collect())
            && self
                .rarities
                .iter()
                .all(|r| hex(&r.color) && r.score <= 1000)
            && unique(self.items.iter().map(|s| s.id.as_str()).collect())
            && unique(self.items.iter().map(|s| s.design.as_str()).collect())
            && self.items.len() <= 120
            && self.items.iter().all(|i| {
                SLOTS.contains(&i.slot.as_str())
                    && self.rarities.iter().any(|r| r.id == i.rarity)
                    && (i.rarity == "standard") == i.unlock.is_none()
                    && i.unlock.as_ref().is_none_or(|u| {
                        STATS.contains(&u.stat.as_str()) && u.target > 0 && !u.label.is_empty()
                    })
            });
        if !valid || self.check(&self.default, None).is_err() {
            return Err(io::Error::other("Invalid Frame Forge catalog"));
        }
        Ok(())
    }
    pub fn check(&self, a: &Appearance, c: Option<&Character>) -> ResultApi<()> {
        if !self.frames.iter().any(|f| f.id == a.frame)
            || ![&a.primary, &a.secondary, &a.energy]
                .iter()
                .all(|id| self.colors.iter().any(|s| &s.id == *id))
            || !self.finishes.iter().any(|f| f.id == a.finish)
            || !self.patterns.iter().any(|p| p.id == a.pattern)
            || a.parts.len() != SLOTS.len()
        {
            return Err(bad("Choose a valid frame, paint and six fitted parts."));
        }
        for slot in SLOTS {
            let item = a
                .parts
                .get(slot)
                .and_then(|id| self.items.iter().find(|i| &i.id == id && i.slot == slot))
                .ok_or_else(|| bad("That part does not fit this slot."))?;
            if c.map_or(item.unlock.is_some(), |c| !unlocked(item, c)) {
                return Err(bad(
                    "This part is locked. Complete its milestone in the Frame Forge collection.",
                ));
            }
        }
        Ok(())
    }
    pub fn score(&self, c: &Character) -> u32 {
        self.items
            .iter()
            .filter(|i| unlocked(i, c))
            .filter_map(|i| self.rarities.iter().find(|r| r.id == i.rarity))
            .map(|r| r.score)
            .sum()
    }
}

pub(super) fn action(c: &mut Character, request: &Value, data: &Content) -> ResultApi<Value> {
    let operation = text(&request["operation"]);
    let slot = if matches!(operation, "save" | "load") {
        Some(
            request["slot"]
                .as_u64()
                .filter(|s| *s < 3)
                .ok_or_else(|| bad("Choose loadout 1, 2 or 3."))? as usize,
        )
    } else {
        None
    };
    let appearance = match operation {
        "load" => c.forge.loadouts[slot.unwrap()]
            .clone()
            .ok_or_else(|| bad("This loadout is empty."))?,
        "apply" | "save" => serde_json::from_value::<Appearance>(request["appearance"].clone())
            .map_err(|_| bad("Invalid frame configuration."))?,
        _ => return Err(bad("Unknown Frame Forge action.")),
    };
    data.forge.check(&appearance, Some(c))?;
    if operation == "save" {
        c.forge.loadouts[slot.unwrap()] = Some(appearance);
    } else {
        c.forge.appearance = Some(appearance);
    }
    Ok(json!({"forge":c.forge}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }
    fn runner(_data: &Content) -> Character {
        serde_json::from_value(json!({"version":2,"id":"runner","name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":1000,"position":[0,0,0],"yaw":0,"health":100,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap()
    }

    #[test]
    fn legacy_saves_keep_their_rig_and_new_frames_have_no_stat_bonus() {
        let data = content();
        let mut c = runner(&data);
        assert!(c.forge.appearance.is_none());
        let before = Stats::new(&c, &data);
        let a = serde_json::to_value(&data.forge.default).unwrap();
        action(&mut c, &json!({"operation":"apply","appearance":a}), &data).unwrap();
        let after = Stats::new(&c, &data);
        assert_eq!(before.health, after.health);
        assert_eq!(before.damage, after.damage);
        assert_eq!(before.speed, after.speed);
        let restored: Character =
            serde_json::from_value(serde_json::to_value(&c).unwrap()).unwrap();
        assert!(restored.forge.appearance.is_some());
    }
    #[test]
    fn locked_mismatched_and_unknown_parts_cannot_be_applied_or_saved() {
        let data = content();
        let mut c = runner(&data);
        c.level = 0;
        for (slot, id) in [
            ("head", "solar-crown"),
            ("head", "road-greaves"),
            ("core", "missing"),
        ] {
            let mut a = serde_json::to_value(&data.forge.default).unwrap();
            a["parts"][slot] = json!(id);
            for operation in ["apply", "save"] {
                assert!(
                    action(
                        &mut c,
                        &json!({"operation":operation,"slot":0,"appearance":a}),
                        &data
                    )
                    .is_err()
                );
                assert!(c.forge.appearance.is_none());
                assert!(c.forge.loadouts.iter().all(Option::is_none));
            }
        }
        for field in [
            "frame",
            "primary",
            "secondary",
            "energy",
            "finish",
            "pattern",
        ] {
            let mut a = serde_json::to_value(&data.forge.default).unwrap();
            a[field] = json!("unknown");
            assert!(action(&mut c, &json!({"operation":"apply","appearance":a}), &data).is_err());
        }
        let mut forged = serde_json::to_value(&data.forge.default).unwrap();
        forged["score"] = json!(99999);
        assert!(
            action(
                &mut c,
                &json!({"operation":"apply","appearance":forged}),
                &data
            )
            .is_err()
        );
        assert!(c.forge.appearance.is_none());
    }
    #[test]
    fn milestones_and_bounded_loadouts_survive_serialization() {
        let data = content();
        let mut c = runner(&data);
        c.level = 10;
        let mut a = serde_json::to_value(&data.forge.default).unwrap();
        a["parts"]["head"] = json!("storm-eye");
        action(
            &mut c,
            &json!({"operation":"save","slot":2,"appearance":a}),
            &data,
        )
        .unwrap();
        assert!(c.forge.appearance.is_none());
        let mut restored: Character =
            serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
        action(&mut restored, &json!({"operation":"load","slot":2}), &data).unwrap();
        assert_eq!(
            restored.forge.appearance.as_ref().unwrap().parts["head"],
            "storm-eye"
        );
        assert!(
            action(
                &mut restored,
                &json!({"operation":"save","slot":3,"appearance":a}),
                &data
            )
            .is_err()
        );
        assert!(action(&mut restored, &json!({"operation":"load","slot":-1}), &data).is_err());
        assert!(action(&mut restored, &json!({"operation":"load","slot":1}), &data).is_err());
        restored.level = 60;
        restored.orders_completed = 60;
        restored.mob_kills.insert("drone".into(), 2000);
        restored.completed = (0..60).map(|i| format!("contract-{i}")).collect();
        for i in 0..6 {
            restored.dungeon_history.insert(
                format!("route-{i}"),
                serde_json::from_value(json!({"clears":5,"ending":"test"})).unwrap(),
            );
        }
        assert_eq!(data.forge.score(&restored), 660);
    }
}
