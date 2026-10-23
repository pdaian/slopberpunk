// Shard-local conversation. No chat text is written to character saves.
// GPL-3.0-or-later.
use super::*;
use std::collections::VecDeque;

const NEARBY_RADIUS: f64 = 35.0;
const MAX_PENDING: usize = 32;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Tutorial {
    gesture: bool,
    nearby: bool,
    zone: bool,
}

#[derive(Default)]
pub(super) struct Session {
    last_sent: Option<Instant>,
    receipts: VecDeque<(String, Value)>,
    // Drain only after a snapshot enters the socket queue.
    pub(super) pending: VecDeque<Value>,
}
impl Session {
    fn push(&mut self, event: Value) {
        if self.pending.len() == MAX_PENDING {
            self.pending.pop_front();
        }
        self.pending.push_back(event);
    }
}

#[derive(Clone, Deserialize)]
pub(super) struct Zone {
    pub id: String,
    name: String,
    center: Vec3,
    radius: f64,
}

pub(super) fn validate(map: &Map) -> io::Result<()> {
    let mut ids = HashSet::new();
    if map.districts.len() < 2
        || !map.city_radius.is_finite()
        || map.city_radius <= 0.0
        || map.districts.iter().chain(&map.biomes).any(|z| {
            z.id.is_empty()
                || !ids.insert(&z.id)
                || z.name.is_empty()
                || !z.center.iter().all(|v| v.is_finite())
                || !z.radius.is_finite()
                || z.radius <= 0.0
        })
    {
        return Err(io::Error::other("Invalid conversation zones"));
    }
    Ok(())
}

// Match World.district, including its tie-breaking at district boundaries.
fn zone<'a>(map: &'a Map, p: &Player) -> (&'a str, &'a str) {
    if p.instance.is_some() {
        return ("expedition", "Expedition crew");
    }
    let position = p.c.position;
    let distance = |z: &Zone| (position[0] - z.center[0]).hypot(position[2] - z.center[2]);
    let z = map
        .biomes
        .iter()
        .find(|z| distance(z) <= z.radius)
        .unwrap_or_else(|| {
            if position[0].abs().max(position[2].abs()) > map.city_radius {
                map.districts.last().expect("validated zones")
            } else {
                map.districts[..map.districts.len() - 1]
                    .iter()
                    .reduce(|a, b| if distance(a) < distance(b) { a } else { b })
                    .expect("validated zones")
            }
        });
    (&z.id, &z.name)
}

pub(super) fn context(map: &Map, p: &Player) -> Value {
    let (id, name) = zone(map, p);
    json!({"id":id,"name":name,"instance":p.instance,"nearbyRadius":NEARBY_RADIUS})
}

fn in_audience(map: &Map, sender: &Player, recipient: &Player, channel: &str) -> bool {
    sender.instance == recipient.instance
        && match channel {
            "nearby" => dist(sender.c.position, recipient.c.position) <= NEARBY_RADIUS,
            "zone" => zone(map, sender).0 == zone(map, recipient).0,
            _ => false,
        }
}

fn payload(value: &Value) -> Result<(&str, String, &str), &'static str> {
    if text(&value["type"]) == "emote" {
        let gesture = text(&value["gesture"]);
        let body = match gesture {
            "wave" => "waves hello.",
            "nod" => "nods in agreement.",
            "cheer" => "cheers for the crew!",
            "point" => "points the way.",
            _ => return Err("Choose Wave, Nod, Cheer, or Point."),
        };
        return Ok(("nearby", body.into(), gesture));
    }
    let channel = text(&value["channel"]);
    if !matches!(channel, "nearby" | "zone") {
        return Err("Choose Nearby or Zone chat.");
    }
    let body = text(&value["body"]).trim();
    if body.is_empty() || body.chars().count() > 280 || body.chars().any(char::is_control) {
        return Err("Use 1–280 characters on a single line.");
    }
    Ok((channel, body.into(), ""))
}

