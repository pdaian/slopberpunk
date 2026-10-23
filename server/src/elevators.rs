// Observation elevators; mirrored by client/src/elevators.js.
// GPL-3.0-or-later. See LICENSE.
use super::*;

const DOOR_SECONDS: f64 = 1.2;

#[derive(Clone, Deserialize)]
pub(super) struct Venue {
    kind: String,
    velvet: String,
    accent: String,
    description: String,
    view: String,
}
impl Venue {
    pub fn valid(&self) -> bool {
        matches!(
            self.kind.as_str(),
            "hotel" | "restaurant" | "conservatory" | "jazz"
        ) && [&self.velvet, &self.accent].iter().all(|c| {
            c.len() == 7
                && c.starts_with('#')
                && c.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        }) && [&self.description, &self.view]
            .iter()
            .all(|s| !s.is_empty() && s.chars().count() <= 300)
    }
}

pub(super) fn position(b: &Building, y: f64) -> Vec3 {
    [b.x, y, b.z + b.depth / 2.0 + 4.0]
}

pub(super) fn solids(x: f64, z: f64, h: f64, depth: f64) -> Vec<Solid> {
    let center_z = z;
    let z = z + depth / 2.0;
    let mut solids = vec![
        Solid {
            center: [x, h - 0.175, z + 0.5],
            size: [7.0, 0.35, 1.3],
        },
        Solid {
            center: [x, h - 0.12, z + 4.0],
            size: [6.0, 0.24, 6.0],
        },
        Solid {
            center: [x - 3.15, h + 0.65, z + 3.5],
            size: [0.3, 1.3, 7.3],
        },
        Solid {
            center: [x + 3.15, h + 0.65, z + 3.5],
            size: [0.3, 1.3, 7.3],
        },
        Solid {
            center: [x, h + 0.65, z + 7.15],
            size: [6.6, 1.3, 0.3],
        },
    ];
    for y in [0.0, h] {
        for side in [-1.0, 1.0] {
            solids.push(Solid {
                center: [x + side * 2.9, y + 2.4, z + 4.0],
                size: [0.18, 4.8, 5.8],
            });
        }
    }
    for side in [-1.0, 1.0] {
        for end in [-1.0, 1.0] {
            solids.push(Solid {
                center: [x + side * 9.0, h + 3.1, center_z + end * 8.5],
                size: [0.18, 6.2, 0.18],
            });
        }
    }
    solids
}

#[derive(Clone, Serialize)]
pub(super) struct Ride {
    pub id: String,
    pub from: Vec3,
    pub to: Vec3,
    pub started: f64,
    pub duration: f64,
}
impl Ride {
    pub fn new(id: String, from: Vec3, to: Vec3, started: f64) -> Self {
        Self {
            id,
            from,
            to,
            started,
            duration: DOOR_SECONDS * 2.0 + 4.0 + (to[1] - from[1]).abs() / 22.0,
        }
    }
    pub fn position(&self, time: f64) -> Vec3 {
        let t = ((time - self.started - DOOR_SECONDS) / (self.duration - DOOR_SECONDS * 2.0))
            .clamp(0.0, 1.0);
        let eased = t * t * (3.0 - 2.0 * t);
        std::array::from_fn(|i| self.from[i] + (self.to[i] - self.from[i]) * eased)
    }
}

pub(super) fn board(p: &mut Player, world: &World, id: &str, time: f64) -> bool {
    if p.elevator.is_some()
        || p.instance.is_some()
        || (p.c.health <= 0.0 && !death::is_spirit(&p.c))
    {
        return false;
    }
    for roof in world.map.rooftops.iter().filter(|r| r.venue.is_some()) {
        if id != format!("elevator-building-{}-{}", roof.cell[0], roof.cell[1]) {
            continue;
        }
        let Some(b) = world.cells.get(&(roof.cell[0], roof.cell[1])) else {
            return false;
        };
        let y = if (p.c.position[1] - b.height).abs() < 1.0 {
            b.height
        } else {
            0.0
        };
        let from = position(b, y);
        if (p.c.position[1] - y).abs() >= 1.0
            || dist(p.c.position, from) >= 5.0
            || !world.visible(p.c.position, from)
        {
            notice(p, "Walk up to the elevator at street or top-floor level.");
            return false;
        }
        let to = position(b, if y == 0.0 { b.height } else { 0.0 });
        p.c.position = from;
        p.previous_position = from;
        p.elevator = Some(Ride::new(id.to_owned(), from, to, time));
        reset_motion(p);
        p.dirty = true;
        return true;
    }
    false
}

fn reset_motion(p: &mut Player) {
    p.velocity = [0.0; 3];
    p.input = Movement {
        yaw: p.c.yaw,
        ..Movement::default()
    };
    p.dash = 0.0;
    p.coyote = 0.0;
    p.jump_buffer = 0.0;
    p.grounded = true;
    p.ghost_trail.clear();
}

pub(super) fn tick(p: &mut Player, time: f64) -> bool {
    let Some(ride) = &p.elevator else {
        return false;
    };
    p.c.position = ride.position(time);
    let arrived = time >= ride.started + ride.duration;
    p.c.yaw = p.input.yaw;
    reset_motion(p);
    if arrived {
        p.elevator = None;
        p.previous_position = p.c.position;
        p.dirty = true;
    }
    true
}

