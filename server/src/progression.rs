// Long-form leveling, tree prerequisites, and one-time save migration. GPL-3.0-or-later.
use super::*;

pub(super) const VERSION: u32 = 1;
pub(super) const XP_MULTIPLIER: u64 = 1100;

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct WorkOrder {
    id: String,
    progress: u32,
}
pub(super) fn order_progress(c: &mut Character, e: &Enemy, data: &Content) {
    if e.health > 0.0 || e.instance.is_some() || e.event.is_some() {
        return;
    }
    if let Some(active) = &mut c.work_order {
        if let Some(o) = data.economy.orders.iter().find(|o| o.id == active.id) {
            if o.target == e.kind && o.tier == data.economy.tier(e.level) {
                active.progress = (active.progress + 1).min(o.count);
            }
        }
    }
}
pub(super) fn order_action(p: &mut Player, data: &Content, request: &Value) {
    if p.instance.is_some()
        || !data.npcs.iter().any(|n| {
            n.id == "merchant" && dist(p.c.position, n.position) < data.r("interactionRadius")
        })
    {
        notice(p, "Visit Patch to manage work orders.");
        return;
    }
    let Some(o) = data
        .economy
        .orders
        .iter()
        .find(|o| o.id == text(&request["id"]))
    else {
        return;
    };
    match text(&request["operation"]) {
        "accept" if p.c.work_order.is_none() && p.c.level >= o.level => {
            p.c.work_order = Some(WorkOrder {
                id: o.id.clone(),
                progress: 0,
            });
            notice(p, &format!("Work order accepted: {}", o.name));
        }
        "abandon" if p.c.work_order.as_ref().is_some_and(|a| a.id == o.id) => {
            p.c.work_order = None;
        }
        "claim"
            if p.c
                .work_order
                .as_ref()
                .is_some_and(|a| a.id == o.id && a.progress >= o.count) =>
        {
            p.c.work_order = None;
            p.c.orders_completed = p.c.orders_completed.saturating_add(1);
            let gold = economy::grant_gold(&mut p.c, o.gold);
            let xp = gain_xp(p, data, o.xp);
            emit(p, json!({"type":"reward","gold":gold,"xp":xp}));
            notice(p, "Job complete. Visit Patch to take another job.");
        }
        _ => {
            notice(
                p,
                "Check the job’s required level and progress. You can take only one job at a time.",
            );
            return;
        }
    }
    p.dirty = true;
}

