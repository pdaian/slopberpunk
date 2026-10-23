// Authoritative enemy moves, committed warnings, and collision-safe pursuit. GPL-3.0-or-later.
use super::*;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(super) enum Kind {
    Burst,
    Fan,
    Bombard,
    Combo,
    Lunge,
    Grenades,
    Cleave,
    Shockwave,
    Charge,
    Artillery,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Move {
    kind: Kind,
    name: String,
    windup: f64,
    recovery: f64,
    min_range: f64,
    range: f64,
    power: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Profile {
    preferred_range: f64,
    attacks: Vec<Move>,
}

pub(super) fn profiles(enemies: &[Value]) -> io::Result<HashMap<String, Profile>> {
    let mut profiles = HashMap::new();
    for e in enemies {
        let profile: Profile =
            serde_json::from_value(e["combat"].clone()).map_err(io::Error::other)?;
        let kinds: HashSet<_> = profile.attacks.iter().map(|a| a.kind).collect();
        if text(&e["id"]).is_empty()
            || ["health", "damage", "speed"]
                .iter()
                .any(|key| !e[*key].as_f64().is_some_and(|n| n.is_finite() && n > 0.0))
            || !(1.0..=25.0).contains(&profile.preferred_range)
            || !(3..=4).contains(&profile.attacks.len())
            || kinds.len() != profile.attacks.len()
            || profile.attacks.iter().any(|a| {
                a.name.trim().is_empty()
                    || a.name.len() > 48
                    || !(0.65..=2.0).contains(&a.windup)
                    || !(0.3..=2.0).contains(&a.recovery)
                    || !(0.0..a.range).contains(&a.min_range)
                    || !(5.0..=50.0).contains(&a.range)
                    || !(0.1..=2.0).contains(&a.power)
            })
        {
            return Err(io::Error::other("Invalid enemy combat profile"));
        }
        if profiles
            .insert(text(&e["id"]).to_owned(), profile)
            .is_some()
        {
            return Err(io::Error::other("Duplicate enemy combat profile"));
        }
    }
    Ok(profiles)
}

#[derive(Clone, Serialize)]
#[serde(tag = "shape", rename_all = "camelCase")]
enum Area {
    Circle {
        position: Vec3,
        radius: f64,
        #[serde(rename = "innerRadius")]
        inner_radius: f64,
    },
    Lane {
        position: Vec3,
        yaw: f64,
        length: f64,
        width: f64,
    },
    Cone {
        position: Vec3,
        yaw: f64,
        radius: f64,
        angle: f64,
    },
}

impl Area {
    fn position(&self) -> Vec3 {
        match self {
            Self::Circle { position, .. }
            | Self::Lane { position, .. }
            | Self::Cone { position, .. } => *position,
        }
    }

    fn contains(&self, p: Vec3) -> bool {
        let origin = self.position();
        // These strikes reach jumping runners, but never a different floor.
        if (p[1] - origin[1]).abs() > 3.0 {
            return false;
        }
        let (dx, dz) = (p[0] - origin[0], p[2] - origin[2]);
        let d = dx.hypot(dz);
        match self {
            Self::Circle {
                radius,
                inner_radius,
                ..
            } => d <= *radius && d >= *inner_radius,
            Self::Lane {
                yaw, length, width, ..
            } => {
                let along = dx * yaw.sin() + dz * yaw.cos();
                let across = dx * yaw.cos() - dz * yaw.sin();
                *length > 0.001 && along >= 0.0 && along <= *length && across.abs() <= width / 2.0
            }
            Self::Cone {
                yaw, radius, angle, ..
            } => d <= *radius && (d < 1e-9 || (dx * yaw.sin() + dz * yaw.cos()) / d >= angle.cos()),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Strike {
    #[serde(flatten)]
    area: Area,
    hits_at: f64,
    #[serde(skip)]
    power: f64,
    #[serde(skip)]
    resolved: bool,
}

#[derive(Clone)]
struct Charge {
    from: Vec3,
    to: Vec3,
    starts_at: f64,
    ends_at: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attack {
    name: String,
    started: f64,
    strikes: Vec<Strike>,
    #[serde(skip)]
    target: String,
    #[serde(skip)]
    origin: Vec3,
    #[serde(skip)]
    charge: Option<Charge>,
    #[serde(skip)]
    hit_players: HashSet<String>,
}

fn choose_move<'a>(
    profile: &'a Profile,
    distance: f64,
    last: Option<Kind>,
    seed: &mut u32,
) -> Option<&'a Move> {
    let mut candidates: Vec<_> = profile
        .attacks
        .iter()
        .filter(|a| distance >= a.min_range && distance <= a.range)
        .collect();
    if candidates.len() > 1 {
        candidates.retain(|a| Some(a.kind) != last);
    }
    if candidates.is_empty() {
        None
    } else {
        Some(candidates[(lcg(seed) * candidates.len() as f64) as usize])
    }
}

fn allowed(e: &Enemy, p: Vec3, data: &Content) -> bool {
    if e.instance.is_some() {
        let r = &data.dungeons.rules;
        (p[0] - r.arena[0]).abs() <= r.arena_radius - 0.65
            && (p[2] - r.arena[2]).abs() <= r.arena_radius - 0.65
    } else {
        !data.map.tutorial.contains(p) && dist(p, e.home) <= data.rule("combat", "leash")
    }
}

fn move_enemy(e: &mut Enemy, direction: Vec3, speed: f64, data: &Content, world: &World) {
    let length = direction[0].hypot(direction[2]);
    if length < 1e-9 {
        return;
    }
    let travel = (speed * 0.05).min(length);
    let steps = (travel / 0.3).ceil().max(1.0) as u32;
    for _ in 0..steps {
        for axis in [0, 2] {
            if let Some(next) = world.step_position(
                e.position,
                axis,
                direction[axis] / length * travel / f64::from(steps),
                true,
                0.65,
                2.1,
            ) {
                let supported = world.floor(next[0], next[2], next[1] + 0.1, next[1] - 0.2);
                if allowed(e, next, data)
                    && (supported - next[1]).abs() < 0.1
                    && (e.event.is_none() || (next[1] - e.home[1]).abs() < 0.1)
                {
                    e.position = next;
                }
            }
        }
    }
}

fn charge_end(e: &Enemy, yaw: f64, length: f64, data: &Content, world: &World) -> Vec3 {
    let mut end = e.position;
    let steps = (length / 0.25).ceil() as u32;
    for i in 1..=steps {
        let d = length * f64::from(i) / f64::from(steps);
        let next = [
            e.position[0] + yaw.sin() * d,
            e.position[1],
            e.position[2] + yaw.cos() * d,
        ];
        if !allowed(e, next, data)
            || world.collides(next, 0.65)
            || (world.floor(next[0], next[2], next[1] + 0.1, next[1] - 0.2) - next[1]).abs() > 0.1
        {
            break;
        }
        end = next;
    }
    end
}

fn prepare(e: &Enemy, p: &Player, a: &Move, data: &Content, world: &World, time: f64) -> Attack {
    let origin = e.position;
    let speed = p.velocity[0].hypot(p.velocity[2]).max(1.0);
    let lead = |seconds: f64| {
        let scale = speed.min(17.0) / speed * seconds;
        [
            p.c.position[0] + p.velocity[0] * scale,
            origin[1],
            p.c.position[2] + p.velocity[2] * scale,
        ]
    };
    let aim = lead(0.2);
    let yaw = (aim[0] - origin[0]).atan2(aim[2] - origin[2]);
    let mut attack = Attack {
        name: a.name.clone(),
        started: time,
        target: p.c.id.clone(),
        origin,
        strikes: Vec::new(),
        charge: None,
        hit_players: HashSet::new(),
    };
    let mut add = |area, delay| {
        attack.strikes.push(Strike {
            area,
            hits_at: time + a.windup + delay,
            power: a.power,
            resolved: false,
        })
    };
    match a.kind {
        Kind::Burst | Kind::Fan => {
            let count = if a.kind == Kind::Burst { 3 } else { 5 };
            for i in 0..count {
                let offset = (f64::from(i) - f64::from(count - 1) / 2.0)
                    * if a.kind == Kind::Burst { 0.045 } else { 0.22 };
                add(
                    Area::Lane {
                        position: origin,
                        yaw: yaw + offset,
                        length: a.range,
                        width: if a.kind == Kind::Burst { 1.8 } else { 1.5 },
                    },
                    if a.kind == Kind::Burst {
                        f64::from(i) * 0.28
                    } else {
                        0.0
                    },
                );
            }
        }
        Kind::Bombard | Kind::Grenades | Kind::Artillery => {
            for i in 0..3 {
                let mut position = lead(a.windup + f64::from(i) * 0.3);
                if a.kind != Kind::Bombard {
                    let offset = (f64::from(i) - 1.0) * 4.5;
                    position[0] += yaw.cos() * offset;
                    position[2] -= yaw.sin() * offset;
                }
                add(
                    Area::Circle {
                        position,
                        radius: if a.kind == Kind::Artillery { 4.2 } else { 3.2 },
                        inner_radius: 0.0,
                    },
                    f64::from(i) * 0.3,
                );
            }
        }
        Kind::Combo => {
            add(
                Area::Cone {
                    position: origin,
                    yaw: yaw - 0.35,
                    radius: 5.5,
                    angle: 1.15,
                },
                0.0,
            );
            add(
                Area::Cone {
                    position: origin,
                    yaw: yaw + 0.35,
                    radius: a.range,
                    angle: 1.15,
                },
                0.4,
            );
        }
        Kind::Cleave => add(
            Area::Cone {
                position: origin,
                yaw,
                radius: a.range,
                angle: 1.05,
            },
            0.0,
        ),
        Kind::Shockwave => {
            add(
                Area::Circle {
                    position: origin,
                    radius: 9.0,
                    inner_radius: 2.8,
                },
                0.0,
            );
            add(
                Area::Circle {
                    position: origin,
                    radius: a.range,
                    inner_radius: 9.0,
                },
                0.5,
            );
        }
        Kind::Lunge | Kind::Charge => {
            let length = dist(origin, aim).min(a.range - 1.0) + 1.0;
            let to = charge_end(e, yaw, length, data, world);
            let length = dist(origin, to);
            // Six contiguous, scheduled segments share one damage budget per runner.
            // Movement follows the same clipped path; a wall never becomes a teleport.
            for i in 0..6 {
                let d = length * f64::from(i) / 6.0;
                add(
                    Area::Lane {
                        position: [
                            origin[0] + yaw.sin() * d,
                            origin[1],
                            origin[2] + yaw.cos() * d,
                        ],
                        yaw,
                        length: length / 6.0,
                        width: if a.kind == Kind::Charge { 4.0 } else { 2.4 },
                    },
                    f64::from(i + 1) * 0.075,
                );
            }
            attack.charge = Some(Charge {
                from: origin,
                to,
                starts_at: time + a.windup,
                ends_at: time + a.windup + 0.45,
            });
        }
    }
    attack
}

fn valid_target(e: &Enemy, p: &Player, data: &Content) -> bool {
    p.c.health > 0.0
        && p.instance == e.instance
        && (e.instance.is_some() || !data.map.tutorial.contains(p.c.position))
}

fn resolve(
    e: &mut Enemy,
    attack: &mut Attack,
    players: &mut HashMap<String, Player>,
    data: &Content,
    world: &World,
    time: f64,
) {
    if let Some(charge) = &attack.charge {
        let t = ((time - charge.starts_at) / (charge.ends_at - charge.starts_at)).clamp(0.0, 1.0);
        e.position = std::array::from_fn(|axis| {
            charge.from[axis] + (charge.to[axis] - charge.from[axis]) * t
        });
    }
    let due: Vec<_> = attack
        .strikes
        .iter()
        .filter(|s| !s.resolved && time >= s.hits_at)
        .collect();
    if due.is_empty() {
        return;
    }
    for p in players.values_mut() {
        if !valid_target(e, p, data)
            || (attack.charge.is_some() && attack.hit_players.contains(&p.c.id))
        {
            continue;
        }
        // Overlapping fan rays or shells landing on the same tick never multiply a hit.
        let power = due
            .iter()
            .filter(|s| {
                s.area.contains(p.c.position)
                    && world.visible(attack.origin, p.c.position)
                    && world.visible(s.area.position(), p.c.position)
            })
            .map(|s| s.power)
            .fold(0.0_f64, f64::max);
        if power <= 0.0 {
            continue;
        }
        let stats = Stats::new(&p.c, data);
        let base = if e.instance.is_some() {
            stats.health * data.dungeons.rules.enemy_damage_fraction
        } else {
            e.damage + f64::from(e.level) * data.rule("combat", "enemyDamagePerLevel")
        };
        let damage = (base * power * (1.0 - stats.armor)).round().max(1.0);
        let absorbed = p.shield.min(damage);
        p.shield -= absorbed;
        p.c.health = (p.c.health - damage + absorbed).max(0.0);
        p.last_combat = time;
        p.dirty = true;
        if attack.charge.is_some() {
            attack.hit_players.insert(p.c.id.clone());
        }
        emit(p, json!({"type":"hurt","amount":damage-absorbed}));
        if p.c.health <= 0.0 {
            death::fallen(p, data, time);
        }
    }
    for s in &mut attack.strikes {
        if time >= s.hits_at {
            s.resolved = true;
        }
    }
}

fn reset(e: &mut Enemy, time: f64) {
    e.health = e.max_health;
    e.exposed_until = 0.0;
    e.stun_until = 0.0;
    e.position = e.home;
    e.aggro = None;
    e.attack = None;
    e.last_move = None;
    e.attack_at = time + 0.6;
}

pub(super) fn tick(
    e: &mut Enemy,
    players: &mut HashMap<String, Player>,
    data: &Content,
    world: &World,
    time: f64,
    seed: &mut u32,
) {
    if e.health <= 0.0 {
        e.attack = None;
        if e.instance.is_none() && e.event.is_none() && time >= e.respawn_at {
            reset(e, time);
        }
        return;
    }
    if dist(e.position, e.home) > data.rule("combat", "leash") {
        reset(e, time);
        return;
    }
    if e.stun_until > time {
        e.attack = None;
        e.attack_at = e.attack_at.max(e.stun_until + 0.35);
        return;
    }
    if let Some(mut attack) = e.attack.take() {
        if players
            .get(&attack.target)
            .is_some_and(|p| valid_target(e, p, data))
        {
            resolve(e, &mut attack, players, data, world, time);
            if attack.strikes.iter().any(|s| time < s.hits_at + 0.25) {
                e.attack = Some(attack);
            }
        }
        return;
    }
    let forced = e
        .aggro
        .as_ref()
        .filter(|(_, until)| *until > time)
        .map(|(id, _)| id);
    let target = players
        .values()
        .filter(|p| {
            valid_target(e, p, data)
                && (p.c.position[1] - e.position[1]).abs() < 4.0
                && (e.instance.is_some()
                    || dist(p.c.position, e.home) <= data.rule("combat", "leash"))
                && (e.instance.is_some()
                    || forced == Some(&p.c.id)
                    || dist(p.c.position, e.position) < data.rule("combat", "aggroRadius"))
                && world.visible(e.position, p.c.position)
        })
        .min_by(|a, b| {
            (forced != Some(&a.c.id))
                .cmp(&(forced != Some(&b.c.id)))
                .then_with(|| {
                    dist(a.c.position, e.position).total_cmp(&dist(b.c.position, e.position))
                })
                .then_with(|| a.c.id.cmp(&b.c.id))
        })
        .map(|p| p.c.id.clone());
    let Some(id) = target else {
        e.aggro = None;
        let direction = std::array::from_fn(|axis| e.home[axis] - e.position[axis]);
        let speed = e.speed;
        move_enemy(e, direction, speed, data, world);
        if dist(e.position, e.home) < 0.5 && (e.health < e.max_health || e.last_move.is_some()) {
            reset(e, time);
        }
        return;
    };
    let p = players.get_mut(&id).expect("selected player");
    p.last_combat = time;
    e.aggro = Some((id, time + 10.0));
    let distance = dist(p.c.position, e.position);
    e.yaw = (p.c.position[0] - e.position[0]).atan2(p.c.position[2] - e.position[2]);
    let profile = &data.enemy_profiles[&e.kind];
    if time >= e.attack_at {
        if let Some(a) = choose_move(profile, distance, e.last_move, seed) {
            let attack = prepare(e, p, a, data, world, time);
            let last_hit = attack
                .strikes
                .iter()
                .map(|s| s.hits_at)
                .fold(time, f64::max);
            e.attack_at = last_hit + a.recovery + data.rule("combat", "enemyAttackSeconds");
            e.last_move = Some(a.kind);
            e.attack = Some(attack);
            return;
        }
    }
    let phase =
        e.id.bytes()
            .fold(0u32, |n, b| n.wrapping_mul(31).wrapping_add(u32::from(b)));
    let side = if phase.wrapping_add((time / 2.4) as u32) % 2 == 0 {
        1.0
    } else {
        -1.0
    };
    let radial = if distance > profile.preferred_range + 2.0 {
        1.0
    } else if distance < profile.preferred_range - 1.0 {
        -0.8
    } else {
        0.0
    };
    let flank = if e.kind == "drone" {
        0.85
    } else if distance > 6.0 {
        0.4
    } else {
        0.15
    };
    let direction = [
        e.yaw.sin() * radial + e.yaw.cos() * side * flank,
        0.0,
        e.yaw.cos() * radial - e.yaw.sin() * side * flank,
    ];
    let speed = e.speed;
    move_enemy(e, direction, speed, data, world);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(id: &str, position: Vec3) -> Player {
        let c: Character = serde_json::from_value(json!({"version":2,"id":id,"name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":position,"yaw":0,"health":120,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        let (output, _) = mpsc::channel(64);
        Player {
            elevator: None,
            live_social: live_social::Session::default(),
            instance: None,
            owner: "account".into(),
            c,
            output,
            input: Movement::default(),
            last_input: 0.0,
            velocity: [0.0; 3],
            previous_position: position,
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
            last_interact: -100.0,
            last_sequence: 0,
            dirty: false,
        }
    }

    fn fixture(kind: &str) -> (Content, World, Enemy, HashMap<String, Player>) {
        let data =
            Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap();
        let world = World::new(&data.map);
        let template = data
            .enemies
            .iter()
            .find(|e| text(&e["id"]) == kind)
            .unwrap();
        let e = Enemy {
            id: "test-enemy".into(),
            instance: None,
            event: None,
            kind: kind.into(),
            name: "Test enemy".into(),
            model: text(&template["model"]).into(),
            color: "#ff946b".into(),
            position: [0.0, 0.0, 270.0],
            home: [0.0, 0.0, 270.0],
            level: 0,
            health: num(&template["health"]),
            max_health: num(&template["health"]),
            yaw: 0.0,
            damage: num(&template["damage"]),
            speed: num(&template["speed"]),
            attack_at: 0.0,
            attack: None,
            last_move: None,
            stun_until: 0.0,
            exposed_until: 0.0,
            respawn_at: f64::MAX,
            aggro: None,
        };
        let players = HashMap::from([("runner".into(), player("runner", [0.0, 0.0, 280.0]))]);
        (data, world, e, players)
    }

    fn attack(e: &Enemy, p: &Player, kind: Kind, data: &Content, world: &World) -> Attack {
        let a = data.enemy_profiles[&e.kind]
            .attacks
            .iter()
            .find(|a| a.kind == kind)
            .unwrap();
        prepare(e, p, a, data, world, 10.0)
    }

    #[test]
    fn moves_vary_without_repeating_when_an_alternative_is_in_range() {
        let (data, _, _, _) = fixture("drone");
        let mut seed = 87421;
        for (kind, distance) in [("drone", 20.0), ("scavenger", 6.0), ("warden", 12.0)] {
            let profile = &data.enemy_profiles[kind];
            let (mut last, mut seen) = (None, HashSet::new());
            for _ in 0..100 {
                let chosen = choose_move(profile, distance, last, &mut seed).unwrap();
                assert_ne!(Some(chosen.kind), last);
                assert!((chosen.min_range..=chosen.range).contains(&distance));
                last = Some(chosen.kind);
                seen.insert(chosen.kind);
            }
            assert_eq!(seen.len(), 3);
            assert!(choose_move(profile, 80.0, last, &mut seed).is_none());
        }
        let far = choose_move(
            &data.enemy_profiles["scavenger"],
            36.0,
            Some(Kind::Grenades),
            &mut seed,
        )
        .unwrap();
        assert_eq!(
            far.kind,
            Kind::Grenades,
            "a lone ranged option must not stall the AI"
        );
    }

    #[test]
    fn footprints_respect_direction_ring_safe_centers_and_other_floors() {
        let lane = Area::Lane {
            position: [0.0; 3],
            yaw: std::f64::consts::FRAC_PI_2,
            length: 10.0,
            width: 2.0,
        };
        assert!(lane.contains([5.0, 2.5, 0.9]));
        for p in [
            [-1.0, 0.0, 0.0],
            [11.0, 0.0, 0.0],
            [5.0, 0.0, 1.1],
            [5.0, 4.0, 0.0],
        ] {
            assert!(!lane.contains(p));
        }
        let cone = Area::Cone {
            position: [0.0; 3],
            yaw: 0.0,
            radius: 8.0,
            angle: 1.0,
        };
        assert!(cone.contains([0.0, 0.0, 7.0]));
        assert!(!cone.contains([0.0, 0.0, -1.0]));
        assert!(!cone.contains([7.0, 0.0, 0.0]));
        let ring = Area::Circle {
            position: [0.0; 3],
            radius: 9.0,
            inner_radius: 2.8,
        };
        assert!(!ring.contains([0.0; 3]));
        assert!(ring.contains([3.0, 0.0, 0.0]));
        assert!(!ring.contains([10.0, 0.0, 0.0]));
    }

    #[test]
    fn snapshots_carry_all_strike_geometry_and_timing_without_damage_state() {
        for kind in ["drone", "scavenger", "warden"] {
            let (data, world, e, players) = fixture(kind);
            for a in &data.enemy_profiles[kind].attacks {
                let attack = prepare(&e, &players["runner"], a, &data, &world, 10.0);
                assert!(!attack.strikes.is_empty() && attack.strikes.len() <= 6);
                for s in &attack.strikes {
                    assert!(s.hits_at >= 10.65);
                    assert!(s.area.position().iter().all(|n| n.is_finite()));
                }
                let snapshot = serde_json::to_value(&attack).unwrap();
                assert_eq!(snapshot["name"], a.name);
                assert!(snapshot.get("origin").is_none());
                assert!(snapshot.get("target").is_none());
                for s in snapshot["strikes"].as_array().unwrap() {
                    assert!(
                        s["shape"].is_string()
                            && s["position"].is_array()
                            && s["hitsAt"].is_number()
                    );
                    assert!(s.get("power").is_none() && s.get("resolved").is_none());
                }
            }
        }
    }

    #[test]
    fn a_locked_warning_never_tracks_a_dodging_runner_or_deals_early_damage() {
        let (data, world, mut e, mut players) = fixture("drone");
        let mut a = attack(&e, &players["runner"], Kind::Bombard, &data, &world);
        let snapshot = serde_json::to_value(&a).unwrap();
        resolve(&mut e, &mut a, &mut players, &data, &world, 10.5);
        assert_eq!(players["runner"].c.health, 120.0);
        players.get_mut("runner").unwrap().c.position[0] = 12.0;
        resolve(&mut e, &mut a, &mut players, &data, &world, 12.0);
        assert_eq!(players["runner"].c.health, 120.0);
        assert_eq!(serde_json::to_value(&a).unwrap(), snapshot);
    }

    #[test]
    fn bombardment_predicts_impact_positions_instead_of_trailing_a_running_target() {
        let (data, world, e, mut players) = fixture("drone");
        let p = players.get_mut("runner").unwrap();
        p.velocity = [10.0, 0.0, 0.0];
        let a = attack(&e, p, Kind::Bombard, &data, &world);
        for s in &a.strikes {
            let expected = p.c.position[0] + p.velocity[0] * (s.hits_at - a.started);
            assert!((s.area.position()[0] - expected).abs() < 1e-8);
        }
        p.velocity = [1000.0, 0.0, 0.0];
        let a = attack(&e, p, Kind::Bombard, &data, &world);
        for s in &a.strikes {
            assert!(dist(s.area.position(), p.c.position) <= 17.0 * (s.hits_at - a.started) + 1e-8);
        }
    }

    #[test]
    fn overlapping_rays_hit_once_and_use_armor_and_shields() {
        let (data, world, mut e, mut players) = fixture("drone");
        let p = players.get_mut("runner").unwrap();
        p.c.position = [0.0, 0.0, 271.0];
        p.shield = 10.0;
        let expected = (e.damage * 1.15 * (1.0 - Stats::new(&p.c, &data).armor)).round();
        let mut a = attack(&e, p, Kind::Fan, &data, &world);
        resolve(&mut e, &mut a, &mut players, &data, &world, 11.0);
        assert_eq!(players["runner"].c.health, 120.0 - expected + 10.0);
        assert_eq!(players["runner"].shield, 0.0);
        let health = players["runner"].c.health;
        resolve(&mut e, &mut a, &mut players, &data, &world, 11.1);
        assert_eq!(
            players["runner"].c.health, health,
            "resolved strikes cannot hit twice"
        );
    }

    #[test]
    fn a_burst_can_hit_repeatedly_but_a_charge_hits_each_runner_only_once() {
        let (data, world, mut e, mut players) = fixture("drone");
        players.get_mut("runner").unwrap().c.position = [0.0, 0.0, 271.0];
        let mut a = attack(&e, &players["runner"], Kind::Burst, &data, &world);
        let mut health = 120.0;
        for time in [10.75, 11.03, 11.32] {
            resolve(&mut e, &mut a, &mut players, &data, &world, time);
            assert!(players["runner"].c.health < health);
            health = players["runner"].c.health;
        }
        let (data, world, mut e, mut players) = fixture("warden");
        let mut a = attack(&e, &players["runner"], Kind::Charge, &data, &world);
        let strikes = a.strikes.clone();
        let mut health = None;
        for s in strikes {
            if let Area::Lane {
                position,
                length,
                yaw,
                ..
            } = s.area
            {
                players.get_mut("runner").unwrap().c.position = [
                    position[0] + yaw.sin() * length / 2.0,
                    position[1],
                    position[2] + yaw.cos() * length / 2.0,
                ];
            }
            resolve(&mut e, &mut a, &mut players, &data, &world, s.hits_at);
            assert!(players["runner"].c.health < 120.0);
            if let Some(health) = health {
                assert_eq!(players["runner"].c.health, health);
            }
            health = Some(players["runner"].c.health);
            assert!(!world.collides(e.position, 0.65));
        }
    }

    #[test]
    fn strikes_respect_instances_training_death_and_solid_cover() {
        let (data, world, mut e, mut players) = fixture("drone");
        let position = players["runner"].c.position;
        players.insert("ally".into(), player("ally", position));
        let mut outsider = player("outsider", position);
        outsider.instance = Some(7);
        let mut dead = player("dead", position);
        dead.c.health = 0.0;
        players.insert("outsider".into(), outsider);
        players.insert("dead".into(), dead);
        let mut a = attack(&e, &players["runner"], Kind::Bombard, &data, &world);
        resolve(&mut e, &mut a, &mut players, &data, &world, 11.11);
        assert!(players["runner"].c.health < 120.0);
        assert_eq!(players["ally"].c.health, players["runner"].c.health);
        assert_eq!(players["outsider"].c.health, 120.0);
        assert_eq!(players["dead"].c.health, 0.0);
        let safe = data.map.tutorial.spawn;
        players.get_mut("runner").unwrap().c.position = safe;
        a.strikes = vec![Strike {
            area: Area::Circle {
                position: safe,
                radius: 3.0,
                inner_radius: 0.0,
            },
            hits_at: 12.0,
            power: 1.0,
            resolved: false,
        }];
        let health = players["runner"].c.health;
        resolve(&mut e, &mut a, &mut players, &data, &world, 12.0);
        assert_eq!(players["runner"].c.health, health);
        let b = world.cells.values().find(|b| !b.rooftop).unwrap();
        a.origin = [b.x - b.width / 2.0 - 2.0, 0.0, b.z];
        let covered = [b.x + b.width / 2.0 + 2.0, 0.0, b.z];
        assert!(!world.visible(a.origin, covered));
        players.get_mut("runner").unwrap().c.position = covered;
        a.strikes = vec![Strike {
            area: Area::Circle {
                position: covered,
                radius: 3.0,
                inner_radius: 0.0,
            },
            hits_at: 13.0,
            power: 1.0,
            resolved: false,
        }];
        resolve(&mut e, &mut a, &mut players, &data, &world, 13.0);
        assert_eq!(players["runner"].c.health, health);
    }

    #[test]
    fn interruption_death_respawn_and_leashing_discard_pending_attacks() {
        let (data, world, mut e, mut players) = fixture("drone");
        e.attack = Some(attack(&e, &players["runner"], Kind::Bombard, &data, &world));
        e.stun_until = 13.0;
        tick(&mut e, &mut players, &data, &world, 11.0, &mut 42);
        assert!(e.attack.is_none());
        assert!(e.attack_at >= 13.35);
        assert_eq!(players["runner"].c.health, 120.0);
        e.health = 0.0;
        e.respawn_at = 20.0;
        e.attack = Some(attack(&e, &players["runner"], Kind::Bombard, &data, &world));
        tick(&mut e, &mut players, &data, &world, 14.0, &mut 42);
        assert!(e.attack.is_none());
        assert_eq!(e.health, 0.0);
        tick(&mut e, &mut players, &data, &world, 20.0, &mut 42);
        assert_eq!(e.health, e.max_health);
        assert!(e.aggro.is_none());
        assert!(e.attack_at > 20.0);
        e.attack = Some(attack(&e, &players["runner"], Kind::Bombard, &data, &world));
        e.position[2] += data.rule("combat", "leash") + 1.0;
        tick(&mut e, &mut players, &data, &world, 21.0, &mut 42);
        assert_eq!(e.position, e.home);
        assert!(e.attack.is_none());
    }

    #[test]
    fn ranged_attackers_are_pursued_beyond_passive_aggro_and_cannot_regenerate_in_combat() {
        let (data, world, mut e, mut players) = fixture("drone");
        players.get_mut("runner").unwrap().c.position = [0.0, 0.0, 320.0];
        tick(&mut e, &mut players, &data, &world, 10.0, &mut 42);
        assert_eq!(e.position, e.home);
        e.aggro = Some(("runner".into(), 20.0));
        tick(&mut e, &mut players, &data, &world, 11.0, &mut 42);
        assert!(e.position[2] > e.home[2]);
        assert_eq!(players["runner"].last_combat, 11.0);
    }

    #[test]
    fn a_departed_target_cancels_its_pending_attack() {
        let (data, world, mut e, mut players) = fixture("drone");
        e.attack = Some(attack(&e, &players["runner"], Kind::Bombard, &data, &world));
        players.remove("runner");
        tick(&mut e, &mut players, &data, &world, 11.2, &mut 42);
        assert!(e.attack.is_none());
    }

    #[test]
    fn charges_stop_before_walls_and_training_and_never_leave_the_arena() {
        let (data, world, mut e, _) = fixture("warden");
        let b = world.cells.values().find(|b| !b.rooftop).unwrap();
        e.position = [b.x - b.width / 2.0 - 2.0, 0.0, b.z];
        e.home = e.position;
        let end = charge_end(
            &e,
            std::f64::consts::FRAC_PI_2,
            b.width + 4.0,
            &data,
            &world,
        );
        assert!(end[0] < b.x - b.width / 2.0);
        assert!(!world.collides(end, 0.65));
        e.position = [0.0, 0.0, -40.0];
        e.home = e.position;
        let end = charge_end(&e, std::f64::consts::PI, 20.0, &data, &world);
        assert!(!data.map.tutorial.contains(end));
        assert!(end[2] > -60.0);
        e.instance = Some(1);
        e.position = data.dungeons.rules.arena;
        e.home = e.position;
        let end = charge_end(&e, 0.0, 80.0, &data, &world);
        assert!(end[2] <= e.home[2] + data.dungeons.rules.arena_radius - 0.65);
    }
}