impl Shard {
    pub(super) fn live_social_action(&mut self, id: &str, value: &Value) {
        let request = text(&value["requestId"]);
        if request.is_empty()
            || request.len() > 64
            || !request
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return;
        }
        let Some(mut sender) = self.players.remove(id) else {
            return;
        };
        if let Some(receipt) = sender
            .live_social
            .receipts
            .iter()
            .find(|(key, _)| key == request)
            .map(|(_, receipt)| receipt.clone())
        {
            sender.live_social.push(receipt);
            self.players.insert(id.into(), sender);
            return;
        }
        let result = (|| {
            let (channel, body, gesture) = payload(value)?;
            if !gesture.is_empty() && sender.c.health <= 0.0 {
                return Err("Return to life before using a gesture. You can still chat.");
            }
            if sender
                .live_social
                .last_sent
                .is_some_and(|at| at.elapsed() < Duration::from_secs(2))
            {
                return Err("Give your neighbors a moment. Try again in two seconds.");
            }
            let social = self
                .db
                .social
                .lock()
                .map_err(|_| "Chat is temporarily unavailable.")?;
            let (zone_id, zone_name) = zone(&self.content.map, &sender);
            let event = json!({"type":"social","id":format!("{id}:{request}"),"requestId":request,
                "author":id,"name":sender.c.name,"channel":channel,"body":body,"gesture":gesture,
                "zone":zone_id,"zoneName":zone_name,"instance":sender.instance,"created":now_millis()});
            for recipient in self.players.values_mut() {
                if in_audience(&self.content.map, &sender, recipient, channel)
                    && !social.blocked(id, &recipient.c.id)
                {
                    recipient.live_social.push(event.clone());
                }
            }
            sender.live_social.last_sent = Some(Instant::now());
            if !gesture.is_empty() {
                sender.c.social_tutorial.gesture = true;
            } else if channel == "nearby" {
                sender.c.social_tutorial.nearby = true;
            } else {
                sender.c.social_tutorial.zone = true;
            }
            sender.c.revision += 1;
            sender.dirty = true;
            Ok(event)
        })();
        let event = result
            .unwrap_or_else(|error| json!({"type":"socialError","requestId":request,"text":error}));
        sender.live_social.push(event.clone());
        sender
            .live_social
            .receipts
            .push_back((request.into(), event));
        if sender.live_social.receipts.len() > 16 {
            sender.live_social.receipts.pop_front();
        }
        self.players.insert(id.into(), sender);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Shard {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let content = Arc::new(Content::load(&manifest.join("../client")).unwrap());
        // Existing read-only lease and an in-memory identity: no runtime files.
        let root = manifest.join("chat-in-memory-test-unused");
        let db = Arc::new(Database {
            signer: SigningIdentity::load(&root).unwrap(),
            root,
            mutation: Mutex::new(()),
            _lease: File::open(manifest.join("../LICENSE")).unwrap(),
            social: Mutex::new(SocialState::default()),
            write_failed: std::sync::atomic::AtomicBool::new(false),
        });
        let (saves, _) = mpsc::channel(1);
        Shard::new(content, saves, 0, db)
    }

