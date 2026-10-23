// Authoritative, one-time decisions and bounded personal consequences.
// GPL-3.0-or-later.
use super::*;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct State {
    pub records: HashMap<String, Record>,
    pub values: HashMap<String, i32>,
    pub factions: HashMap<String, i32>,
    pub neighborhoods: HashMap<String, i32>,
    pub bonds: HashMap<String, i32>,
    pub commitments: HashMap<String, String>,
    pub debts: HashMap<String, u32>,
    pub imprints: HashMap<String, u32>,
    pub equipped: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Record {
    pub choice: String,
    pub broken: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    tradeoff: String,
    values: HashMap<String, i32>,
    factions: HashMap<String, i32>,
    trust: i32,
    bond: i32,
    gold_percent: u64,
    pledge: String,
    gear: String,
}

#[derive(Deserialize)]
struct Gear {
    id: String,
    name: String,
    description: String,
    requires: HashMap<String, i32>,
    stats: HashMap<String, f64>,
}

#[derive(Deserialize)]
struct Choice {
    id: String,
    profile: String,
    label: String,
    #[serde(default)]
    outcome: String,
}

#[derive(Deserialize)]
struct Decision {
    route: String,
    neighborhood: String,
    contact: String,
    restitution: bool,
    question: String,
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Breach {
    trust: i32,
    bond: i32,
}

#[derive(Deserialize)]
pub(super) struct Catalog {
    format: String,
    version: u32,
    ranks: Vec<u32>,
    breach: Breach,
    restitution: String,
    pledges: HashMap<String, String>,
    factions: HashMap<String, String>,
    places: HashMap<String, String>,
    routes: HashMap<String, String>,
    profiles: HashMap<String, Profile>,
    gear: Vec<Gear>,
    decisions: HashMap<String, Decision>,
}

impl Catalog {
    pub fn validate(&self, data: &Content) -> io::Result<()> {
        let invalid = || io::Error::other("Invalid morality content in morality.json");
        let prose = |s: &str| !s.trim().is_empty();
        let identifier = |s: &str| {
            !s.is_empty()
                && s.len() <= 64
                && s.as_bytes()[0].is_ascii_lowercase()
                && s.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        };
        let axes = ["care", "autonomy", "candor"];
        if self.format != "sloperberpunk-morality"
            || self.version != 1
            || !prose(&self.restitution)
            || self.ranks.len() != 3
            || self.ranks.iter().any(|n| !(1..=203).contains(n))
            || self.ranks.windows(2).any(|w| w[0] >= w[1])
            || !(1..=10).contains(&self.breach.trust)
            || !(1..=10).contains(&self.breach.bond)
            || self.gear.is_empty()
            || self
                .gear
                .iter()
                .map(|g| &g.id)
                .collect::<HashSet<_>>()
                .len()
                != self.gear.len()
        {
            return Err(invalid());
        }
        for g in &self.gear {
            if !identifier(&g.id)
                || !prose(&g.name)
                || !prose(&g.description)
                || g.stats.is_empty()
                || g.stats.iter().any(|(k, v)| {
                    !economy::STATS.contains(&k.as_str())
                        || !v.is_finite()
                        || *v <= 0.0
                        || *v > 20.0
                })
                || g.requires
                    .iter()
                    .any(|(k, v)| !axes.contains(&k.as_str()) || !(-100..=100).contains(v))
            {
                return Err(invalid());
            }
        }
        for (id, p) in &self.profiles {
            if !identifier(id)
                || !prose(&p.tradeoff)
                || p.values
                    .iter()
                    .any(|(k, v)| !axes.contains(&k.as_str()) || !(-10..=10).contains(v))
                || p.factions
                    .iter()
                    .any(|(k, v)| !self.factions.contains_key(k) || !(-10..=10).contains(v))
                || !(-10..=10).contains(&p.trust)
                || !(-10..=10).contains(&p.bond)
                || p.gold_percent > 150
                || (!p.pledge.is_empty() && !self.pledges.contains_key(&p.pledge))
                || (!p.gear.is_empty() && !self.gear.iter().any(|g| g.id == p.gear))
            {
                return Err(invalid());
            }
        }
        if !self
            .profiles
            .get("repair")
            .is_some_and(|p| p.gold_percent == 0 && p.pledge.is_empty())
        {
            return Err(invalid());
        }
        if !self.profiles.get("abstain").is_some_and(|p| {
            p.values.is_empty()
                && p.factions.is_empty()
                && p.trust == 0
                && p.bond == 0
                && p.gear.is_empty()
                && p.pledge.is_empty()
                && p.gold_percent == 100
        }) {
            return Err(invalid());
        }
        let dungeon_choices: HashMap<_, _> = data
            .dungeons
            .choice_ids()
            .map(|(id, choices)| (format!("dungeon:{id}"), choices))
            .collect();
        if self.decisions.len() != data.quests.len() + dungeon_choices.len() {
            return Err(invalid());
        }
        for (id, d) in &self.decisions {
            let q = data.quests.iter().find(|q| q.id == *id);
            let dungeon = dungeon_choices.get(id);
            if (q.is_none() && dungeon.is_none())
                || !self.routes.contains_key(&d.route)
                || !self.places.contains_key(&d.neighborhood)
                || !data.npcs.iter().any(|n| n.id == d.contact)
                || !prose(&d.question)
                || !(2..=3).contains(&d.choices.len())
                || d.choices
                    .iter()
                    .map(|o| &o.id)
                    .collect::<HashSet<_>>()
                    .len()
                    != d.choices.len()
                || d.restitution != q.is_some()
            {
                return Err(invalid());
            }
            if let Some(q) = q {
                let value = &data.quest_values[&q.id];
                let route = ["faction", "race", "neighborhood", "biome"]
                    .iter()
                    .map(|key| text(&value[key]))
                    .find(|id| !id.is_empty())
                    .unwrap_or("");
                if q.giver != d.contact
                    || route != d.route
                    || q.reward.gold > economy::MAX_GOLD
                    || d.choices
                        .iter()
                        .map(|o| &o.profile)
                        .collect::<HashSet<_>>()
                        .len()
                        < 2
                {
                    return Err(invalid());
                }
            }
            for o in &d.choices {
                if !identifier(&o.id)
                    || o.id == "restitution"
                    || !prose(&o.label)
                    || !self.profiles.contains_key(&o.profile)
                    || o.profile == "repair"
                    || ((q.is_none() || o.id != "uphold") && !prose(&o.outcome))
                {
                    return Err(invalid());
                }
                let profile = &self.profiles[&o.profile];
                if (o.id == "defer" && o.profile != "abstain")
                    || (o.id != "defer" && (profile.gear.is_empty() || profile.pledge.is_empty()))
                {
                    return Err(invalid());
                }
            }
            if let Some(choices) = dungeon {
                if d.choices.len() != choices.len() + 1
                    || d.choices
                        .iter()
                        .any(|o| o.id != "defer" && !choices.contains(&o.id.as_str()))
                {
                    return Err(invalid());
                }
            }
        }
        if self.places.keys().any(|id| {
            !data
                .map
                .districts
                .iter()
                .chain(&data.map.biomes)
                .any(|p| &p.id == id)
        }) || data
            .factions
            .iter()
            .any(|f| !self.factions.contains_key(text(&f["id"])))
        {
            return Err(invalid());
        }
        Ok(())
    }
}

fn add(scores: &mut HashMap<String, i32>, id: &str, delta: i32) {
    let value = scores.entry(id.into()).or_default();
    *value = value.saturating_add(delta).clamp(-100, 100);
}

pub(super) struct Settlement {
    pub gold_percent: u64,
    pub outcome: String,
}

// Called only after objective/proximity checks, or when an expedition finishes.
// All rejection paths precede mutation; retries can never change a filed decision.
pub(super) fn settle(
    c: &mut Character,
    data: &Content,
    id: &str,
    choice: &str,
) -> Result<Settlement, &'static str> {
    if c.morality.records.contains_key(id) {
        return Err("This choice is already saved and cannot be changed.");
    }
    let m = &data.morality;
    let d = m.decisions.get(id).ok_or("Unknown moral decision.")?;
    let repairing = choice == "restitution";
    let (profile, outcome) = if repairing {
        if !d.restitution || c.morality.debts.get(&d.route).copied().unwrap_or(0) == 0 {
            return Err("You have no broken promises to make up for in this quest series.");
        }
        ("repair", m.restitution.clone())
    } else {
        let selected = d
            .choices
            .iter()
            .find(|o| o.id == choice)
            .ok_or("Read the outcomes and choose an ending to finish this quest.")?;
        let outcome = if selected.outcome.is_empty() {
            data.quests
                .iter()
                .find(|q| q.id == id)
                .map(|q| q.completion.clone())
                .unwrap_or_default()
        } else {
            selected.outcome.clone()
        };
        (selected.profile.as_str(), outcome)
    };
    let p = &m.profiles[profile];
    let state = &mut c.morality;
    let broken = d.restitution
        && !repairing
        && !p.pledge.is_empty()
        && state
            .commitments
            .get(&d.route)
            .is_some_and(|old| old != &p.pledge);
    for (key, delta) in &p.values {
        add(&mut state.values, key, *delta);
    }
    for (key, delta) in &p.factions {
        add(&mut state.factions, key, *delta);
    }
    add(
        &mut state.neighborhoods,
        &d.neighborhood,
        p.trust - if broken { m.breach.trust } else { 0 },
    );
    add(
        &mut state.bonds,
        &d.contact,
        p.bond - if broken { m.breach.bond } else { 0 },
    );
    if repairing {
        *state.debts.entry(d.route.clone()).or_default() -= 1;
    } else if d.restitution && !p.pledge.is_empty() {
        state.commitments.insert(d.route.clone(), p.pledge.clone());
        if broken {
            *state.debts.entry(d.route.clone()).or_default() += 1;
        }
    }
    if !p.gear.is_empty() {
        *state.imprints.entry(p.gear.clone()).or_default() += 1;
        if state.equipped.is_empty() {
            state.equipped = p.gear.clone();
        }
    }
    state.records.insert(
        id.into(),
        Record {
            choice: choice.into(),
            broken,
        },
    );
    // Losing attunement never heals or leaves vitals above a new equipment cap.
    let stats = Stats::new(c, data);
    c.health = c.health.min(stats.health);
    c.energy = c.energy.min(stats.energy);
    Ok(Settlement {
        gold_percent: p.gold_percent,
        outcome,
    })
}

pub(super) fn apply_stats(c: &Character, data: &Content, stats: &mut Stats) {
    let Some(g) = data
        .morality
        .gear
        .iter()
        .find(|g| g.id == c.morality.equipped)
    else {
        return;
    };
    if g.requires
        .iter()
        .any(|(k, n)| c.morality.values.get(k).copied().unwrap_or(0) < *n)
    {
        return;
    }
    let imprints = c.morality.imprints.get(&g.id).copied().unwrap_or(0);
    let rank = data
        .morality
        .ranks
        .iter()
        .filter(|&&n| imprints >= n)
        .count() as f64;
    for (stat, value) in &g.stats {
        stats.add(stat, value * rank);
    }
}

pub(super) fn equip(p: &mut Player, data: &Content, id: &str) {
    if p.c.health <= 0.0 || p.instance.is_some() {
        notice(
            p,
            "Return to life and leave the dungeon before changing your choice reward item.",
        );
        return;
    }
    if !id.is_empty()
        && (!data.morality.gear.iter().any(|g| g.id == id)
            || p.c.morality.imprints.get(id).copied().unwrap_or(0) < data.morality.ranks[0])
    {
        notice(
            p,
            "Earn an upgrade point for this item by making a quest or dungeon choice first.",
        );
        return;
    }
    p.c.morality.equipped = id.into();
    let stats = Stats::new(&p.c, data);
    p.c.health = p.c.health.min(stats.health);
    p.c.energy = p.c.energy.min(stats.energy);
    p.dirty = true;
}

pub(super) fn vendor_price(c: &Character, base: u64) -> u64 {
    let trust = c.morality.neighborhoods.get("market").copied().unwrap_or(0);
    let percent = if trust >= 20 {
        85
    } else if trust >= 8 {
        95
    } else if trust <= -20 {
        120
    } else if trust <= -8 {
        110
    } else {
        100
    };
    // Inventory prices are bounded content, but keep this calculation safe independently.
    ((u128::from(base) * percent).div_ceil(100)).min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }
    fn character() -> Character {
        serde_json::from_value(json!({"id":"runner","name":"Runner","race":"human","faction":"relay","level":60,"xp":0,"gold":100,"position":[0,0,32],"yaw":0,"health":100,"energy":60,"medkits":1,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap()
    }
    #[test]
    fn invalid_choices_and_retries_never_change_the_record() {
        let data = data();
        let mut c = character();
        let before = serde_json::to_value(&c).unwrap();
        for choice in ["", "forged", "restitution"] {
            assert!(settle(&mut c, &data, "relay-00", choice).is_err());
            assert_eq!(serde_json::to_value(&c).unwrap(), before);
        }
        let result = settle(&mut c, &data, "relay-00", "uphold").unwrap();
        assert_eq!(result.gold_percent, 75);
        assert_eq!(
            result.outcome,
            data.quests
                .iter()
                .find(|q| q.id == "relay-00")
                .unwrap()
                .completion
        );
        let before = serde_json::to_value(&c).unwrap();
        assert!(settle(&mut c, &data, "relay-00", "redirect").is_err());
        assert_eq!(serde_json::to_value(&c).unwrap(), before);
    }
    #[test]
    fn commitments_cost_trust_and_restitution_cannot_be_farmed() {
        let data = data();
        let mut c = character();
        settle(&mut c, &data, "neighborhood-market-00", "uphold").unwrap();
        settle(&mut c, &data, "neighborhood-market-01", "redirect").unwrap();
        assert_eq!(c.morality.neighborhoods["market"], -4);
        assert_eq!(c.morality.bonds["nella"], -3);
        assert_eq!(c.morality.debts["market"], 1);
        assert!(c.morality.records["neighborhood-market-01"].broken);
        let result = settle(&mut c, &data, "neighborhood-market-02", "restitution").unwrap();
        assert_eq!(result.gold_percent, 0);
        assert_eq!(c.morality.debts["market"], 0);
        assert_eq!(c.morality.commitments["market"], "contract");
        assert!(settle(&mut c, &data, "neighborhood-market-02", "restitution").is_err());
    }
    #[test]
    fn old_saves_default_to_neutral_and_new_records_round_trip() {
        let data = data();
        let mut c = character();
        c.completed.push("relay-00".into());
        assert!(c.morality.records.is_empty());
        assert_eq!(vendor_price(&c, 21), 21);
        settle(&mut c, &data, "relay-01", "uphold").unwrap();
        let bytes = serde_json::to_vec(&c).unwrap();
        let restored: Character = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&c).unwrap()
        );
        assert!(!restored.morality.records.contains_key("relay-00"));
    }
    #[test]
    fn equipment_attunement_and_prices_match_client_boundaries() {
        let data = data();
        let mut c = character();
        let base = Stats::new(&c, &data);
        settle(&mut c, &data, "relay-00", "uphold").unwrap();
        assert_eq!(Stats::new(&c, &data).shield, base.shield + 6.0);
        c.morality.imprints.insert("shelter".into(), 12);
        assert_eq!(Stats::new(&c, &data).healing, base.healing + 9.0);
        c.morality.values.insert("care".into(), 1);
        assert_eq!(Stats::new(&c, &data).healing, base.healing);
        for (trust, price) in [
            (-20, 26),
            (-8, 24),
            (-7, 21),
            (7, 21),
            (8, 20),
            (19, 20),
            (20, 18),
        ] {
            c.morality.neighborhoods.insert("market".into(), trust);
            assert_eq!(vendor_price(&c, 21), price);
        }
    }
    #[test]
    fn expedition_ballots_are_personal_and_never_repeat_standing_rewards() {
        let data = data();
        let mut c = character();
        settle(&mut c, &data, "dungeon:ninth-bell", "repair").unwrap();
        assert_eq!(c.morality.records["dungeon:ninth-bell"].choice, "repair");
        assert!(c.morality.commitments.is_empty());
        assert!(settle(&mut c, &data, "dungeon:ninth-bell", "name").is_err());
        let before = serde_json::to_value(&c.morality.values).unwrap();
        settle(&mut c, &data, "dungeon:borrowed-ferry", "defer").unwrap();
        assert_eq!(serde_json::to_value(&c.morality.values).unwrap(), before);
    }
    #[test]
    fn reputation_is_bounded_and_missing_content_is_rejected() {
        let mut data = data();
        let mut c = character();
        for q in &data.quests {
            settle(&mut c, &data, &q.id, "uphold").unwrap();
        }
        assert!(
            c.morality
                .values
                .values()
                .chain(c.morality.factions.values())
                .chain(c.morality.neighborhoods.values())
                .chain(c.morality.bonds.values())
                .all(|n| (-100..=100).contains(n))
        );
        data.morality.decisions.remove("relay-00");
        assert!(data.morality.validate(&data).is_err());
    }
}