pub(super) fn xp_cost(level: u32, data: &Content) -> u64 {
    ((data.rule("xp", "base") + f64::from(level) * data.rule("xp", "perLevel"))
        * data.rule("xp", "multiplier"))
    .round() as u64
}
pub(super) fn migrate(c: &mut Character) -> io::Result<()> {
    if c.progression_version > VERSION {
        return Err(io::Error::other(
            "Unsupported character progression version",
        ));
    }
    if c.progression_version == 0 {
        // Preserve level and fractional progress. Old flat talents are refunded into the new budget.
        c.xp = c.xp.saturating_mul(XP_MULTIPLIER);
        c.talents.clear();
        c.progression_version = VERSION;
    }
    Ok(())
}
pub(super) fn budget(c: &Character, data: &Content) -> u32 {
    let per = data.rule("talents", "pointsPerLevel") as u32;
    data.rule("talents", "startingPoints") as u32
        + c.level * per
        + if c.level < data.r("levelCap") as u32 {
            ((c.xp.saturating_mul(u64::from(per)) / xp_cost(c.level, data)) as u32).min(per - 1)
        } else {
            0
        }
}
pub(super) fn can_learn(c: &Character, data: &Content, t: &Talent) -> bool {
    let rank = c.talents.get(&t.id).copied().unwrap_or(0);
    c.health > 0.0
        && c.level >= t.level
        && rank < t.max_rank
        && c.talents.values().sum::<u32>() < budget(c, data)
        && t.requires
            .iter()
            .all(|r| c.talents.get(&r.id).copied().unwrap_or(0) >= r.rank)
        && data
            .talents
            .iter()
            .filter(|n| n.branch == t.branch)
            .map(|n| c.talents.get(&n.id).copied().unwrap_or(0))
            .sum::<u32>()
            >= t.branch_points
        && (t.exclusive.is_empty()
            || !data.talents.iter().any(|n| {
                n.id != t.id
                    && n.exclusive == t.exclusive
                    && c.talents.get(&n.id).copied().unwrap_or(0) > 0
            }))
}
pub(super) fn respec_cost(c: &Character, data: &Content) -> u64 {
    data.rule("talents", "respecBaseGold") as u64
        + u64::from(c.level) * data.rule("talents", "respecGoldPerLevel") as u64
}
pub(super) fn validate(data: &Content) -> io::Result<()> {
    let fail = || io::Error::other("Invalid progression content");
    if data.rule("xp", "multiplier") != XP_MULTIPLIER as f64
        || data.rule("xp", "base") <= 0.0
        || data.rule("xp", "perLevel") < 0.0
        || data.rule("talents", "startingPoints") != 6.0
        || data.rule("talents", "pointsPerLevel") != 4.0
        || data.rule("inventory", "packSlots") != 160.0
        || data
            .talents
            .iter()
            .map(|t| &t.id)
            .collect::<HashSet<_>>()
            .len()
            != data.talents.len()
    {
        return Err(fail());
    }
    for t in &data.talents {
        if t.id.is_empty()
            || t.id.len() > 64
            || !t
                .id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            || t.row > 4
            || t.column > 2
            || t.level > data.r("levelCap") as u32
            || !(1..=5).contains(&t.max_rank)
            || !t.amount.is_finite()
            || t.amount <= 0.0
            || !economy::STATS.contains(&t.stat.as_str())
            || (t.row > 0 && t.requires.is_empty())
            || t.requires.iter().any(|r| {
                data.talents.iter().find(|n| n.id == r.id).is_none_or(|n| {
                    n.branch != t.branch
                        || n.row >= t.row
                        || n.level > t.level
                        || r.rank == 0
                        || r.rank > n.max_rank
                })
            })
        {
            return Err(fail());
        }
    }
    if data
        .abilities
        .iter()
        .map(|a| &a.id)
        .collect::<HashSet<_>>()
        .len()
        != data.abilities.len()
    {
        return Err(fail());
    }
    for a in &data.abilities {
        if a.level > data.r("levelCap") as u32
            || !["damage", "stun", "heal", "shield", "area", "ghostline"].contains(&a.kind.as_str())
            || !["", "expose", "siphon", "execute"].contains(&a.effect.as_str())
            || [a.cost, a.power, a.range]
                .iter()
                .any(|n| !n.is_finite() || *n < 0.0)
            || !a.cooldown.is_finite()
            || a.cooldown <= 0.0
        {
            return Err(fail());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }
    fn runner() -> Character {
        serde_json::from_value(json!({"id":"runner","name":"Runner","race":"human","faction":"relay","level":10,"xp":100,"credits":1200,"position":[0,0,0],"yaw":0,"health":100,"energy":50,"medkits":3,"weaponRank":0,"talents":{"barrier":2},"activeQuests":{},"completed":[],"introSeen":true})).unwrap()
    }
    #[test]
    fn legacy_wallet_and_progress_are_migrated_once() {
        let mut c = runner();
        migrate(&mut c).unwrap();
        assert_eq!((c.level, c.xp, c.gold, c.medkits), (10, 110_000, 1200, 3));
        assert!(c.talents.is_empty());
        migrate(&mut c).unwrap();
        assert_eq!(c.xp, 110_000);
        let saved = serde_json::to_value(&c).unwrap();
        assert_eq!(saved["gold"], 1200);
        assert!(saved.get("credits").is_none());
    }
    #[test]
    fn costs_and_quarter_level_points_follow_the_long_curve() {
        let data = content();
        let mut c = runner();
        c.level = 0;
        c.xp = 0;
        c.talents.clear();
        assert_eq!(xp_cost(0, &data), 88_000);
        assert_eq!(xp_cost(59, &data), 2_359_500);
        assert_eq!(budget(&c, &data), 6);
        c.xp = 21_999;
        assert_eq!(budget(&c, &data), 6);
        c.xp = 22_000;
        assert_eq!(budget(&c, &data), 7);
        c.level = 1;
        c.xp = 0;
        assert_eq!(budget(&c, &data), 10);
        c.level = 60;
        assert_eq!(budget(&c, &data), 246);
    }
    #[test]
    fn tree_dependencies_and_exclusive_capstones_are_authoritative() {
        let data = content();
        let mut c = runner();
        c.level = 60;
        c.talents.clear();
        let barrier = data.talents.iter().find(|t| t.id == "barrier").unwrap();
        assert!(!can_learn(&c, &data, barrier));
        c.talents.insert("plating".into(), 1);
        assert!(can_learn(&c, &data, barrier));
        for t in data
            .talents
            .iter()
            .filter(|t| t.branch == "Anchor" && t.row < 4)
        {
            c.talents.insert(t.id.clone(), t.max_rank);
        }
        let caps: Vec<_> = data
            .talents
            .iter()
            .filter(|t| t.branch == "Anchor" && t.row == 4)
            .collect();
        assert!(can_learn(&c, &data, caps[0]));
        c.talents.insert(caps[0].id.clone(), 1);
        assert!(!can_learn(&c, &data, caps[1]));
    }
}
