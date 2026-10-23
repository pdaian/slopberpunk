// Server-owned movement recordings and swept echo contact. GPL-3.0-or-later.
use super::*;

#[derive(Clone, Serialize)]
pub(super) struct GhostPoint {
    time: f64,
    position: Vec3,
}

#[derive(Default)]
pub(super) struct GhostTrail {
    samples: Vec<GhostPoint>,
}

#[derive(Serialize)]
pub(super) struct GhostCharge {
    seconds: f64,
    meters: f64,
    pub ready: bool,
}

impl GhostTrail {
    pub fn clear(&mut self) {
        self.samples.clear();
    }
    pub fn record(&mut self, time: f64, position: Vec3, max_speed: f64, data: &Content) {
        let interval = data.rule("ghostline", "sampleSeconds");
        if self.samples.last().is_some_and(|last| {
            time < last.time
                || time - last.time > interval * 3.0
                || dist(last.position, position) > max_speed * (time - last.time) + 1.0
        }) {
            self.clear();
        }
        self.samples
            .retain(|s| s.time >= time - data.rule("ghostline", "historySeconds") - 1e-8);
        if self
            .samples
            .last()
            .is_some_and(|last| time - last.time < interval - 1e-8)
        {
            return;
        }
        self.samples.push(GhostPoint { time, position });
        let limit = (data.rule("ghostline", "historySeconds") / interval).ceil() as usize + 1;
        if self.samples.len() > limit {
            self.samples.drain(..self.samples.len() - limit);
        }
    }
    pub fn charge(&self, data: &Content) -> GhostCharge {
        let seconds = self
            .samples
            .last()
            .zip(self.samples.first())
            .map_or(0.0, |(last, first)| last.time - first.time);
        let meters = self
            .samples
            .windows(2)
            .map(|pair| dist(pair[0].position, pair[1].position))
            .sum();
        GhostCharge {
            seconds,
            meters,
            ready: seconds + 1e-8 >= data.rule("ghostline", "minSeconds")
                && meters >= data.rule("ghostline", "minDistance"),
        }
    }
    pub fn release(&self, c: &Character, time: f64, data: &Content) -> Option<Ghostline> {
        if !self.charge(data).ready {
            return None;
        }
        let start = self.samples.first()?.time;
        Some(Ghostline {
            owner: c.id.clone(),
            name: c.name.clone(),
            started: time,
            path: self
                .samples
                .iter()
                .map(|s| GhostPoint {
                    time: s.time - start,
                    position: s.position,
                })
                .collect(),
        })
    }
}

#[derive(Serialize)]
pub(super) struct Ghostline {
    pub owner: String,
    name: String,
    pub started: f64,
    path: Vec<GhostPoint>,
}

fn mix(a: Vec3, b: Vec3, t: f64) -> Vec3 {
    std::array::from_fn(|i| a[i] + (b[i] - a[i]) * t)
}

