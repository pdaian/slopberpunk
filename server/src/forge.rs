// Server-owned collections, hunts and independent outfits/combat attunement. GPL-3.0-or-later.
use super::*;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct State {
    pub appearance: Option<Appearance>,
    pub loadouts: [Option<Appearance>; 3],
    pub attuned: HashMap<String, String>,
    pub hunts: HashMap<String, HuntProgress>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct HuntProgress {
    attempts: u32,
    found: bool,
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
    set: String,
    unlock: Option<Unlock>,
    hunt: Option<Hunt>,
    #[serde(default)]
    stats: HashMap<String, f64>,
}
#[derive(Deserialize)]
struct Hunt {
    kind: String,
    source: String,
    level: u32,
    chance: f64,
    guarantee: u32,
    label: String,
    hint: String,
}
#[derive(Deserialize)]
struct SetBonus {
    pieces: usize,
    stats: HashMap<String, f64>,
}
#[derive(Deserialize)]
struct CollectionSet {
    name: String,
    prestige: u32,
    bonuses: Vec<SetBonus>,
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
    sets: Vec<CollectionSet>,
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
    if item.hunt.is_some() {
        return c.forge.hunts.get(&item.id).is_some_and(|h| h.found);
    }
    item.unlock
        .as_ref()
        .is_none_or(|u| progress(c, &u.stat) >= u.target)
}
impl Catalog {
    pub fn validate(&self, data: &Content) -> io::Result<()> {
        let unique = |ids: Vec<&str>| {
            !ids.is_empty()
                && ids.iter().all(|id| !id.is_empty() && id.len() <= 32)
                && ids.iter().copied().collect::<HashSet<_>>().len() == ids.len()
        };
        let hex = |s: &str| {
            s.len() == 7 && s.starts_with('#') && s[1..].bytes().all(|b| b.is_ascii_hexdigit())
        };
        let stats_ok = |stats: &HashMap<String, f64>| {
            stats.iter().all(|(key, value)| {
                economy::STATS.contains(&key.as_str())
                    && value.is_finite()
                    && *value > 0.0
                    && *value <= 1000.0
            })
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
                    && (i.rarity == "standard") == (i.unlock.is_none() && i.hunt.is_none())
                    && !(i.unlock.is_some() && i.hunt.is_some())
                    && (i.rarity == "standard") == i.stats.is_empty()
                    && stats_ok(&i.stats)
                    && (i.rarity == "standard" || self.sets.iter().any(|s| s.name == i.set))
                    && i.unlock.as_ref().is_none_or(|u| {
                        STATS.contains(&u.stat.as_str()) && u.target > 0 && !u.label.is_empty()
                    })
                    && i.hunt.as_ref().is_none_or(|h| {
                        h.chance.is_finite()
                            && h.chance > 0.0
                            && h.chance <= 1.0
                            && (1..=1000).contains(&h.guarantee)
                            && !h.label.is_empty()
                            && !h.hint.is_empty()
                            && h.level <= 60
                            && match h.kind.as_str() {
                                "patrol" => data
                                    .map
                                    .enemy_spawns
                                    .iter()
                                    .any(|s| s.kind == h.source && s.level >= h.level),
                                "expedition" => data.dungeons.hunt_source(&h.source, h.level),
                                _ => false,
                            }
                    })
            })
            && self
                .sets
                .iter()
                .map(|s| &s.name)
                .collect::<HashSet<_>>()
                .len()
                == self.sets.len()
            && self.sets.iter().all(|set| {
                let items: Vec<_> = self.items.iter().filter(|i| i.set == set.name).collect();
                !items.is_empty()
                    && items.iter().map(|i| &i.slot).collect::<HashSet<_>>().len() == items.len()
                    && (1..=1000).contains(&set.prestige)
                    && !set.bonuses.is_empty()
                    && set.bonuses.iter().enumerate().all(|(n, b)| {
                        b.pieces >= 2
                            && b.pieces <= items.len()
                            && (n == 0 || b.pieces > set.bonuses[n - 1].pieces)
                            && !b.stats.is_empty()
                            && stats_ok(&b.stats)
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
            if c.map_or(item.unlock.is_some() || item.hunt.is_some(), |c| {
                !unlocked(item, c)
            }) {
                return Err(bad(
                    "This part is locked. Earn its milestone or hunt reward in the Frame Forge collection.",
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
            .sum::<u32>()
            + self
                .completed_sets(c)
                .iter()
                .map(|s| s.prestige)
                .sum::<u32>()
    }
    fn completed_sets(&self, c: &Character) -> Vec<&CollectionSet> {
        self.sets
            .iter()
            .filter(|s| {
                self.items
                    .iter()
                    .filter(|i| i.set == s.name)
                    .all(|i| unlocked(i, c))
            })
            .collect()
    }
    pub fn public(&self, c: &Character) -> Value {
        json!({"appearance":c.forge.appearance,"attuned":c.forge.attuned,"score":self.score(c),"owned":self.items.iter().filter(|i| unlocked(i,c)).count(),"sets":self.completed_sets(c).len()})
    }
    pub fn apply_stats(&self, c: &Character, stats: &mut Stats) {
        if c.forge.attuned.is_empty() {
            return;
        }
        let fitted: Vec<_> = self
            .items
            .iter()
            .filter(|i| c.forge.attuned.get(&i.slot) == Some(&i.id) && unlocked(i, c))
            .collect();
        for item in &fitted {
            for (stat, value) in &item.stats {
                stats.add(stat, *value);
            }
        }
        for set in &self.sets {
            let count = fitted.iter().filter(|i| i.set == set.name).count();
            for bonus in set.bonuses.iter().filter(|b| count >= b.pieces) {
                for (stat, value) in &bonus.stats {
                    stats.add(stat, *value);
                }
            }
        }
    }
    // Only called after a credited patrol kill or a consumed expedition completion.
    // Found parts never roll again; pack limits and trade cannot erase an unlock.
    pub fn record_hunt(
        &self,
        c: &mut Character,
        kind: &str,
        source: &str,
        level: u32,
        mut roll: impl FnMut() -> f64,
    ) {
        for item in &self.items {
            let Some(hunt) = item
                .hunt
                .as_ref()
                .filter(|h| h.kind == kind && h.source == source && level >= h.level)
            else {
                continue;
            };
            let progress = c.forge.hunts.entry(item.id.clone()).or_default();
            if progress.found {
                continue;
            }
            progress.attempts = progress.attempts.saturating_add(1).min(hunt.guarantee);
            progress.found = progress.attempts >= hunt.guarantee || roll() < hunt.chance;
        }
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
        "apply" | "save" | "attune" => {
            serde_json::from_value::<Appearance>(request["appearance"].clone())
                .map_err(|_| bad("Invalid frame configuration."))?
        }
        _ => return Err(bad("Unknown Frame Forge action.")),
    };
    data.forge.check(&appearance, Some(c))?;
    if operation == "attune" {
        if c.health <= 0.0 {
            return Err(bad("Return to life before attuning frame parts."));
        }
        c.forge.attuned = appearance.parts;
        let stats = Stats::new(c, data);
        c.health = c.health.min(stats.health);
        c.energy = c.energy.min(stats.energy);
    } else if operation == "save" {
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
            for operation in ["apply", "save", "attune"] {
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
        assert_eq!(data.forge.score(&restored), 870);
    }

    #[test]
    fn hunts_filter_sources_and_guarantee_a_permanent_find_at_the_exact_boundary() {
        let data = content();
        for item in data.forge.items.iter().filter(|i| i.hunt.is_some()) {
            let hunt = item.hunt.as_ref().unwrap();
            let mut c = runner(&data);
            data.forge
                .record_hunt(&mut c, "invalid", &hunt.source, hunt.level, || 0.0);
            data.forge
                .record_hunt(&mut c, &hunt.kind, "missing", hunt.level, || 0.0);
            if hunt.level > 0 {
                data.forge
                    .record_hunt(&mut c, &hunt.kind, &hunt.source, hunt.level - 1, || 0.0);
            }
            assert!(c.forge.hunts.is_empty());
            // Full packs and wallets do not consume or sell collection rewards.
            c.items = (0..160).map(|i| (format!("stack-{i}"), 999)).collect();
            c.gold = economy::MAX_GOLD;
            for n in 1..hunt.guarantee {
                data.forge
                    .record_hunt(&mut c, &hunt.kind, &hunt.source, hunt.level, || hunt.chance);
                assert_eq!(c.forge.hunts[&item.id].attempts, n);
                assert!(!c.forge.hunts[&item.id].found);
                assert!(!unlocked(item, &c));
            }
            let mut restored: Character =
                serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
            data.forge
                .record_hunt(&mut restored, &hunt.kind, &hunt.source, hunt.level, || {
                    panic!("guarantees do not need a roll")
                });
            assert_eq!(restored.forge.hunts[&item.id].attempts, hunt.guarantee);
            assert!(unlocked(item, &restored));
            let before = serde_json::to_value(&restored).unwrap();
            data.forge
                .record_hunt(&mut restored, &hunt.kind, &hunt.source, hunt.level, || {
                    panic!("owned finds never roll twice")
                });
            assert_eq!(serde_json::to_value(&restored).unwrap(), before);
            assert_eq!(restored.items.len(), 160);
            assert_eq!(restored.gold, economy::MAX_GOLD);
        }
    }

    #[test]
    fn lucky_first_finds_work_and_attempt_counters_cannot_authorize_locked_parts() {
        let data = content();
        let mut c = runner(&data);
        c.forge.hunts.insert(
            "ghost-prism".into(),
            HuntProgress {
                attempts: 20,
                found: false,
            },
        );
        let mut a = data.forge.default.clone();
        a.parts.insert("head".into(), "ghost-prism".into());
        assert!(data.forge.check(&a, Some(&c)).is_err());
        c.forge.hunts.clear();
        data.forge.record_hunt(&mut c, "patrol", "drone", 0, || 0.0);
        assert_eq!(c.forge.hunts["ghost-prism"].attempts, 1);
        assert!(data.forge.check(&a, Some(&c)).is_ok());
        assert!(
            data.forge.check(&a, None).is_err(),
            "creation cannot claim a hunt part"
        );
    }

    fn collector(data: &Content) -> Character {
        let mut c = runner(data);
        c.level = 60;
        c.orders_completed = 60;
        c.mob_kills.insert("drone".into(), 2000);
        c.completed = (0..60).map(|i| format!("q-{i}")).collect();
        for i in 0..6 {
            c.dungeon_history.insert(
                format!("d-{i}"),
                serde_json::from_value(json!({"clears":5,"ending":"test"})).unwrap(),
            );
        }
        for item in data.forge.items.iter().filter(|i| i.hunt.is_some()) {
            c.forge.hunts.insert(
                item.id.clone(),
                HuntProgress {
                    attempts: 1,
                    found: true,
                },
            );
        }
        c
    }

    #[test]
    fn signature_and_partial_set_stat_fixtures_match_client_and_preserve_appearance() {
        let data = content();
        let mut c = collector(&data);
        let mut a = data.forge.default.clone();
        for item in data.forge.items.iter().filter(|i| i.hunt.is_some()) {
            a.parts.insert(item.slot.clone(), item.id.clone());
        }
        action(&mut c, &json!({"operation":"attune","appearance":a}), &data).unwrap();
        assert!(c.forge.appearance.is_none());
        assert_eq!(c.health, 100.0);
        assert_eq!(c.energy, 100.0);
        let mut bonus = Stats::default();
        data.forge.apply_stats(&c, &mut bonus);
        for (actual, expected) in [
            (bonus.crit, 2.0),
            (bonus.speed, 0.005),
            (bonus.health, 22.0),
            (bonus.armor, 0.015),
            (bonus.energy, 6.0),
            (bonus.haste, 0.02),
            (bonus.shield, 9.0),
            (bonus.damage, 0.02),
            (bonus.efficiency, 0.015),
            (bonus.penetration, 0.015),
            (bonus.leech, 0.015),
        ] {
            assert!((actual - expected).abs() < 1e-10);
        }
        let before = c.forge.attuned.clone();
        action(
            &mut c,
            &json!({"operation":"apply","appearance":data.forge.default}),
            &data,
        )
        .unwrap();
        assert_eq!(c.forge.attuned, before);
        c.forge.attuned = HashMap::from([
            ("head".into(), "storm-eye".into()),
            ("shoulders".into(), "storm-turbines".into()),
        ]);
        let mut partial = Stats::default();
        data.forge.apply_stats(&c, &mut partial);
        assert_eq!(partial.crit, 2.0);
        assert_eq!(partial.damage, 0.01);
        assert_eq!(partial.speed, 0.0);
        c.forge
            .attuned
            .insert("legs".into(), "storm-striders".into());
        c.forge.attuned.insert("arms".into(), "storm-coils".into());
        let mut four = Stats::default();
        data.forge.apply_stats(&c, &mut four);
        assert_eq!(four.crit, 2.0);
        assert_eq!(four.speed, 0.025);
        assert_eq!(four.haste, 0.005);
    }

    #[test]
    fn locked_cross_slot_and_duplicate_attunements_give_no_extra_stats() {
        let data = content();
        let mut c = runner(&data);
        c.forge.attuned = HashMap::from([
            ("head".into(), "ghost-prism".into()),
            ("legs".into(), "ghost-prism".into()),
            ("extra".into(), "ghost-prism".into()),
        ]);
        let mut locked = Stats::default();
        data.forge.apply_stats(&c, &mut locked);
        assert_eq!(locked.crit, 0.0);
        assert_eq!(locked.speed, 0.0);
        data.forge.record_hunt(&mut c, "patrol", "drone", 0, || 0.0);
        let mut earned = Stats::default();
        data.forge.apply_stats(&c, &mut earned);
        assert_eq!(earned.crit, 2.0);
        assert_eq!(earned.speed, 0.005);
        assert_eq!(earned.haste, 0.0);
    }

    #[test]
    fn changing_attunement_clamps_vitals_without_refills_and_rejects_dead_characters() {
        let data = content();
        let mut c = collector(&data);
        let mut a = data.forge.default.clone();
        for item in data.forge.items.iter().filter(|i| i.hunt.is_some()) {
            a.parts.insert(item.slot.clone(), item.id.clone());
        }
        action(&mut c, &json!({"operation":"attune","appearance":a}), &data).unwrap();
        let full = Stats::new(&c, &data);
        c.health = full.health;
        c.energy = full.energy;
        action(
            &mut c,
            &json!({"operation":"attune","appearance":data.forge.default}),
            &data,
        )
        .unwrap();
        let base = Stats::new(&c, &data);
        assert_eq!(c.health, base.health);
        assert_eq!(c.energy, base.energy);
        action(&mut c, &json!({"operation":"attune","appearance":a}), &data).unwrap();
        assert_eq!(c.health, base.health);
        assert_eq!(c.energy, base.energy);
        c.health = 0.0;
        let before = serde_json::to_value(&c.forge).unwrap();
        assert!(
            action(
                &mut c,
                &json!({"operation":"attune","appearance":data.forge.default}),
                &data
            )
            .is_err()
        );
        assert_eq!(serde_json::to_value(&c.forge).unwrap(), before);
    }

    #[test]
    fn prestige_counts_unique_parts_and_completed_collections_and_keeps_hunts_private() {
        let data = content();
        let mut c = collector(&data);
        assert_eq!(data.forge.score(&c), 1230);
        let public = data.forge.public(&c);
        assert_eq!(public["score"], 1230);
        assert_eq!(public["owned"], 36);
        assert_eq!(public["sets"], 5);
        assert!(public.get("hunts").is_none());
        assert!(public.get("loadouts").is_none());
        c.forge.hunts.insert(
            "unknown".into(),
            HuntProgress {
                attempts: 1,
                found: true,
            },
        );
        assert_eq!(data.forge.score(&c), 1230);
        c.forge.hunts.get_mut("ghost-orbit").unwrap().found = false;
        assert_eq!(data.forge.score(&c), 1100);
    }
}
