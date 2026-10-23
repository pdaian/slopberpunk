// Shared street incidents. Progress and combat are owned by the world shard.
// GPL-3.0-or-later.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Rules {
    warning_seconds: f64,
    active_seconds: f64,
    recovery_seconds: f64,
    retry_seconds: f64,
    hold_seconds: f64,
    pub radius: f64,
    trigger_radius: f64,
    hazard_radius: f64,
    hazard_warning_seconds: f64,
    hazard_every_seconds: f64,
    hazard_damage_fraction: f64,
}

#[derive(Deserialize)]
pub(super) struct Entry {
    pub id: String,
    name: String,
    pub anchor: String,
    controls: Vec<String>,
    level: u32,
    enemy: Option<String>,
    spawns: Vec<Vec3>,
    warning: String,
    success: String,
    failure: String,
}

#[derive(Deserialize)]
pub(super) struct Catalog {
    format: String,
    version: u32,
    pub rules: Rules,
    pub entries: Vec<Entry>,
}

impl Catalog {
    pub fn validate(&self, data: &Content) -> io::Result<()> {
        let invalid = || io::Error::other("Invalid world incidents");
        let r = &self.rules;
        if self.format != "sloperberpunk-world-events"
            || self.version != 1
            || self.entries.is_empty()
            || self.entries.len() > 12
            || ![
                r.warning_seconds,
                r.active_seconds,
                r.recovery_seconds,
                r.retry_seconds,
                r.hold_seconds,
                r.radius,
                r.trigger_radius,
                r.hazard_radius,
                r.hazard_warning_seconds,
                r.hazard_every_seconds,
            ]
            .iter()
            .all(|n| n.is_finite() && *n > 0.0 && *n <= 600.0)
            || r.active_seconds <= r.hold_seconds + r.warning_seconds
            || r.hazard_warning_seconds >= r.hazard_every_seconds
            || r.hazard_radius >= r.radius
            || r.radius >= r.trigger_radius
            || !(0.0..=0.25).contains(&r.hazard_damage_fraction)
        {
            return Err(invalid());
        }
        let world = World::new(&data.map);
        let mut ids = HashSet::new();
        for e in &self.entries {
            let Some(anchor) = data.map.landmarks.iter().find(|l| l.id == e.anchor) else {
                return Err(invalid());
            };
            if !ids.insert(&e.id)
                || e.id.is_empty()
                || e.name.is_empty()
                || e.warning.is_empty()
                || e.success.is_empty()
                || e.failure.is_empty()
                || e.level > 60
                || e.controls.len() != 2
                || e.controls[0] == e.controls[1]
                || !e.controls.contains(&e.anchor)
                || e.enemy
                    .as_ref()
                    .is_some_and(|id| !data.enemies.iter().any(|v| text(&v["id"]) == id))
                || e.spawns.len() != if e.enemy.is_some() { 2 } else { 0 }
            {
                return Err(invalid());
            }
            let mut positions = e.spawns.clone();
            for id in &e.controls {
                let Some(site) = data.map.landmarks.iter().find(|l| &l.id == id) else {
                    return Err(invalid());
                };
                positions.push(site.position);
            }
            for p in positions {
                if !p.iter().all(|n| n.is_finite())
                    || dist(p, anchor.position) > 120.0
                    || (p[1] - anchor.position[1]).abs() > 0.1
                    || world.collides(p, 0.65)
                    || (world.floor(p[0], p[2], p[1] + 0.1, p[1] - 0.2) - p[1]).abs() > 0.1
                {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
}

#[derive(Default, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum Phase {
    #[default]
    Idle,
    Warning,
    Active,
    Recovery,
    Failed,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Hazard {
    position: Vec3,
    radius: f64,
    hits_at: f64,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Incident {
    phase: Phase,
    cycle: u64,
    deadline: f64,
    repaired: HashSet<String>,
    hold: f64,
    hazard: Option<Hazard>,
    #[serde(skip)]
    contributors: HashSet<String>,
    #[serde(skip)]
    started: f64,
    #[serde(skip)]
    spawned: bool,
    #[serde(skip)]
    escalated: bool,
    #[serde(skip)]
    next_hazard: f64,
    #[serde(skip)]
    pulse: usize,
}

fn announce(players: &HashMap<String, Player>, position: Vec3, message: &str) {
    for p in players
        .values()
        .filter(|p| p.instance.is_none() && dist(p.c.position, position) < 160.0)
    {
        emit(p, json!({"type":"worldEvent","text":message}));
    }
}

fn spawn(
    enemies: &mut Vec<Enemy>,
    e: &Entry,
    state: &Incident,
    data: &Content,
    time: f64,
    wave: usize,
) {
    let Some(template) = e
        .enemy
        .as_ref()
        .and_then(|id| data.enemies.iter().find(|v| text(&v["id"]) == id))
    else {
        return;
    };
    // A fixed budget per incident; these machines never respawn or grant kill rewards.
    for (i, &position) in e
        .spawns
        .iter()
        .take(if wave == 0 { 2 } else { 1 })
        .enumerate()
    {
        let health = num(&template["health"]) * 0.65 + f64::from(e.level) * 8.0;
        enemies.push(Enemy {
            id: format!("incident-{}-{}-{wave}-{i}", e.id, state.cycle),
            event: Some(e.id.clone()),
            instance: None,
            kind: text(&template["id"]).into(),
            name: format!("{} · enemy machine", e.name),
            model: text(&template["model"]).into(),
            color: text(&template["color"]).into(),
            position,
            home: position,
            level: e.level,
            health,
            max_health: health,
            yaw: 0.0,
            damage: num(&template["damage"]) * 0.65,
            speed: num(&template["speed"]),
            attack_at: time + 2.0,
            stun_until: 0.0,
            exposed_until: 0.0,
            respawn_at: f64::MAX,
            aggro: None,
        });
    }
}

impl Shard {
    pub(super) fn world_event_snapshot(&self, p: &Player) -> Vec<Value> {
        if p.instance.is_some() {
            return Vec::new();
        }
        self.content
            .world_events
            .entries
            .iter()
            .zip(&self.world_events)
            .map(|(entry, state)| json!({"id":entry.id,"state":state}))
            .collect()
    }

    pub(super) fn world_event_action(&mut self, id: &str, value: &Value) {
        let Some(p) = self.players.get_mut(id) else {
            return;
        };
        if p.instance.is_some() || p.c.health <= 0.0 || self.time - p.last_interact < 1.0 {
            return;
        }
        let Some(index) = self
            .content
            .world_events
            .entries
            .iter()
            .position(|e| e.id == text(&value["id"]))
        else {
            return;
        };
        let entry = &self.content.world_events.entries[index];
        let state = &mut self.world_events[index];
        let site = text(&value["site"]);
        if state.phase != Phase::Active
            || self.time >= state.deadline
            || value["cycle"].as_u64() != Some(state.cycle)
        {
            return;
        }
        let Some(site) = self
            .content
            .map
            .landmarks
            .iter()
            .find(|l| l.id == site && entry.controls.contains(&l.id))
        else {
            return;
        };
        if dist(p.c.position, site.position) >= self.content.r("interactionRadius")
            || !self.world.visible(p.c.position, site.position)
        {
            notice(p, "Move closer to the marked repair control.");
            return;
        }
        p.last_interact = self.time;
        if state.repaired.insert(site.id.clone()) {
            p.c.revision += 1;
            state.contributors.insert(id.to_owned());
            progress(p, &self.content, "interact", &site.id);
            notice(
                p,
                &format!(
                    "{} repaired. Check the emergency tracker for your next step.",
                    site.name
                ),
            );
        } else {
            notice(
                p,
                "This control is repaired. Defeat any enemy machines and stay inside the marked ring.",
            );
        }
    }

    pub(super) fn tick_world_events(&mut self) {
        let data = self.content.clone();
        let r = &data.world_events.rules;
        for (entry, state) in data.world_events.entries.iter().zip(&mut self.world_events) {
            let anchor = data
                .map
                .landmarks
                .iter()
                .find(|l| l.id == entry.anchor)
                .expect("validated incident anchor")
                .position;
            match state.phase {
                Phase::Idle => {
                    if self.players.values().any(|p| {
                        p.instance.is_none()
                            && p.c.health > 0.0
                            && (p.c.position[1] - anchor[1]).abs() < 6.0
                            && dist(p.c.position, anchor) < r.trigger_radius
                    }) {
                        *state = Incident {
                            phase: Phase::Warning,
                            cycle: state.cycle + 1,
                            deadline: self.time + r.warning_seconds,
                            ..Incident::default()
                        };
                        announce(&self.players, anchor, &entry.warning);
                    }
                }
                Phase::Warning if self.time >= state.deadline => {
                    state.phase = Phase::Active;
                    state.started = self.time;
                    state.deadline = self.time + r.active_seconds;
                    state.next_hazard = self.time;
                    announce(
                        &self.players,
                        anchor,
                        &format!(
                            "{} · repair both marked controls, then stay inside the marked ring.",
                            entry.name
                        ),
                    );
                }
                Phase::Active => {
                    if self.time >= state.deadline {
                        state.phase = Phase::Failed;
                        state.deadline = self.time + r.retry_seconds;
                        state.hazard = None;
                        self.enemies.retain(|e| e.event.as_ref() != Some(&entry.id));
                        announce(&self.players, anchor, &entry.failure);
                        continue;
                    }
                    if entry.enemy.is_some() {
                        if !state.spawned && !state.repaired.is_empty() {
                            spawn(&mut self.enemies, entry, state, &data, self.time, 0);
                            state.spawned = true;
                            announce(
                                &self.players,
                                anchor,
                                "Enemy machines are coming. Defeat them to finish the repair.",
                            );
                        }
                        if !state.escalated && self.time - state.started >= r.active_seconds / 2.0 {
                            spawn(&mut self.enemies, entry, state, &data, self.time, 1);
                            state.escalated = true;
                            announce(
                                &self.players,
                                anchor,
                                "Another enemy machine has arrived. Defeat it to finish the repair.",
                            );
                        }
                    } else {
                        if let Some(hazard) =
                            state.hazard.as_ref().filter(|h| self.time >= h.hits_at)
                        {
                            for p in self.players.values_mut().filter(|p| {
                                p.instance.is_none()
                                    && p.c.health > 0.0
                                    && (p.c.position[1] - hazard.position[1]).abs() < 6.0
                                    && (p.c.position[0] - hazard.position[0])
                                        .hypot(p.c.position[2] - hazard.position[2])
                                        <= hazard.radius
                                    && self.world.visible(p.c.position, hazard.position)
                            }) {
                                let damage = (Stats::new(&p.c, &data).health
                                    * r.hazard_damage_fraction)
                                    .round();
                                let damage = damage * (1.0 - Stats::new(&p.c, &data).armor);
                                let absorbed = p.shield.min(damage);
                                p.shield -= absorbed;
                                p.c.health = (p.c.health - damage + absorbed).max(0.0);
                                p.last_combat = self.time;
                                p.dirty = true;
                                emit(p, json!({"type":"hurt","amount":damage-absorbed}));
                                if p.c.health <= 0.0 {
                                    death::fallen(p, &data, self.time);
                                }
                            }
                            state.hazard = None;
                        }
                        if self.time >= state.next_hazard {
                            let site = &entry.controls[state.pulse % entry.controls.len()];
                            let position = data
                                .map
                                .landmarks
                                .iter()
                                .find(|l| &l.id == site)
                                .unwrap()
                                .position;
                            state.hazard = Some(Hazard {
                                position,
                                radius: r.hazard_radius,
                                hits_at: self.time + r.hazard_warning_seconds,
                            });
                            state.pulse += 1;
                            state.next_hazard = self.time + r.hazard_every_seconds;
                        }
                    }
                    let defenders: Vec<_> = self
                        .players
                        .values()
                        .filter(|p| {
                            p.instance.is_none()
                                && p.c.health > 0.0
                                && dist(p.c.position, anchor) <= r.radius
                                && self.world.visible(p.c.position, anchor)
                        })
                        .map(|p| p.c.id.clone())
                        .collect();
                    let contested = self
                        .enemies
                        .iter()
                        .any(|e| e.event.as_ref() == Some(&entry.id) && e.health > 0.0);
                    if state.repaired.len() == entry.controls.len()
                        && !contested
                        && !defenders.is_empty()
                    {
                        state.hold = (state.hold + 0.05).min(r.hold_seconds);
                        state.contributors.extend(defenders);
                    } else {
                        state.hold = (state.hold - 0.1).max(0.0);
                    }
                    if state.hold >= r.hold_seconds {
                        state.phase = Phase::Recovery;
                        state.deadline = self.time + r.recovery_seconds;
                        state.hazard = None;
                        self.enemies.retain(|e| e.event.as_ref() != Some(&entry.id));
                        for p in self.players.values_mut().filter(|p| {
                            state.contributors.contains(&p.c.id)
                                && p.instance.is_none()
                                && p.c.health > 0.0
                                && (p.c.position[1] - anchor[1]).abs() < 6.0
                                && dist(p.c.position, anchor) < 120.0
                        }) {
                            progress(p, &data, "event", &entry.id);
                        }
                        announce(&self.players, anchor, &entry.success);
                    }
                }
                Phase::Recovery | Phase::Failed if self.time >= state.deadline => {
                    state.phase = Phase::Idle;
                    state.contributors.clear();
                }
                _ => {}
            }
            // Do not retain disconnected character IDs for the duration of a busy street's life.
            state
                .contributors
                .retain(|id| self.players.contains_key(id));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Shard {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let data = Arc::new(Content::load(&manifest.join("../client")).unwrap());
        // Existing read-only lease and an in-memory identity; never create runtime files.
        let root = manifest.join("incident-in-memory-test-unused");
        let db = Arc::new(Database {
            signer: SigningIdentity::load(&root).unwrap(),
            root,
            mutation: Mutex::new(()),
            _lease: File::open(manifest.join("../LICENSE")).unwrap(),
            social: Mutex::new(SocialState::default()),
            write_failed: std::sync::atomic::AtomicBool::new(false),
        });
        let (saves, _) = mpsc::channel(1);
        let mut s = Shard::new(data, saves, 0, db);
        s.enemies.clear();
        s.seed = 87421;
        s
    }
    fn add(s: &mut Shard, id: &str, position: Vec3) {
        let c: Character = serde_json::from_value(json!({"version":2,"id":id,"name":"Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":position,"yaw":0,"health":120,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        let (output, _) = mpsc::channel(64);
        s.players.insert(
            id.into(),
            Player {
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
            },
        );
    }
    fn advance(s: &mut Shard, seconds: f64) {
        for _ in 0..(seconds * 20.0).ceil() as usize {
            s.time += 0.05;
            s.tick_world_events();
        }
    }
    fn site(s: &Shard, id: &str) -> Vec3 {
        s.content
            .map
            .landmarks
            .iter()
            .find(|l| l.id == id)
            .unwrap()
            .position
    }
    fn repair(s: &mut Shard, player: &str, index: usize, control: &str) {
        let position = site(s, control);
        s.players.get_mut(player).unwrap().c.position = position;
        s.time += 1.01;
        s.action(player, &json!({"type":"worldEvent","id":s.content.world_events.entries[index].id,"cycle":s.world_events[index].cycle,"site":control}));
    }
    fn start(s: &mut Shard, index: usize) {
        s.tick_world_events();
        assert!(s.world_events[index].phase == Phase::Warning);
        s.time = s.world_events[index].deadline;
        s.tick_world_events();
        assert!(s.world_events[index].phase == Phase::Active);
    }

    #[test]
    fn ordered_steps_persist_and_rewards_require_the_final_handover() {
        let mut s = fixture();
        let giver = s
            .content
            .npcs
            .iter()
            .find(|n| n.id == "iri")
            .unwrap()
            .position;
        add(&mut s, "runner", giver);
        s.action(
            "runner",
            &json!({"type":"quest","id":"relay-00","operation":"accept"}),
        );
        let p = s.players.get_mut("runner").unwrap();
        progress(p, &s.content, "event", "water-lockout");
        progress(p, &s.content, "interact", "relay-node");
        assert_eq!(p.c.quest_stages["relay-00"].index, 0);
        progress(p, &s.content, "interact", "market");
        progress(p, &s.content, "interact", "market");
        assert_eq!(p.c.quest_stages["relay-00"].index, 1);
        s.action(
            "runner",
            &json!({"type":"quest","id":"relay-00","operation":"complete","choice":"uphold"}),
        );
        assert_eq!(s.players["runner"].c.gold, 45);
        let p = s.players.get_mut("runner").unwrap();
        progress(p, &s.content, "event", "water-lockout");
        let saved: StoredCharacter =
            serde_json::from_value(serde_json::to_value(saved_player(p, s.time)).unwrap()).unwrap();
        assert_eq!(saved.character.quest_stages["relay-00"].index, 2);
        assert_eq!(saved.character.active_quests["relay-00"], 0);
        p.c = saved.character;
        progress(p, &s.content, "interact", "relay-node");
        assert_eq!(p.c.active_quests["relay-00"], 1);
        // Neither a missing choice nor a forged one can consume a ready contract.
        for choice in ["", "forged", "restitution"] {
            s.action(
                "runner",
                &json!({"type":"quest","id":"relay-00","operation":"complete","choice":choice}),
            );
            assert_eq!(s.players["runner"].c.gold, 45);
            assert_eq!(s.players["runner"].c.active_quests["relay-00"], 1);
            assert!(s.players["runner"].c.morality.records.is_empty());
        }
        s.players.get_mut("runner").unwrap().c.position = [1000.0, 0.0, 1000.0];
        s.action(
            "runner",
            &json!({"type":"quest","id":"relay-00","operation":"complete","choice":"uphold"}),
        );
        assert!(s.players["runner"].c.morality.records.is_empty());
        s.players.get_mut("runner").unwrap().c.position = giver;
        for (health, instance) in [(0.0, None), (100.0, Some(7))] {
            let p = s.players.get_mut("runner").unwrap();
            p.c.health = health;
            p.instance = instance;
            s.action(
                "runner",
                &json!({"type":"quest","id":"relay-00","operation":"complete","choice":"uphold"}),
            );
            assert!(s.players["runner"].c.morality.records.is_empty());
            assert_eq!(s.players["runner"].c.gold, 45);
        }
        s.players.get_mut("runner").unwrap().instance = None;
        s.action(
            "runner",
            &json!({"type":"quest","id":"relay-00","operation":"complete","choice":"uphold"}),
        );
        let gold = s.players["runner"].c.gold;
        assert_eq!(gold, 67); // 45 carried + floor(30 * 75%); XP is unchanged.
        assert_eq!(
            s.players["runner"].c.morality.records["relay-00"].choice,
            "uphold"
        );
        assert_eq!(s.players["runner"].c.morality.imprints["shelter"], 1);
        assert!(s.players["runner"].c.quest_stages.is_empty());
        s.action(
            "runner",
            &json!({"type":"quest","id":"relay-00","operation":"complete","choice":"redirect"}),
        );
        assert_eq!(s.players["runner"].c.gold, gold);
        assert_eq!(
            s.players["runner"].c.morality.records["relay-00"].choice,
            "uphold"
        );
    }

    #[test]
    fn legacy_contracts_and_dead_or_instanced_players_are_safe() {
        let mut s = fixture();
        add(&mut s, "old", [0.0; 3]);
        let p = s.players.get_mut("old").unwrap();
        p.c.active_quests.insert("relay-00".into(), 0);
        p.c.health = 0.0;
        progress(p, &s.content, "interact", "market");
        assert_eq!(p.c.active_quests["relay-00"], 0);
        p.c.health = 120.0;
        p.instance = Some(1);
        progress(p, &s.content, "interact", "market");
        assert_eq!(p.c.active_quests["relay-00"], 0);
        p.instance = None;
        progress(p, &s.content, "interact", "market");
        assert_eq!(p.c.active_quests["relay-00"], 1);
        assert!(p.c.quest_stages.is_empty());
    }

    #[test]
    fn hold_steps_only_advance_for_living_nearby_world_players() {
        let mut s = fixture();
        add(&mut s, "runner", [0.0; 3]);
        let position = site(&s, "commons-water");
        let p = s.players.get_mut("runner").unwrap();
        p.c.active_quests.insert("neighborhood-market-02".into(), 0);
        p.c.quest_stages.insert(
            "neighborhood-market-02".into(),
            quests::Stage {
                index: 1,
                progress: 0,
                ..quests::Stage::default()
            },
        );
        quests::tick(p, &s.content, &s.world);
        assert_eq!(p.c.quest_stages["neighborhood-market-02"].progress, 0);
        p.c.position = position;
        for _ in 0..19 {
            quests::tick(p, &s.content, &s.world);
        }
        assert_eq!(p.c.quest_stages["neighborhood-market-02"].progress, 0);
        quests::tick(p, &s.content, &s.world);
        assert_eq!(p.c.quest_stages["neighborhood-market-02"].progress, 1);
        p.c.health = 0.0;
        quests::tick(p, &s.content, &s.world);
        p.c.health = 120.0;
        p.instance = Some(1);
        quests::tick(p, &s.content, &s.world);
        assert_eq!(p.c.quest_stages["neighborhood-market-02"].progress, 1);
    }

    #[test]
    fn incidents_start_without_quests_and_reject_remote_stale_dead_and_dungeon_repairs() {
        let mut s = fixture();
        let position = site(&s, "commons-water");
        add(&mut s, "runner", position);
        start(&mut s, 0);
        let command = json!({"type":"worldEvent","id":"water-lockout","cycle":s.world_events[0].cycle,"site":"commons-water"});
        s.players.get_mut("runner").unwrap().c.position = [900.0, 0.0, 0.0];
        s.action("runner", &command);
        s.players.get_mut("runner").unwrap().c.position = position;
        let mut stale = command.clone();
        stale["cycle"] = json!(0);
        s.action("runner", &stale);
        s.players.get_mut("runner").unwrap().c.health = 0.0;
        s.action("runner", &command);
        s.players.get_mut("runner").unwrap().c.health = 120.0;
        s.players.get_mut("runner").unwrap().instance = Some(42);
        s.action("runner", &command);
        assert!(s.world_event_snapshot(&s.players["runner"]).is_empty());
        assert!(s.world_events[0].repaired.is_empty());
        s.players.get_mut("runner").unwrap().instance = None;
        s.action("runner", &command);
        s.action("runner", &command);
        assert_eq!(s.world_events[0].repaired.len(), 1);
    }

    #[test]
    fn shared_defense_requires_repairs_and_clearance_and_credits_present_contributors() {
        let mut s = fixture();
        let position = site(&s, "commons-water");
        for id in ["a", "b", "spectator"] {
            add(&mut s, id, position);
            let c = &mut s.players.get_mut(id).unwrap().c;
            c.active_quests.insert("relay-00".into(), 0);
            c.quest_stages.insert(
                "relay-00".into(),
                quests::Stage {
                    index: 1,
                    progress: 0,
                    ..quests::Stage::default()
                },
            );
        }
        s.players.get_mut("spectator").unwrap().c.position = [900.0, 0.0, 0.0];
        start(&mut s, 0);
        repair(&mut s, "a", 0, "lantern-kitchen");
        repair(&mut s, "b", 0, "commons-water");
        advance(&mut s, 1.0);
        assert_eq!(s.enemies.len(), 2);
        assert_eq!(s.world_events[0].hold, 0.0);
        for e in &mut s.enemies {
            e.health = 0.0;
        }
        s.players.get_mut("a").unwrap().c.position = position;
        advance(&mut s, 13.0);
        assert!(s.world_events[0].phase == Phase::Recovery);
        assert!(s.enemies.is_empty());
        for id in ["a", "b"] {
            assert_eq!(s.players[id].c.quest_stages["relay-00"].index, 2);
            assert_eq!(s.players[id].c.gold, 45);
        }
        assert_eq!(s.players["spectator"].c.quest_stages["relay-00"].index, 1);
        advance(&mut s, 2.0);
        assert_eq!(s.players["a"].c.quest_stages["relay-00"].index, 2);
    }

    #[test]
    fn escalation_is_bounded_and_failures_clear_enemies_then_retry() {
        let mut s = fixture();
        let position = site(&s, "commons-water");
        add(&mut s, "runner", position);
        start(&mut s, 0);
        repair(&mut s, "runner", 0, "commons-water");
        advance(&mut s, 80.0);
        assert_eq!(s.enemies.len(), 3);
        advance(&mut s, 10.0);
        assert_eq!(s.enemies.len(), 3);
        let cycle = s.world_events[0].cycle;
        s.time = s.world_events[0].deadline;
        s.tick_world_events();
        assert!(s.world_events[0].phase == Phase::Failed);
        assert!(s.enemies.is_empty());
        s.time = s.world_events[0].deadline;
        s.tick_world_events();
        s.tick_world_events();
        assert!(s.world_events[0].phase == Phase::Warning);
        assert_eq!(s.world_events[0].cycle, cycle + 1);
        assert!(s.world_events[0].repaired.is_empty());
    }

    #[test]
    fn hazards_warn_before_damage_respect_shields_and_exclude_other_elevations_and_instances() {
        let mut s = fixture();
        let position = site(&s, "glass-witness");
        for id in ["runner", "above", "dungeon"] {
            add(&mut s, id, position);
        }
        s.players.get_mut("above").unwrap().c.position[1] += 24.0;
        s.players.get_mut("dungeon").unwrap().instance = Some(7);
        s.players.get_mut("runner").unwrap().shield = 5.0;
        start(&mut s, 1);
        advance(&mut s, 1.0);
        let hits = s.world_events[1].hazard.as_ref().unwrap().hits_at;
        assert_eq!(s.players["runner"].c.health, 120.0);
        s.time = hits;
        s.tick_world_events();
        // Afterborn maximum health is 140: a 17-point pulse consumes the 5-point shield.
        assert_eq!(s.players["runner"].c.health, 108.0);
        assert_eq!(s.players["above"].c.health, 120.0);
        assert_eq!(s.players["dungeon"].c.health, 120.0);
        assert!(s.world_events[1].hazard.is_none());
    }

    #[test]
    fn incident_machines_never_award_kill_progress_or_respawn() {
        let mut s = fixture();
        let position = site(&s, "commons-water");
        add(&mut s, "runner", position);
        start(&mut s, 0);
        repair(&mut s, "runner", 0, "commons-water");
        advance(&mut s, 1.0);
        let p = s.players.get_mut("runner").unwrap();
        p.c.active_quests.insert("relay-03".into(), 0);
        let mut ability = s
            .content
            .abilities
            .iter()
            .find(|a| a.id == "arc")
            .unwrap()
            .clone();
        ability.power = 100000.0;
        for _ in 0..20 {
            damage_enemy(
                p,
                &mut s.enemies[0],
                &ability,
                &s.content,
                s.time,
                &mut s.seed,
                position,
                1.0,
            );
        }
        assert_eq!(s.enemies[0].health, 0.0);
        assert_eq!(p.c.xp, 0);
        assert_eq!(p.c.gold, 45);
        assert_eq!(p.c.active_quests["relay-03"], 0);
        s.enemies[0].respawn_at = 0.0;
        s.tick();
        assert_eq!(s.enemies[0].health, 0.0);
    }
}