impl Ghostline {
    pub fn expires(&self) -> f64 {
        self.started + self.path.last().map_or(0.0, |s| s.time)
    }
    pub fn position(&self, time: f64) -> Vec3 {
        let elapsed = (time - self.started).max(0.0);
        for pair in self.path.windows(2) {
            if elapsed <= pair[1].time {
                return mix(
                    pair[0].position,
                    pair[1].position,
                    ((elapsed - pair[0].time) / (pair[1].time - pair[0].time)).clamp(0.0, 1.0),
                );
            }
        }
        self.path.last().map_or([0.0; 3], |s| s.position)
    }
    pub fn contact(
        &self,
        time: f64,
        dt: f64,
        players: &HashMap<String, Player>,
        world: &World,
        data: &Content,
    ) -> Option<(String, Vec3)> {
        let armed = self.started + data.rule("ghostline", "armSeconds");
        if time < armed || time - dt > self.expires() + 1e-8 {
            return None;
        }
        let to_time = time.min(self.expires());
        let from_time = (time - dt).max(armed).min(to_time);
        let from = self.position(from_time);
        let to = self.position(to_time);
        if !world.visible(from, to) {
            return None;
        }
        let mut best: Option<(String, Vec3, f64)> = None;
        let instance = players.get(&self.owner).and_then(|p| p.instance);
        for p in players
            .values()
            .filter(|p| p.c.health > 0.0 && p.instance == instance)
        {
            let previous = mix(
                p.previous_position,
                p.c.position,
                if dt > 0.0 {
                    ((from_time - (time - dt)) / dt).clamp(0.0, 1.0)
                } else {
                    1.0
                },
            );
            let current = mix(
                p.previous_position,
                p.c.position,
                if dt > 0.0 {
                    ((to_time - (time - dt)) / dt).clamp(0.0, 1.0)
                } else {
                    1.0
                },
            );
            let relative: Vec3 = std::array::from_fn(|i| from[i] - previous[i]);
            let delta: Vec3 = std::array::from_fn(|i| to[i] - current[i] - relative[i]);
            let length: f64 = delta.iter().map(|v| v * v).sum();
            let t = if length > 0.0 {
                (-relative.iter().zip(delta).map(|(a, b)| a * b).sum::<f64>() / length)
                    .clamp(0.0, 1.0)
            } else {
                0.0
            };
            let separation = dist(
                std::array::from_fn(|i| relative[i] + delta[i] * t),
                [0.0; 3],
            );
            let position = mix(from, to, t);
            if separation > data.rule("ghostline", "triggerRadius")
                || world.collides(position, 0.1)
                || !world.visible(position, mix(previous, current, t))
            {
                continue;
            }
            if best
                .as_ref()
                .is_none_or(|(id, _, d)| separation < *d || (separation == *d && &p.c.id < id))
            {
                best = Some((p.c.id.clone(), position, separation));
            }
        }
        best.map(|(id, position, _)| (id, position))
    }
}

