// Persistent graveyard recovery. Dungeon revives retain their encounter rules.
// GPL-3.0-or-later.
use super::*;

#[derive(Clone, Deserialize)]
pub(super) struct Graveyard {
    pub id: String,
    pub position: Vec3,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Recovery {
    pub corpse: Vec3,
    pub graveyard: String,
    pub released: bool,
    pub release_at: f64,
    #[serde(alias = "creditsLost")]
    pub gold_lost: u64,
}

pub(super) fn validate(data: &Content) -> io::Result<()> {
    let world = World::new(&data.map);
    let mut ids = HashSet::new();
    if data.map.graveyards.is_empty()
        || data.map.graveyards.iter().any(|g| {
            g.id.is_empty()
                || !ids.insert(&g.id)
                || !g.position.iter().all(|n| n.is_finite())
                || g.position[1] != 0.0
                || world.collides(g.position, data.rule("movement", "radius"))
                || data.map.enemy_spawns.iter().any(|e| {
                    dist(e.position, g.position)
                        <= data.rule("combat", "aggroRadius") + data.r("interactionRadius")
                })
        })
        || [
            "goldLossFraction",
            "healerLossFraction",
            "corpseHealthFraction",
            "healerHealthFraction",
            "sicknessDamageMultiplier",
            "sicknessSpeedMultiplier",
        ]
        .iter()
        .any(|key| {
            !(0.0..=1.0).contains(&data.rule("death", key)) || data.rule("death", key) == 0.0
        })
        || [
            "goldLossCap",
            "healerLossCap",
            "reclaimRadius",
            "sicknessSeconds",
            "spiritSpeedMultiplier",
        ]
        .iter()
        .any(|key| !data.rule("death", key).is_finite() || data.rule("death", key) <= 0.0)
    {
        return Err(io::Error::other("Invalid graveyard recovery content"));
    }
    Ok(())
}

pub(super) fn is_spirit(c: &Character) -> bool {
    c.health <= 0.0 && c.death.as_ref().is_some_and(|d| d.released)
}

fn cost(gold: u64, fraction: f64, cap: f64) -> u64 {
    ((gold as f64 * fraction).ceil() as u64)
        .min(cap as u64)
        .min(gold)
}

fn recovery(c: &Character, data: &Content, gold_lost: u64) -> Recovery {
    let graveyard = data
        .map
        .graveyards
        .iter()
        .min_by(|a, b| dist(c.position, a.position).total_cmp(&dist(c.position, b.position)))
        .expect("validated graveyards");
    Recovery {
        corpse: c.position,
        graveyard: graveyard.id.clone(),
        released: false,
        release_at: now_millis() as f64 / 1000.0 + data.rule("player", "respawnSeconds"),
        gold_lost,
    }
}

// Older dead saves acquire a corpse without a retroactive credit charge.
pub(super) fn restore(c: &mut Character, data: &Content) {
    if c.health <= 0.0 && c.death.is_none() {
        c.death = Some(recovery(c, data, 0));
    } else if c.health > 0.0 {
        c.death = None;
    }
}

pub(super) fn fallen(p: &mut Player, data: &Content, time: f64) {
    elevators::cancel(p);
    p.dead_at = time;
    p.velocity = [0.0; 3];
    p.input = Movement {
        yaw: p.c.yaw,
        ..Movement::default()
    };
    p.shield = 0.0;
    p.dash = 0.0;
    p.ghost_trail.clear();
    if p.instance.is_none() && p.c.death.is_none() {
        let lost = cost(
            p.c.gold,
            data.rule("death", "goldLossFraction"),
            data.rule("death", "goldLossCap"),
        );
        p.c.gold -= lost;
        p.c.death = Some(recovery(&p.c, data, lost));
    }
    p.dirty = true;
    emit(p, json!({"type":"death"}));
}

fn relocate(p: &mut Player, position: Vec3) {
    p.c.position = position;
    p.previous_position = position;
    p.velocity = [0.0; 3];
    p.input = Movement {
        yaw: p.c.yaw,
        ..Movement::default()
    };
    p.grounded = false;
    p.coyote = 0.0;
    p.jump_buffer = 0.0;
    p.dash = 0.0;
    p.ghost_trail.clear();
    p.dirty = true;
}

pub(super) fn action(
    p: &mut Player,
    data: &Content,
    world: &World,
    kind: &str,
    time: f64,
    clock: f64,
) {
    if p.instance.is_some() || p.c.health > 0.0 {
        return;
    }
    let Some(d) = p.c.death.as_ref() else {
        return;
    };
    let Some(graveyard) = data.map.graveyards.iter().find(|g| g.id == d.graveyard) else {
        return;
    };
    match kind {
        // Old clients may release their spirit, but cannot bypass corpse recovery.
        "releaseSpirit" | "respawn" if !d.released && clock >= d.release_at => {
            p.c.death.as_mut().unwrap().released = true;
            relocate(p, graveyard.position);
            notice(
                p,
                "You are now a ghost. Follow the marker to your body, or pay the graveyard healer to revive here.",
            );
        }
        "returnToGraveyard" if d.released => relocate(p, graveyard.position),
        "reclaimCorpse" if d.released => {
            if dist(p.c.position, d.corpse) > data.rule("death", "reclaimRadius")
                || !world.visible(p.c.position, d.corpse)
            {
                notice(
                    p,
                    "Get within 12 m of your body with nothing blocking your view.",
                );
                return;
            }
            // Reappear at the spirit's reachable location, allowing a safe approach.
            resurrect(p, data, time, false);
        }
        "spiritHealer" if d.released => {
            if dist(p.c.position, graveyard.position) > data.r("interactionRadius")
                || !world.visible(p.c.position, graveyard.position)
            {
                return;
            }
            let lost = cost(
                p.c.gold,
                data.rule("death", "healerLossFraction"),
                data.rule("death", "healerLossCap"),
            );
            p.c.gold -= lost;
            relocate(p, graveyard.position);
            resurrect(p, data, time, true);
        }
        _ => {}
    }
}

fn resurrect(p: &mut Player, data: &Content, time: f64, healer: bool) {
    p.c.death = None;
    if healer {
        p.c.resurrection_sickness = data.rule("death", "sicknessSeconds");
    }
    let stats = Stats::new(&p.c, data);
    let fraction = data.rule(
        "death",
        if healer {
            "healerHealthFraction"
        } else {
            "corpseHealthFraction"
        },
    );
    p.c.health = (stats.health * fraction).max(1.0);
    p.c.energy = stats.energy * fraction;
    p.shield = 0.0;
    p.last_combat = time;
    p.dead_at = 0.0;
    let position = p.c.position;
    relocate(p, position);
    notice(
        p,
        if healer {
            "You are alive at the graveyard. For 60 seconds while alive and playing, you deal half damage and move 25% slower."
        } else {
            "You are alive again with 50% health and energy."
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Content, World, Player) {
        let data =
            Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap();
        let world = World::new(&data.map);
        let c: Character = serde_json::from_value(json!({"version":2,"id":"runner","name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":100,"position":[0,0,32],"yaw":0,"health":0,"energy":0,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{"relay-00":0},"completed":[],"introSeen":true})).unwrap();
        let (output, _) = mpsc::channel(64);
        let p = Player {
            elevator: None,
            live_social: live_social::Session::default(),
            instance: None,
            owner: "account".into(),
            previous_position: c.position,
            c,
            output,
            input: Movement::default(),
            last_input: 0.0,
            velocity: [0.0; 3],
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
            last_combat: -100.0,
            dead_at: 0.0,
            last_interact: -100.0,
            last_sequence: 0,
            dirty: false,
        };
        (data, world, p)
    }

    fn release(p: &mut Player, data: &Content, world: &World) {
        let clock = p.c.death.as_ref().unwrap().release_at;
        action(p, data, world, "releaseSpirit", 10.0, clock);
        assert!(is_spirit(&p.c));
    }

    #[test]
    fn death_charges_once_and_persists_body_release_and_sickness() {
        let (data, world, mut p) = fixture();
        fallen(&mut p, &data, 0.0);
        fallen(&mut p, &data, 0.1);
        assert_eq!(p.c.gold, 95);
        assert_eq!(p.c.death.as_ref().unwrap().gold_lost, 5);
        assert_eq!(p.c.death.as_ref().unwrap().corpse, [0.0, 0.0, 32.0]);
        let deadline = p.c.death.as_ref().unwrap().release_at;
        action(&mut p, &data, &world, "respawn", 9.0, deadline - 0.1);
        assert!(!is_spirit(&p.c));
        action(&mut p, &data, &world, "respawn", 10.0, deadline);
        assert!(is_spirit(&p.c));
        assert_eq!(p.c.health, 0.0, "old respawn must not resurrect");
        p.c.resurrection_sickness = 23.0;
        let saved: StoredCharacter =
            serde_json::from_value(serde_json::to_value(saved_player(&p, 10.0)).unwrap()).unwrap();
        p.c = saved.character;
        restore(&mut p.c, &data);
        assert!(is_spirit(&p.c));
        assert_eq!(p.c.death.as_ref().unwrap().release_at, deadline);
        assert_eq!(p.c.resurrection_sickness, 23.0);
        assert_eq!(p.c.gold, 95);
    }

    #[test]
    fn spirits_move_without_regeneration_or_quest_progress() {
        let (data, world, mut p) = fixture();
        fallen(&mut p, &data, 0.0);
        release(&mut p, &data, &world);
        p.c.resurrection_sickness = 20.0;
        p.input.forward = 1.0;
        p.last_input = 10.0;
        let before = p.c.position;
        movement(&mut p, &data, &world, 10.0, 0.05);
        assert_ne!(p.c.position, before);
        assert_eq!(p.c.health, 0.0);
        assert_eq!(p.c.energy, 0.0);
        assert_eq!(p.c.resurrection_sickness, 20.0);
        progress(&mut p, &data, "interact", "market");
        assert_eq!(p.c.active_quests["relay-00"], 0);
    }

    #[test]
    fn corpse_requires_release_range_and_sight_and_restores_only_half() {
        let (data, world, mut p) = fixture();
        fallen(&mut p, &data, 0.0);
        action(&mut p, &data, &world, "reclaimCorpse", 10.0, f64::MAX);
        assert_eq!(p.c.health, 0.0);
        release(&mut p, &data, &world);
        action(&mut p, &data, &world, "reclaimCorpse", 10.0, f64::MAX);
        assert_eq!(p.c.health, 0.0);
        let building = world.cells.values().find(|b| b.solids.len() > 1).unwrap();
        p.c.position = [building.x + building.width / 2.0 + 2.0, 0.0, building.z];
        p.c.death.as_mut().unwrap().corpse =
            [building.x + building.width / 2.0 - 2.0, 0.0, building.z];
        action(&mut p, &data, &world, "reclaimCorpse", 10.0, f64::MAX);
        assert_eq!(p.c.health, 0.0, "cannot recover through a wall");
        p.c.death.as_mut().unwrap().corpse = [0.0, 0.0, 32.0];
        p.c.position = [0.0, 24.0, 32.0];
        action(&mut p, &data, &world, "reclaimCorpse", 10.0, f64::MAX);
        assert_eq!(p.c.health, 0.0, "cannot recover from another floor");
        p.c.position = [0.0, 0.0, 44.0];
        action(&mut p, &data, &world, "reclaimCorpse", 10.0, f64::MAX);
        assert_eq!(p.c.health, Stats::new(&p.c, &data).health * 0.5);
        assert_eq!(p.c.energy, Stats::new(&p.c, &data).energy * 0.5);
        assert!(p.c.death.is_none());
        assert_eq!(p.c.resurrection_sickness, 0.0);
        assert_eq!(p.c.gold, 95);
        action(&mut p, &data, &world, "spiritHealer", 10.0, f64::MAX);
        assert_eq!(p.c.gold, 95, "duplicate recovery is inert");
    }

    #[test]
    fn keeper_requires_proximity_charges_capped_fee_and_sickness_ticks_only_alive() {
        let (data, world, mut p) = fixture();
        fallen(&mut p, &data, 0.0);
        release(&mut p, &data, &world);
        let graveyard = p.c.position;
        p.c.position = [0.0, 0.0, -50.0];
        action(&mut p, &data, &world, "spiritHealer", 10.0, f64::MAX);
        assert_eq!(p.c.health, 0.0);
        assert_eq!(p.c.gold, 95);
        action(&mut p, &data, &world, "returnToGraveyard", 10.0, f64::MAX);
        assert_eq!(p.c.position, graveyard);
        action(&mut p, &data, &world, "spiritHealer", 10.0, f64::MAX);
        assert_eq!(p.c.gold, 85);
        assert_eq!(p.c.resurrection_sickness, 60.0);
        let sick = Stats::new(&p.c, &data);
        assert_eq!(p.c.health, sick.health * 0.25);
        assert_eq!(p.c.energy, sick.energy * 0.25);
        movement(&mut p, &data, &world, 10.05, 0.05);
        assert!((p.c.resurrection_sickness - 59.95).abs() < 1e-6);
        p.c.resurrection_sickness = 0.01;
        movement(&mut p, &data, &world, 10.1, 0.05);
        let recovered = Stats::new(&p.c, &data);
        assert_eq!(p.c.resurrection_sickness, 0.0);
        assert_eq!(sick.damage, recovered.damage * 0.5);
        assert_eq!(sick.speed, recovered.speed * 0.75);
        assert_eq!(cost(100_000, 0.05, 50.0), 50);
        assert_eq!(cost(100_000, 0.1, 100.0), 100);
        assert_eq!(cost(0, 0.1, 100.0), 0);
    }

    #[test]
    fn old_dead_saves_get_a_free_migration_and_dungeons_keep_their_recovery() {
        let (data, world, mut p) = fixture();
        restore(&mut p.c, &data);
        assert_eq!(p.c.gold, 100);
        assert_eq!(p.c.death.as_ref().unwrap().gold_lost, 0);
        p.c.health = 10.0;
        restore(&mut p.c, &data);
        assert!(p.c.death.is_none());
        p.c.health = 0.0;
        p.instance = Some(1);
        fallen(&mut p, &data, 5.0);
        action(&mut p, &data, &world, "releaseSpirit", 10.0, f64::MAX);
        assert!(p.c.death.is_none());
        assert_eq!(p.c.gold, 100);
        assert_eq!(p.dead_at, 5.0);
    }
}