// Death and relocations must never leave a body suspended in an elevator shaft.
pub(super) fn cancel(p: &mut Player) {
    if let Some(ride) = p.elevator.take() {
        p.c.position = ride.from;
        p.previous_position = ride.from;
        reset_motion(p);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Content, World, Player) {
        let data =
            Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap();
        let world = World::new(&data.map);
        let c: Character = serde_json::from_value(json!({"version":2,"id":"guest","name":"Guest","race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":[0,0,32],"yaw":0,"health":120,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
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
            last_combat: 0.0,
            dead_at: 0.0,
            last_interact: -100.0,
            last_sequence: 0,
            dirty: false,
        };
        (data, world, p)
    }

    #[test]
    fn rides_require_a_nearby_visible_landing_and_ignore_movement_until_arrival() {
        let (data, world, mut p) = fixture();
        for roof in data.map.rooftops.iter().filter(|r| r.venue.is_some()) {
            let b = &world.cells[&(roof.cell[0], roof.cell[1])];
            let id = format!("elevator-building-{}-{}", roof.cell[0], roof.cell[1]);
            for y in [0.0, b.height] {
                p.c.position = position(b, y);
                p.c.position[0] += 6.0;
                assert!(!board(&mut p, &world, &id, 10.0));
                p.c.position = position(b, b.height / 2.0);
                assert!(!board(&mut p, &world, &id, 10.0));
                p.c.position = [b.x + 6.0, y, b.z];
                assert!(!board(&mut p, &world, &id, 10.0));
                p.c.position = position(b, y);
                assert!(board(&mut p, &world, &id, 10.0));
                let ride = p.elevator.clone().unwrap();
                assert!(!board(&mut p, &world, &id, 10.1));
                assert_eq!(ride.position(0.0), ride.from);
                assert!(
                    (ride.position(ride.started + ride.duration / 2.0)[1] - b.height / 2.0).abs()
                        < 1e-7
                );
                for i in 0..=((ride.duration / 0.05).ceil() as u32) {
                    let time = ride.started + f64::from(i) * 0.05;
                    p.input.forward = 1.0;
                    p.input.jump = true;
                    p.input.dash = true;
                    movement(&mut p, &data, &world, time, 0.05);
                    assert_eq!(p.c.position, ride.position(time));
                    assert_eq!(p.velocity, [0.0; 3]);
                }
                assert!(p.elevator.is_none());
                assert_eq!(p.c.position, ride.to);
                assert!(!world.collides(p.c.position, 0.65));
                assert!(
                    (world.floor(
                        p.c.position[0],
                        p.c.position[2],
                        p.c.position[1] + 0.1,
                        p.c.position[1] - 0.2
                    ) - p.c.position[1])
                        .abs()
                        < 1e-7
                );
                assert_eq!(p.c.gold, 45);
            }
        }
    }

    #[test]
    fn save_and_death_recover_to_a_supported_landing_without_saving_transit_state() {
        let (data, world, mut p) = fixture();
        let roof = data
            .map
            .rooftops
            .iter()
            .find(|r| r.venue.is_some())
            .unwrap();
        let b = &world.cells[&(roof.cell[0], roof.cell[1])];
        let id = format!("elevator-building-{}-{}", roof.cell[0], roof.cell[1]);
        p.c.position = position(b, b.height);
        assert!(board(&mut p, &world, &id, 10.0));
        let ride = p.elevator.clone().unwrap();
        tick(&mut p, ride.started + ride.duration / 2.0);
        let midair = p.c.position;
        let saved = saved_player(&p, 15.0);
        assert_eq!(saved.character.position, ride.from);
        assert_eq!(
            p.c.position, midair,
            "a checkpoint must not move the live passenger"
        );
        assert!(
            serde_json::to_value(&saved.character)
                .unwrap()
                .get("elevator")
                .is_none()
        );
        p.c.health = 0.0;
        death::fallen(&mut p, &data, 15.0);
        assert!(p.elevator.is_none());
        assert_eq!(p.c.position, ride.from);
        assert_eq!(p.c.death.as_ref().unwrap().corpse, ride.from);
        assert!(
            !board(&mut p, &world, &id, 16.0),
            "unreleased bodies cannot board"
        );
        p.c.death.as_mut().unwrap().released = true;
        assert!(
            board(&mut p, &world, &id, 16.0),
            "spirits retain access to rooftops"
        );
        cancel(&mut p);
        p.instance = Some(1);
        assert!(!board(&mut p, &world, &id, 17.0));
    }

    #[test]
    fn rooftop_balconies_connect_to_venues_and_have_solid_guardrails() {
        let (data, world, _) = fixture();
        for roof in data.map.rooftops.iter().filter(|r| r.venue.is_some()) {
            let b = &world.cells[&(roof.cell[0], roof.cell[1])];
            let start = position(b, b.height);
            let mut p = start;
            for z in [b.z, start[2]] {
                while (p[2] - z).abs() > 1e-7 {
                    p = world
                        .step_position(p, 2, (z - p[2]).clamp(-0.2, 0.2), true, 0.65, 2.1)
                        .expect("elevator exit must be walkable");
                    assert!((p[1] - b.height).abs() < 1e-7);
                }
            }
            for side in [-1.0, 1.0] {
                assert!(world.collides([start[0] + side * 3.0, b.height, start[2]], 0.65));
            }
            assert!(world.collides([start[0], b.height, start[2] + 3.0], 0.65));
        }
    }

    #[test]
    fn malformed_venue_presentation_is_rejected() {
        let (mut data, _, _) = fixture();
        let roof = data
            .map
            .rooftops
            .iter_mut()
            .find(|r| r.venue.is_some())
            .unwrap();
        roof.venue.as_mut().unwrap().accent = "red".into();
        assert!(data.validate().is_err());
    }
}