impl Shard {
    pub(super) fn tick_ghostlines(&mut self) {
        let data = &self.content;
        for p in self.players.values_mut() {
            if p.c.health <= 0.0 || p.elevator.is_some() {
                p.ghost_trail.clear();
                self.ghostlines.remove(&p.c.id);
            } else {
                let speed = data.rule("movement", "dashSpeed") * Stats::new(&p.c, data).speed
                    + data.rule("movement", "jump");
                p.ghost_trail.record(self.time, p.c.position, speed, data);
            }
        }
        // Stable resolution when multiple echoes cross in the same tick.
        let mut owners: Vec<_> = self.ghostlines.keys().cloned().collect();
        owners.sort();
        for id in owners {
            let Some(ghost) = self.ghostlines.remove(&id) else {
                continue;
            };
            if !self.players.contains_key(&id) || self.time - 0.05 > ghost.expires() + 1e-8 {
                continue;
            }
            let Some((partner, position)) =
                ghost.contact(self.time, 0.05, &self.players, &self.world, data)
            else {
                if self.time <= ghost.expires() + 1e-8 {
                    self.ghostlines.insert(id, ghost);
                }
                continue;
            };
            let Some(a) = data.abilities.iter().find(|a| a.id == "ghostline") else {
                continue;
            };
            let cooperative = id != partner;
            let instance = self.players.get(&id).and_then(|p| p.instance);
            let event = json!({"type":"braid","owner":id,"partner":partner,"cooperative":cooperative,"position":position,"radius":a.radius,"color":a.color});
            for p in self.players.values_mut() {
                if p.instance != instance {
                    continue;
                }
                if p.c.id == id || p.c.id == partner {
                    p.c.energy = (p.c.energy + data.rule("ghostline", "energyReturn"))
                        .min(Stats::new(&p.c, data).energy);
                    p.dash_ready = self.time;
                    p.dirty = true;
                }
                if p.c.id == id
                    || p.c.id == partner
                    || dist(p.c.position, position) < data.rule("network", "interestRadius")
                {
                    emit(p, event.clone());
                }
            }
            if let Some(owner) = self.players.get_mut(&id) {
                let multiplier = if cooperative {
                    data.rule("ghostline", "allyMultiplier")
                } else {
                    1.0
                };
                for e in &mut self.enemies {
                    if e.health > 0.0
                        && e.instance == owner.instance
                        && dist(e.position, position) <= a.radius
                        && self.world.visible(position, e.position)
                    {
                        damage_enemy(
                            owner,
                            e,
                            a,
                            data,
                            self.time,
                            &mut self.seed,
                            position,
                            multiplier,
                        );
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Arc<Content> {
        Arc::new(
            Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap(),
        )
    }
    fn player(id: &str, position: Vec3) -> Player {
        let c: Character = serde_json::from_value(json!({"version":2,"id":id,"name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":position,"yaw":0,"health":140,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        let (output, _) = mpsc::channel(4);
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
            dash_ready: 99.0,
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
    fn shard() -> Shard {
        let data = content();
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // No database is opened or persisted. An existing read-only file stands in for the lease.
        let root = manifest.join("ghostline-in-memory-test-unused");
        let db = Arc::new(Database {
            signer: SigningIdentity::load(&root).unwrap(),
            root,
            mutation: Mutex::new(()),
            _lease: File::open(manifest.join("../LICENSE")).unwrap(),
            social: Mutex::new(SocialState::default()),
            write_failed: std::sync::atomic::AtomicBool::new(false),
        });
        let (saves, _) = mpsc::channel(1);
        let mut shard = Shard::new(data.clone(), saves, 0, db);
        shard.seed = 87421;
        let mut owner = player("owner", [0.0, 0.0, 270.0]);
        for i in 0..=30 {
            owner.ghost_trail.record(
                f64::from(i) * 0.1,
                [0.0, 0.0, 300.0 - f64::from(i)],
                46.0,
                &data,
            );
        }
        shard.players.insert("owner".into(), owner);
        shard.time = 3.0;
        shard.enemies.truncate(1);
        let enemy = &mut shard.enemies[0];
        enemy.position = [0.0, 0.0, 290.0];
        enemy.home = enemy.position;
        enemy.health = 100.0;
        enemy.level = 0;
        shard
    }
    fn cast(shard: &mut Shard) {
        shard.action("owner", &json!({"type":"ability","id":"ghostline"}));
    }

    #[test]
    fn history_is_bounded_and_discontinuities_cannot_be_replayed() {
        let data = content();
        let mut trace = GhostTrail::default();
        for i in 0..=2000 {
            trace.record(
                f64::from(i) * 0.05,
                [0.0, 0.0, f64::from(i) * 0.5],
                46.0,
                &data,
            );
        }
        assert!(trace.samples.len() <= 61);
        assert!(trace.charge(&data).ready);
        let ghost = trace
            .release(&player("owner", [0.0; 3]).c, 100.0, &data)
            .unwrap();
        assert_eq!(ghost.path[0].time, 0.0);
        assert!(ghost.expires() <= 106.0 + 1e-8);
        trace.record(100.1, [2000.0, 0.0, 0.0], 46.0, &data);
        assert_eq!(trace.samples.len(), 1);
        assert!(!trace.charge(&data).ready);
        assert_eq!(ghost.path[0].position[0], 0.0);
        trace.record(105.0, [2000.0, 0.0, 0.0], 46.0, &data);
        assert_eq!(trace.samples.len(), 1);
    }

    #[test]
    fn contact_is_swept_armed_spatial_and_deterministic() {
        let data = content();
        let world = World::new(&data.map);
        let ghost = Ghostline {
            owner: "owner".into(),
            name: "Runner".into(),
            started: 0.0,
            path: vec![
                GhostPoint {
                    time: 0.0,
                    position: [0.0; 3],
                },
                GhostPoint {
                    time: 3.0,
                    position: [0.0; 3],
                },
            ],
        };
        let mut players = HashMap::new();
        for id in ["b", "a"] {
            let mut p = player(id, [4.0, 0.0, 0.0]);
            p.previous_position = [-4.0, 0.0, 0.0];
            players.insert(id.into(), p);
        }
        assert_eq!(
            ghost.contact(1.0, 0.05, &players, &world, &data).unwrap().0,
            "a"
        );
        assert!(ghost.contact(0.5, 0.05, &players, &world, &data).is_none());
        assert!(ghost.contact(3.1, 0.05, &players, &world, &data).is_none());
        for p in players.values_mut() {
            p.c.position = [20.0, 0.0, 0.0];
        }
        assert!(ghost.contact(0.61, 0.05, &players, &world, &data).is_none());
        for p in players.values_mut() {
            p.c.position = [0.0, 24.0, 0.0];
            p.previous_position = p.c.position;
        }
        assert!(ghost.contact(1.0, 0.05, &players, &world, &data).is_none());
    }

    #[test]
    fn a_second_runner_braids_once_with_more_power_and_restores_both_players() {
        let mut s = shard();
        cast(&mut s);
        assert_eq!(s.ghostlines.len(), 1);
        s.players.get_mut("owner").unwrap().c.energy = 40.0;
        let mut partner = player("partner", [0.0, 0.0, 290.0]);
        partner.c.energy = 50.0;
        s.players.insert("partner".into(), partner);
        s.time = 4.0;
        s.tick_ghostlines();
        assert!(s.ghostlines.is_empty());
        assert_eq!(s.enemies[0].health, 37.0);
        assert_eq!(s.players["owner"].c.energy, 60.0);
        assert_eq!(s.players["partner"].c.energy, 70.0);
        assert_eq!(s.players["owner"].dash_ready, 4.0);
        assert_eq!(s.players["partner"].dash_ready, 4.0);
        s.time += 0.05;
        s.tick_ghostlines();
        assert_eq!(s.enemies[0].health, 37.0);
        assert_eq!(s.players["owner"].c.energy, 60.0);
    }

    #[test]
    fn a_solo_braid_grants_one_refund_and_normal_kill_rewards() {
        let mut s = shard();
        cast(&mut s);
        s.enemies[0].health = 30.0;
        let q = s
            .content
            .quests
            .iter()
            .find(|q| q.objective.kind == "kill" && q.objective.target == s.enemies[0].kind)
            .unwrap()
            .id
            .clone();
        let p = s.players.get_mut("owner").unwrap();
        p.c.position = [0.0, 0.0, 290.0];
        p.previous_position = p.c.position;
        p.c.energy = 50.0;
        p.c.active_quests.insert(q.clone(), 0);
        s.time = 4.0;
        s.tick_ghostlines();
        assert_eq!(s.enemies[0].health, 0.0);
        assert_eq!(s.players["owner"].c.energy, 70.0);
        assert_eq!(s.players["owner"].c.xp, 28);
        assert_eq!(s.players["owner"].c.gold, 50);
        assert_eq!(s.players["owner"].c.active_quests[&q], 1);
        s.tick_ghostlines();
        assert_eq!(s.players["owner"].c.gold, 50);
    }

    #[test]
    fn forged_routes_and_failed_casts_cannot_spend_or_create_and_cooldown_is_saved() {
        let mut s = shard();
        let trace = std::mem::take(&mut s.players.get_mut("owner").unwrap().ghost_trail);
        s.action(
            "owner",
            &json!({"type":"ability","id":"ghostline","path":[[0,0,0],[0,0,200]],"power":999999}),
        );
        assert!(s.ghostlines.is_empty());
        assert_eq!(s.players["owner"].c.energy, 100.0);
        let p = s.players.get_mut("owner").unwrap();
        p.ghost_trail = trace;
        p.c.energy = 29.0;
        cast(&mut s);
        assert!(s.players["owner"].cooldowns.is_empty());
        assert!(s.ghostlines.is_empty());
        s.players.get_mut("owner").unwrap().c.energy = 100.0;
        cast(&mut s);
        cast(&mut s);
        assert_eq!(s.ghostlines.len(), 1);
        assert_eq!(s.players["owner"].c.energy, 70.0);
        let saved = saved_player(&s.players["owner"], s.time);
        let reloaded: StoredCharacter =
            serde_json::from_str(&serde_json::to_string(&saved).unwrap()).unwrap();
        assert!(reloaded.cooldowns["ghostline"] > now_seconds() as f64 + 17.0);
        let payload = serde_json::to_value(&reloaded).unwrap();
        assert!(payload.get("ghostlines").is_none());
    }

    #[test]
    fn death_lifts_disconnects_and_expiry_remove_echoes_without_rewards() {
        for reason in ["death", "lift", "disconnect", "expiry"] {
            let mut s = shard();
            cast(&mut s);
            match reason {
                "death" => s.players.get_mut("owner").unwrap().c.health = 0.0,
                "lift" => {
                    s.players.get_mut("owner").unwrap().c.position = [0.0, 0.0, -80.0];
                    s.action("owner", &json!({"type":"lift","id":"commons-lift"}));
                }
                "disconnect" => {
                    s.players.remove("owner");
                }
                _ => s.time = 10.0,
            }
            s.tick_ghostlines();
            assert!(s.ghostlines.is_empty());
            assert_eq!(s.enemies[0].health, 100.0);
            if let Some(p) = s.players.get("owner") {
                assert_eq!(p.c.gold, 45);
                assert_eq!(p.dash_ready, 99.0);
            }
        }
    }
}