    fn add(s: &mut Shard, id: &str, position: Vec3) -> mpsc::Receiver<Value> {
        let c: Character = serde_json::from_value(json!({"version":2,"id":id,"name":format!("Runner {id}"),"race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":position,"yaw":0,"health":140,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        let (output, rx) = mpsc::channel(1);
        s.players.insert(
            id.into(),
            Player {
                elevator: None,
                live_social: Session::default(),
                instance: None,
                owner: id.into(),
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
            },
        );
        rx
    }

    fn pending(s: &Shard, id: &str) -> Vec<Value> {
        s.players[id].live_social.pending.iter().cloned().collect()
    }

    #[test]
    fn zones_match_city_biome_basin_and_boundary_rules() {
        let mut s = fixture();
        let _rx = add(&mut s, "a", [0.0; 3]);
        for (position, expected) in [
            ([0.0, 0.0, 32.0], "market"),
            ([160.0, 0.0, -160.0], "archive"),
            ([-320.0, 48.0, -320.0], "furnace"),
            ([-320.0, 0.0, 320.0], "quiet"),
            ([320.0, 24.0, 320.0], "skybridge"),
            ([1440.0, 0.0, 320.0], "mourning-fen"),
            ([-1440.0, 0.0, -320.0], "cinderwood"),
            ([0.0, 0.0, -1440.0], "glassroot-steppe"),
            ([400.0, 0.0, 1600.0], "brine-bloom"),
            ([2800.0, 0.0, 2800.0], "basin"),
        ] {
            s.players.get_mut("a").unwrap().c.position = position;
            assert_eq!(zone(&s.content.map, &s.players["a"]).0, expected);
        }
    }

    #[test]
    fn routing_uses_authoritative_identity_distance_zone_and_instance() {
        let mut s = fixture();
        let _receivers = [
            add(&mut s, "a", [0.0; 3]),
            add(&mut s, "b", [35.0, 0.0, 0.0]),
            add(&mut s, "c", [35.01, 0.0, 0.0]),
            add(&mut s, "d", [320.0, 0.0, -320.0]),
        ];
        s.action("a", &json!({"type":"chat","channel":"nearby","body":"Hello","requestId":"hello","author":"forged","name":"Forged","position":[320,0,-320]}));
        assert_eq!(pending(&s, "a")[0]["name"], "Runner a");
        assert_eq!(pending(&s, "b")[0]["author"], "a");
        assert!(pending(&s, "c").is_empty());
        assert!(pending(&s, "d").is_empty());
        assert!(!in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["c"],
            "nearby"
        ));
        assert!(in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["c"],
            "zone"
        ));
        assert!(!in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["d"],
            "zone"
        ));
        s.players.get_mut("a").unwrap().instance = Some(7);
        assert!(!in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["b"],
            "nearby"
        ));
        s.players.get_mut("d").unwrap().instance = Some(7);
        assert!(in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["d"],
            "zone"
        ));
        s.players.get_mut("d").unwrap().instance = Some(8);
        assert!(!in_audience(
            &s.content.map,
            &s.players["a"],
            &s.players["d"],
            "zone"
        ));
    }

    #[test]
    fn blocks_apply_both_directions_to_messages_and_gestures() {
        for (blocker, blocked) in [("a", "b"), ("b", "a")] {
            let mut s = fixture();
            let _receivers = [
                add(&mut s, "a", [0.0; 3]),
                add(&mut s, "b", [1.0, 0.0, 0.0]),
            ];
            let mut state = serde_json::to_value(SocialState::default()).unwrap();
            state["blocks"][blocker] = json!([blocked]);
            *s.db.social.lock().unwrap() = serde_json::from_value(state).unwrap();
            for (index, mut request) in [
                json!({"type":"emote","gesture":"wave"}),
                json!({"type":"chat","channel":"zone","body":"Hello"}),
            ]
            .into_iter()
            .enumerate()
            {
                s.players.get_mut("a").unwrap().live_social.last_sent = None;
                request["requestId"] = json!(format!("request-{index}"));
                s.action("a", &request);
            }
            assert_eq!(pending(&s, "a").len(), 2);
            assert!(pending(&s, "b").is_empty());
        }
    }

    #[test]
    fn retries_are_idempotent_and_rate_rejections_do_not_advance_lessons() {
        let mut s = fixture();
        let _receivers = [
            add(&mut s, "a", [0.0; 3]),
            add(&mut s, "b", [1.0, 0.0, 0.0]),
        ];
        let request = json!({"type":"emote","gesture":"wave","requestId":"once"});
        s.action("a", &request);
        s.action("a", &request);
        assert_eq!(pending(&s, "b").len(), 1);
        assert_eq!(pending(&s, "a")[0], pending(&s, "a")[1]);
        assert!(s.players["a"].c.social_tutorial.gesture);
        s.action(
            "a",
            &json!({"type":"chat","channel":"zone","body":"Help!","requestId":"too-soon"}),
        );
        assert_eq!(pending(&s, "a").last().unwrap()["type"], "socialError");
        assert!(!s.players["a"].c.social_tutorial.zone);
        assert_eq!(s.players["a"].c.gold, 45);
        assert_eq!(s.players["a"].c.xp, 0);
        let restored: Character =
            serde_json::from_value(serde_json::to_value(&s.players["a"].c).unwrap()).unwrap();
        assert!(restored.social_tutorial.gesture);
    }

    #[test]
    fn full_socket_queues_retain_chat_until_the_next_delivered_snapshot() {
        let mut s = fixture();
        let mut rx = add(&mut s, "a", [0.0; 3]);
        s.players["a"]
            .output
            .try_send(json!({"type":"occupied"}))
            .unwrap();
        s.action(
            "a",
            &json!({"type":"chat","channel":"nearby","body":"Hello","requestId":"hello"}),
        );
        s.snapshots();
        assert_eq!(pending(&s, "a").len(), 1);
        rx.try_recv().unwrap();
        s.snapshots();
        let snapshot = rx.try_recv().unwrap();
        assert_eq!(snapshot["social"][0]["body"], "Hello");
        assert_eq!(snapshot["chatContext"]["id"], "market");
        assert!(pending(&s, "a").is_empty());
        s.snapshots();
        assert_eq!(rx.try_recv().unwrap()["social"], json!([]));
    }

    #[test]
    fn text_limits_gesture_allowlist_death_and_buffer_bounds_are_enforced() {
        for body in ["", " \n ", "a\nb", "a\u{0085}b"] {
            assert!(payload(&json!({"type":"chat","channel":"nearby","body":body})).is_err());
        }
        assert!(
            payload(&json!({"type":"chat","channel":"nearby","body":"🚀".repeat(280)})).is_ok()
        );
        assert!(
            payload(&json!({"type":"chat","channel":"nearby","body":"🚀".repeat(281)})).is_err()
        );
        assert!(payload(&json!({"type":"chat","channel":"guild:1","body":"Hello"})).is_err());
        assert!(payload(&json!({"type":"emote","gesture":"unknown"})).is_err());
        let mut s = fixture();
        let _rx = add(&mut s, "a", [0.0; 3]);
        s.players.get_mut("a").unwrap().c.health = 0.0;
        s.action(
            "a",
            &json!({"type":"emote","gesture":"wave","requestId":"dead"}),
        );
        assert_eq!(pending(&s, "a")[0]["type"], "socialError");
        s.action(
            "a",
            &json!({"type":"chat","channel":"nearby","body":"Help me recover","requestId":"help"}),
        );
        assert!(s.players["a"].c.social_tutorial.nearby);
        for i in 0..100 {
            s.action("a", &json!({"type":"chat","channel":"nearby","body":"More","requestId":format!("flood-{i}")}));
        }
        assert_eq!(pending(&s, "a").len(), MAX_PENDING);
        assert_eq!(s.players["a"].live_social.receipts.len(), 16);
    }
}
