// Global expedition queue and private encounters. No client-supplied progress or rewards.
// GPL-3.0-or-later. See LICENSE.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Rules {
    ready_seconds: f64,
    vote_seconds: f64,
    max_run_seconds: f64,
    pub arena: Vec3,
    pub arena_radius: f64,
    recovery_position: Vec3,
    recovery_seconds: f64,
    recovery_fraction: f64,
    revives_per_encounter: u32,
    pulse_seconds: f64,
    warning_seconds: f64,
    pulse_fraction: f64,
    enemy_health_per_player: f64,
    enemy_health_per_level: f64,
    pub enemy_damage_fraction: f64,
}
#[derive(Clone, Deserialize)]
struct Evidence {
    id: String,
    name: String,
    position: Vec3,
    text: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Chapter {
    id: String,
    name: String,
    briefing: String,
    boss: String,
    enemy: String,
    health_multiplier: f64,
    pattern: String,
    warning: String,
    evidence: Vec<Evidence>,
    reveal: String,
}
#[derive(Clone, Deserialize)]
struct Choice {
    id: String,
    label: String,
    cost: String,
    ending: String,
}
#[derive(Clone, Deserialize)]
struct Decision {
    question: String,
    choices: Vec<Choice>,
    deferred: String,
}
#[derive(Clone, Deserialize)]
pub(super) struct Definition {
    id: String,
    name: String,
    players: usize,
    level: u32,
    venue: String,
    color: String,
    motif: String,
    premise: String,
    chapters: Vec<Chapter>,
    decision: Decision,
    reward: Reward,
    production: Value,
}
#[derive(Clone, Deserialize)]
pub(super) struct Catalog {
    version: u32,
    pub rules: Rules,
    entries: Vec<Definition>,
}
fn identifier(s: &str) -> bool {
    (2..=64).contains(&s.len())
        && s.as_bytes()[0].is_ascii_lowercase()
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
impl Catalog {
    pub(super) fn choice_ids(&self) -> impl Iterator<Item = (&str, Vec<&str>)> {
        self.entries.iter().map(|d| {
            (
                d.id.as_str(),
                d.decision.choices.iter().map(|c| c.id.as_str()).collect(),
            )
        })
    }
    pub fn validate(&self, data: &Content) -> io::Result<()> {
        let invalid = || io::Error::other("Invalid dungeon content in dungeons.json");
        let r = &self.rules;
        let positive = [
            r.ready_seconds,
            r.vote_seconds,
            r.max_run_seconds,
            r.arena_radius,
            r.recovery_seconds,
            r.recovery_fraction,
            r.pulse_seconds,
            r.warning_seconds,
            r.pulse_fraction,
            r.enemy_health_per_player,
            r.enemy_health_per_level,
            r.enemy_damage_fraction,
        ];
        if self.version != 1
            || self.entries.is_empty()
            || self.entries.len() > 32
            || positive.iter().any(|n| !n.is_finite() || *n <= 0.0)
            || r.arena
                .iter()
                .chain(r.recovery_position.iter())
                .any(|v| !v.is_finite())
            || r.arena[1] != 0.0
            || r.recovery_position[1] != 0.0
            || !(20.0..=40.0).contains(&r.arena_radius)
            || r.arena[0].abs() + r.arena_radius >= data.map.bounds
            || r.arena[2].abs() + r.arena_radius >= data.map.bounds
            || dist(r.arena, r.recovery_position) >= r.arena_radius
            || !(10.0..=120.0).contains(&r.ready_seconds)
            || !(30.0..=300.0).contains(&r.vote_seconds)
            || r.max_run_seconds < r.vote_seconds
            || r.max_run_seconds > 7200.0
            || r.warning_seconds < 3.0
            || r.warning_seconds >= r.pulse_seconds
            || r.pulse_seconds > 30.0
            || r.recovery_seconds < 1.0
            || r.recovery_fraction > 1.0
            || r.pulse_fraction >= 1.0
            || r.enemy_damage_fraction >= 0.1
            || !(1..=5).contains(&r.revives_per_encounter)
        {
            return Err(invalid());
        }
        let world = World::new(&data.map);
        // The arena is a clear ground-level square, outside the generated city.
        if world.cells.values().any(|b| {
            (b.x - r.arena[0]).abs() < b.width / 2.0 + r.arena_radius + 1.0
                && (b.z - r.arena[2]).abs() < b.depth / 2.0 + r.arena_radius + 1.0
        }) {
            return Err(invalid());
        }
        let mut ids = HashSet::new();
        for d in &self.entries {
            if !identifier(&d.id)
                || !ids.insert(&d.id)
                || !(1..=8).contains(&d.players)
                || d.level > data.r("levelCap") as u32
                || [&d.name, &d.venue, &d.premise]
                    .iter()
                    .any(|s| s.trim().is_empty())
                || d.color.len() != 7
                || !d.color.starts_with('#')
                || !d.color[1..].bytes().all(|b| b.is_ascii_hexdigit())
                || !["bells", "ferry", "court", "orchard", "theatre", "harbor"]
                    .contains(&d.motif.as_str())
                || d.chapters.is_empty()
                || d.chapters.len() > 8
                || !d.production.is_object()
                || d.reward.xp == 0
                || d.reward.xp > 100000
                || d.reward.gold == 0
                || d.reward.gold > 10000
            {
                return Err(invalid());
            }
            let mut chapters = HashSet::new();
            for c in &d.chapters {
                if !identifier(&c.id)
                    || !chapters.insert(&c.id)
                    || [&c.name, &c.briefing, &c.boss, &c.warning, &c.reveal]
                        .iter()
                        .any(|s| s.trim().is_empty())
                    || !data.enemies.iter().any(|e| text(&e["id"]) == c.enemy)
                    || !["lanes", "ring", "cross"].contains(&c.pattern.as_str())
                    || !c.health_multiplier.is_finite()
                    || !(1.0..=4.0).contains(&c.health_multiplier)
                    || c.evidence.len() != 2
                {
                    return Err(invalid());
                }
                let mut evidence = HashSet::new();
                for e in &c.evidence {
                    if !identifier(&e.id)
                        || !evidence.insert(&e.id)
                        || e.name.trim().is_empty()
                        || e.text.trim().is_empty()
                        || e.position.iter().any(|v| !v.is_finite())
                        || e.position[1] != 0.0
                        || e.position[0].abs().max(e.position[2].abs()) > r.arena_radius - 3.0
                    {
                        return Err(invalid());
                    }
                }
            }
            let mut choices = HashSet::new();
            if d.decision.question.trim().is_empty()
                || d.decision.deferred.trim().is_empty()
                || d.decision.choices.len() != 2
            {
                return Err(invalid());
            }
            for c in &d.decision.choices {
                if !identifier(&c.id)
                    || c.id == "defer"
                    || !choices.insert(&c.id)
                    || [&c.label, &c.cost, &c.ending]
                        .iter()
                        .any(|s| s.trim().is_empty())
                {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
    fn get(&self, id: &str) -> Option<&Definition> {
        self.entries.iter().find(|d| d.id == id)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct History {
    pub(super) clears: u64,
    ending: String,
}
#[derive(Clone)]
struct Ticket {
    id: String,
    dungeon: String,
    joined: f64,
    order: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Ready,
    Briefing,
    Active,
    Wipe,
    Decision,
    Complete,
}
struct Run {
    id: u64,
    dungeon: String,
    tickets: Vec<Ticket>,
    phase: Phase,
    chapter: usize,
    attempt: u64,
    ready: BTreeSet<String>,
    evidence: BTreeSet<String>,
    signed: BTreeSet<String>,
    votes: BTreeMap<String, String>,
    ending: Option<String>,
    deadline: f64,
    started: f64,
    pulse: u64,
    next_pulse: f64,
    recovery: HashMap<String, f64>,
    revives: HashMap<String, u32>,
}
#[derive(Default)]
pub(super) struct State {
    queue: Vec<Ticket>,
    runs: BTreeMap<u64, Run>,
    sequence: u64,
}
impl State {
    fn run_for(&self, id: &str) -> Option<u64> {
        self.runs
            .values()
            .find(|r| r.tickets.iter().any(|t| t.id == id))
            .map(|r| r.id)
    }
    fn busy(&self, id: &str) -> bool {
        self.queue.iter().any(|t| t.id == id) || self.run_for(id).is_some()
    }
}

fn position(r: &Rules, offset: Vec3) -> Vec3 {
    std::array::from_fn(|i| r.arena[i] + offset[i])
}
fn danger(r: &Rules, c: &Chapter, pulse: u64, p: Vec3) -> bool {
    let x = p[0] - r.arena[0];
    let z = p[2] - r.arena[2];
    match c.pattern.as_str() {
        "lanes" => {
            if pulse % 2 == 0 {
                x >= 0.0
            } else {
                x <= 0.0
            }
        }
        "cross" => x.abs() <= 4.0 || z.abs() <= 4.0,
        _ => x.abs() >= 8.0 || z.abs() >= 8.0,
    }
}
fn relocate(p: &mut Player, where_to: Vec3, data: &Content) {
    p.c.position = where_to;
    p.previous_position = where_to;
    p.c.yaw = 0.0;
    p.input = Movement::default();
    p.velocity = [0.0; 3];
    p.ghost_trail.clear();
    p.grounded = true;
    p.jump_buffer = 0.0;
    p.coyote = 0.0;
    p.dash = 0.0;
    let stats = Stats::new(&p.c, data);
    p.c.health = stats.health;
    p.c.energy = stats.energy;
    p.shield = 0.0;
    p.dead_at = 0.0;
    p.dirty = true;
    p.c.revision += 1;
}

impl Shard {
    pub(super) fn dungeon_queue_allowed(&self, id: &str, value: &Value) -> bool {
        let Some(p) = self.players.get(id) else {
            return false;
        };
        if p.elevator.is_some() {
            notice(
                p,
                "Wait for the elevator to arrive before joining a dungeon.",
            );
            return false;
        }
        let d = self.content.dungeons.get(text(&value["dungeon"]));
        if self.dungeons.busy(id) || p.instance.is_some() {
            notice(p, "Leave your current dungeon or waiting queue first.");
            return false;
        }
        if !d.is_some_and(|d| p.c.level >= d.level)
            || p.c.health <= 0.0
            || self.time - p.last_combat < self.content.rule("combat", "outOfCombatSeconds")
        {
            notice(
                p,
                "Reach the dungeon’s required level and stop fighting before joining the queue.",
            );
            return false;
        }
        true
    }
    // Source shards retain forwarding entries. Sockets and authenticated social/export
    // requests keep their stable home route while one lobby owns the live character.
    pub(super) async fn transfer_to_dungeons(&mut self, id: String, value: Value) {
        if !self.dungeon_queue_allowed(&id, &value) {
            return;
        }
        let Some(lobby) = self.lobby.clone() else {
            return;
        };
        let Some(p) = self.players.remove(&id) else {
            return;
        };
        self.ghostlines.remove(&id);
        let (reply, accepted) = oneshot::channel();
        let command = Command::Transfer {
            player: Box::new(p),
            source_time: self.time,
            request: value,
            reply,
        };
        if let Err(error) = lobby.send(command).await {
            if let Command::Transfer { player, .. } = error.0 {
                notice(
                    &player,
                    "Dungeons are unavailable right now. Try again later.",
                );
                self.players.insert(id, *player);
            }
            return;
        }
        match accepted.await {
            Ok(Ok(())) => {
                self.forwarded.insert(id);
            }
            Ok(Err(p)) => {
                notice(&p, "The dungeon waiting area is full. Try again later.");
                self.players.insert(id, *p);
            }
            Err(_) => {
                eprintln!(
                    "Expedition transfer lost acknowledgement; retaining character lease for {id}"
                );
            }
        }
    }
    pub(super) fn accept_dungeon_transfer(
        &mut self,
        mut p: Box<Player>,
        source_time: f64,
        request: Value,
        reply: oneshot::Sender<Result<(), Box<Player>>>,
    ) {
        if self.players.len() >= self.content.rule("network", "maxPlayersPerShard") as usize
            || self.players.contains_key(&p.c.id)
        {
            let _ = reply.send(Err(p));
            return;
        }
        let shift = self.time - source_time;
        for ready in p.cooldowns.values_mut() {
            *ready += shift;
        }
        p.global_ready += shift;
        p.dash_ready += shift;
        p.shield_until += shift;
        p.last_combat += shift;
        p.dead_at += shift;
        p.last_interact += shift;
        p.last_input = self.time;
        p.input = Movement {
            yaw: p.c.yaw,
            ..Movement::default()
        };
        p.velocity = [0.0; 3];
        p.dash = 0.0;
        p.previous_position = p.c.position;
        p.ghost_trail.clear();
        let id = p.c.id.clone();
        self.players.insert(id.clone(), *p);
        self.dungeon_action(&id, &request);
        let _ = reply.send(Ok(()));
    }
    pub(super) fn dungeon_snapshot(&self, id: &str) -> Value {
        if let Some(key) = self.dungeons.run_for(id) {
            let r = &self.dungeons.runs[&key];
            let members:Vec<_>=r.tickets.iter().filter_map(|t|self.players.get(&t.id)).map(|p|json!({"id":p.c.id,"name":p.c.name,"health":p.c.health,"maxHealth":Stats::new(&p.c,&self.content).health})).collect();
            return json!({"run":{"id":r.id,"dungeon":r.dungeon,"phase":r.phase,"chapter":r.chapter,"attempt":r.attempt,"ready":r.ready,"evidence":r.evidence,"signed":r.signed,"votes":r.votes,"ending":r.ending,"deadline":r.deadline,"started":r.started,"pulse":r.pulse,"nextPulse":r.next_pulse,"recoveryReady":r.recovery.get(id).copied().unwrap_or(0.0),"revivesLeft":r.revives.get(id).copied().unwrap_or(self.content.dungeons.rules.revives_per_encounter),"members":members}});
        }
        if let Some(t) = self.dungeons.queue.iter().find(|t| t.id == id) {
            return json!({"queue":{"dungeon":t.dungeon,"joined":t.joined,"waiting":self.dungeons.queue.iter().filter(|q|q.dungeon==t.dungeon).count(),"required":self.content.dungeons.get(&t.dungeon).map(|d|d.players)}});
        }
        Value::Null
    }
    pub(super) fn leave_dungeon(&mut self, id: &str) {
        self.dungeons.queue.retain(|t| t.id != id);
        let Some(key) = self.dungeons.run_for(id) else {
            return;
        };
        let Some(mut run) = self.dungeons.runs.remove(&key) else {
            return;
        };
        if run.phase == Phase::Ready {
            for t in run.tickets {
                if t.id != id
                    && run.ready.contains(&t.id)
                    && self.players.get(&t.id).is_some_and(|p| p.c.health > 0.0)
                {
                    self.dungeons.queue.push(t);
                }
            }
            self.dungeons.queue.sort_by_key(|t| t.order);
        } else if run.phase == Phase::Complete {
            self.return_runner(id, "Expedition complete. Welcome back to Vesper.");
            run.tickets.retain(|t| t.id != id);
            if !run.tickets.is_empty() {
                self.dungeons.runs.insert(key, run);
            }
        } else {
            self.end_run(
                &run,
                "A player left. The dungeon has ended for everyone. You can join the queue again.",
            );
        }
    }
    fn return_runner(&mut self, id: &str, message: &str) {
        self.ghostlines.remove(id);
        if let Some(p) = self.players.get_mut(id) {
            let destination = p.c.dungeon_return.take().unwrap_or(self.content.map.spawn);
            p.instance = None;
            relocate(p, destination, &self.content);
            notice(p, message);
        }
    }
    fn end_run(&mut self, run: &Run, message: &str) {
        self.enemies.retain(|e| e.instance != Some(run.id));
        for ticket in &run.tickets {
            self.return_runner(&ticket.id, message);
        }
    }
    fn begin_encounter(&mut self, run: &mut Run, d: &Definition) {
        let data = &self.content;
        let rules = &data.dungeons.rules;
        let chapter = &d.chapters[run.chapter];
        run.phase = Phase::Active;
        run.attempt += 1;
        run.ready.clear();
        run.evidence.clear();
        run.signed.clear();
        run.recovery.clear();
        run.revives.clear();
        run.pulse = 0;
        run.next_pulse = self.time + rules.pulse_seconds;
        self.enemies.retain(|e| e.instance != Some(run.id));
        let count = d.players.div_ceil(2);
        let health = (d.players as f64
            * (rules.enemy_health_per_player + f64::from(d.level) * rules.enemy_health_per_level)
            * chapter.health_multiplier
            / count as f64)
            .ceil();
        let template = data
            .enemies
            .iter()
            .find(|e| text(&e["id"]) == chapter.enemy)
            .expect("validated dungeon enemy");
        for i in 0..count {
            let home = position(
                rules,
                [(i as f64 - (count as f64 - 1.0) / 2.0) * 6.0, 0.0, -4.0],
            );
            self.enemies.push(Enemy {
                event: None,
                id: format!("dungeon-{}-{}-{}-{i}", run.id, run.chapter, run.attempt),
                instance: Some(run.id),
                kind: chapter.enemy.clone(),
                name: if count == 1 {
                    chapter.boss.clone()
                } else {
                    format!("{} {}", chapter.boss, i + 1)
                },
                model: text(&template["model"]).to_owned(),
                color: d.color.clone(),
                position: home,
                home,
                level: d.level,
                health,
                max_health: health,
                yaw: 0.0,
                damage: 0.0,
                speed: num(&template["speed"]),
                attack_at: 0.0,
                attack: None,
                last_move: None,
                stun_until: 0.0,
                exposed_until: 0.0,
                respawn_at: f64::INFINITY,
                aggro: None,
            });
        }
    }
    fn finish_dungeon(&mut self, run: &mut Run, d: &Definition) {
        if run.phase != Phase::Decision {
            return;
        }
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for t in &run.tickets {
            *counts
                .entry(
                    run.votes
                        .get(&t.id)
                        .cloned()
                        .unwrap_or_else(|| "defer".into()),
                )
                .or_default() += 1;
        }
        let highest = counts.values().copied().max().unwrap_or(0);
        let winners: Vec<_> = counts
            .iter()
            .filter(|(_, count)| **count == highest)
            .map(|(id, _)| id.clone())
            .collect();
        let ending = if winners.len() == 1 {
            winners[0].clone()
        } else {
            "defer".into()
        };
        // Consume the completion state before granting anything. Retried votes cannot pay again.
        run.phase = Phase::Complete;
        run.ending = Some(ending.clone());
        run.deadline = 0.0;
        for t in &run.tickets {
            if let Some(p) = self.players.get_mut(&t.id) {
                // A runner owns their ballot, even when the crew chooses another ending.
                // Replays retain ordinary expedition rewards but cannot farm moral standing.
                let record = format!("dungeon:{}", d.id);
                if !p.c.morality.records.contains_key(&record) {
                    let choice = run.votes.get(&t.id).map(String::as_str).unwrap_or("defer");
                    let _ = morality::settle(&mut p.c, &self.content, &record, choice);
                }
                let old = p.c.dungeon_history.get(&d.id).map_or(0, |h| h.clears);
                p.c.dungeon_history.insert(
                    d.id.clone(),
                    History {
                        clears: old.saturating_add(1),
                        ending: ending.clone(),
                    },
                );
                let gold = economy::grant_gold(&mut p.c, d.reward.gold);
                let xp = gain_xp(p, &self.content, d.reward.xp);
                p.c.revision += 1;
                p.dirty = true;
                emit(p, json!({"type":"reward","xp":xp,"gold":gold}));
                notice(p, "Dungeon complete. Press G to read your ending.");
            }
        }
    }
    pub(super) fn dungeon_action(&mut self, id: &str, value: &Value) {
        let Some(p) = self.players.get_mut(id) else {
            return;
        };
        p.c.revision += 1;
        let operation = text(&value["operation"]);
        if operation == "queue" {
            if !self.dungeon_queue_allowed(id, value) {
                return;
            }
            self.dungeons.sequence += 1;
            self.dungeons.queue.push(Ticket {
                id: id.to_owned(),
                dungeon: text(&value["dungeon"]).to_owned(),
                joined: self.time,
                order: self.dungeons.sequence,
            });
            self.match_dungeons();
            return;
        }
        if operation == "leave" {
            // Queued tickets have no run token; matched/active runs always require one.
            if self.dungeons.run_for(id).is_none()
                || value["run"].as_u64() == self.dungeons.run_for(id)
            {
                self.leave_dungeon(id);
            }
            return;
        }
        let Some(key) = self.dungeons.run_for(id) else {
            return;
        };
        if value["run"].as_u64() != Some(key) {
            return;
        }
        let Some(mut run) = self.dungeons.runs.remove(&key) else {
            return;
        };
        if value["chapter"].as_u64() == Some(run.chapter as u64)
            && value["attempt"].as_u64() == Some(run.attempt)
        {
            let content = self.content.clone();
            let definition = content
                .dungeons
                .get(&run.dungeon)
                .expect("validated dungeon");
            self.run_action(id, value, &mut run, definition);
        }
        self.dungeons.runs.insert(key, run);
    }
    fn run_action(&mut self, id: &str, value: &Value, run: &mut Run, d: &Definition) {
        let operation = text(&value["operation"]);
        let rules = self.content.dungeons.rules.clone();
        let Some(p) = self.players.get(id) else {
            return;
        };
        if p.c.health <= 0.0 {
            return;
        }
        if operation == "ready" && run.phase == Phase::Ready && self.time < run.deadline {
            run.ready.insert(id.to_owned());
            if run.ready.len() == d.players
                && run
                    .tickets
                    .iter()
                    .all(|t| self.players.get(&t.id).is_some_and(|p| p.c.health > 0.0))
            {
                run.phase = Phase::Briefing;
                run.ready.clear();
                run.deadline = 0.0;
                for t in &run.tickets {
                    self.ghostlines.remove(&t.id);
                    if let Some(p) = self.players.get_mut(&t.id) {
                        elevators::cancel(p);
                        p.instance = Some(run.id);
                        p.c.dungeon_return = Some(self.content.map.spawn);
                        relocate(p, position(&rules, [0.0, 0.0, 14.0]), &self.content);
                        notice(
                            p,
                            "Dungeon ready. Press G to read the first chapter and choose READY.",
                        );
                    }
                }
            }
            return;
        }
        if operation == "begin" && run.phase == Phase::Briefing {
            run.ready.insert(id.to_owned());
            if run.ready.len() == run.tickets.len() {
                self.begin_encounter(run, d);
            }
            return;
        }
        if operation == "vote" && run.phase == Phase::Decision && self.time < run.deadline {
            let choice = text(&value["choice"]);
            if choice == "defer" || d.decision.choices.iter().any(|c| c.id == choice) {
                run.votes.insert(id.to_owned(), choice.to_owned());
                if run.votes.len() == run.tickets.len() {
                    self.finish_dungeon(run, d);
                }
            }
            return;
        }
        if run.phase != Phase::Active {
            return;
        }
        if operation == "interact" {
            let e = d.chapters[run.chapter].evidence.iter().find(|e| {
                e.id == text(&value["target"])
                    && dist(p.c.position, position(&rules, e.position)) < 4.0
            });
            if let Some(e) = e {
                run.evidence.insert(e.id.clone());
                run.signed.insert(id.to_owned());
                notice(
                    p,
                    &format!("Evidence recorded: {}. Read it in Dungeons [G].", e.name),
                );
            }
        } else if operation == "recover" {
            if self.time >= run.recovery.get(id).copied().unwrap_or(0.0)
                && dist(p.c.position, rules.recovery_position) < 4.0
            {
                if let Some(p) = self.players.get_mut(id) {
                    let health = Stats::new(&p.c, &self.content).health;
                    p.c.health = (p.c.health + health * rules.recovery_fraction).min(health);
                    p.dirty = true;
                    emit(p, json!({"type":"sound","name":"heal"}));
                }
                run.recovery
                    .insert(id.to_owned(), self.time + rules.recovery_seconds);
            }
        } else if operation == "revive" {
            let target = text(&value["target"]);
            let count = run
                .revives
                .get(id)
                .copied()
                .unwrap_or(rules.revives_per_encounter);
            let valid = count > 0
                && run.tickets.iter().any(|t| t.id == target)
                && self.players.get(target).is_some_and(|other| {
                    other.instance == Some(run.id)
                        && other.c.health <= 0.0
                        && dist(p.c.position, other.c.position) < 4.0
                });
            if valid {
                if let Some(other) = self.players.get_mut(target) {
                    other.c.health = Stats::new(&other.c, &self.content).health * 0.5;
                    other.dead_at = 0.0;
                    other.dirty = true;
                    other.c.revision += 1;
                    other.velocity = [0.0; 3];
                    other.dash = 0.0;
                    other.previous_position = other.c.position;
                    other.input = Movement {
                        yaw: other.c.yaw,
                        ..Movement::default()
                    };
                    other.ghost_trail.clear();
                    notice(other, "Another player brought you back to life.");
                }
                run.revives.insert(id.to_owned(), count - 1);
            }
        }
    }
    fn match_dungeons(&mut self) {
        self.dungeons.queue.retain(|t| {
            self.players
                .get(&t.id)
                .is_some_and(|p| p.c.health > 0.0 && p.instance.is_none())
        });
        for d in &self.content.dungeons.entries {
            loop {
                let selected: Vec<_> = self
                    .dungeons
                    .queue
                    .iter()
                    .filter(|t| t.dungeon == d.id)
                    .take(d.players)
                    .cloned()
                    .collect();
                if selected.len() != d.players {
                    break;
                }
                let members: HashSet<_> = selected.iter().map(|t| t.id.clone()).collect();
                self.dungeons.queue.retain(|t| !members.contains(&t.id));
                self.dungeons.sequence += 1;
                let id = self.dungeons.sequence;
                for t in &selected {
                    if let Some(p) = self.players.get(&t.id) {
                        notice(
                            p,
                            "Group found. Press G and choose READY TO ENTER to join them.",
                        );
                    }
                }
                self.dungeons.runs.insert(
                    id,
                    Run {
                        id,
                        dungeon: d.id.clone(),
                        tickets: selected,
                        phase: Phase::Ready,
                        chapter: 0,
                        attempt: 0,
                        ready: BTreeSet::new(),
                        evidence: BTreeSet::new(),
                        signed: BTreeSet::new(),
                        votes: BTreeMap::new(),
                        ending: None,
                        deadline: self.time + self.content.dungeons.rules.ready_seconds,
                        started: self.time,
                        pulse: 0,
                        next_pulse: 0.0,
                        recovery: HashMap::new(),
                        revives: HashMap::new(),
                    },
                );
            }
        }
    }
    pub(super) fn tick_dungeons(&mut self) {
        let content = self.content.clone();
        let keys: Vec<_> = self.dungeons.runs.keys().copied().collect();
        for key in keys {
            let Some(mut run) = self.dungeons.runs.remove(&key) else {
                continue;
            };
            let d = content
                .dungeons
                .get(&run.dungeon)
                .expect("validated dungeon");
            let rules = self.content.dungeons.rules.clone();
            if self.time - run.started >= rules.max_run_seconds {
                self.end_run(
                    &run,
                    "The dungeon time limit ran out. Press G to join the queue again.",
                );
                continue;
            }
            if run.phase == Phase::Ready
                && (self.time >= run.deadline
                    || run
                        .tickets
                        .iter()
                        .any(|t| self.players.get(&t.id).is_none_or(|p| p.c.health <= 0.0)))
            {
                for t in run.tickets {
                    if let Some(p) = self.players.get(&t.id) {
                        notice(
                            p,
                            "Not everyone joined in time. Players who accepted keep their place in line.",
                        );
                        if run.ready.contains(&t.id) && p.c.health > 0.0 {
                            self.dungeons.queue.push(t);
                        }
                    }
                }
                self.dungeons.queue.sort_by_key(|t| t.order);
                continue;
            }
            if run.phase == Phase::Decision && self.time >= run.deadline {
                self.finish_dungeon(&mut run, d);
            }
            if run.phase == Phase::Wipe && self.time >= run.deadline {
                for t in &run.tickets {
                    self.ghostlines.remove(&t.id);
                    if let Some(p) = self.players.get_mut(&t.id) {
                        relocate(p, position(&rules, [0.0, 0.0, 14.0]), &self.content);
                    }
                }
                run.phase = Phase::Briefing;
                run.ready.clear();
                run.evidence.clear();
                run.signed.clear();
                run.deadline = 0.0;
            }
            if run.phase == Phase::Active {
                if run
                    .tickets
                    .iter()
                    .all(|t| self.players.get(&t.id).is_none_or(|p| p.c.health <= 0.0))
                {
                    run.phase = Phase::Wipe;
                    run.deadline = self.time + self.content.rule("player", "respawnSeconds");
                    self.enemies.retain(|e| e.instance != Some(key));
                    for t in &run.tickets {
                        self.ghostlines.remove(&t.id);
                    }
                } else {
                    if self.time >= run.next_pulse {
                        for t in &run.tickets {
                            if let Some(p) = self.players.get_mut(&t.id) {
                                if p.c.health > 0.0
                                    && danger(
                                        &rules,
                                        &d.chapters[run.chapter],
                                        run.pulse,
                                        p.c.position,
                                    )
                                {
                                    let damage = (Stats::new(&p.c, &self.content).health
                                        * rules.pulse_fraction)
                                        .round();
                                    let damage =
                                        damage * (1.0 - Stats::new(&p.c, &self.content).armor);
                                    let absorbed = p.shield.min(damage);
                                    p.shield -= absorbed;
                                    p.c.health = (p.c.health - damage + absorbed).max(0.0);
                                    p.last_combat = self.time;
                                    p.dirty = true;
                                    emit(p, json!({"type":"hurt","amount":damage-absorbed}));
                                    if p.c.health <= 0.0 {
                                        p.dead_at = self.time;
                                        emit(p, json!({"type":"death"}));
                                    }
                                }
                            }
                        }
                        run.pulse += 1;
                        run.next_pulse = self.time + rules.pulse_seconds;
                    }
                    if self
                        .enemies
                        .iter()
                        .filter(|e| e.instance == Some(key))
                        .all(|e| e.health <= 0.0)
                        && run.evidence.len() == d.chapters[run.chapter].evidence.len()
                        && run.signed.len() == run.tickets.len()
                        && run
                            .tickets
                            .iter()
                            .any(|t| self.players.get(&t.id).is_some_and(|p| p.c.health > 0.0))
                    {
                        self.enemies.retain(|e| e.instance != Some(key));
                        for t in &run.tickets {
                            self.ghostlines.remove(&t.id);
                            if let Some(p) = self.players.get_mut(&t.id) {
                                let s = Stats::new(&p.c, &self.content);
                                p.c.health = s.health;
                                p.c.energy = s.energy;
                                p.dead_at = 0.0;
                                p.ghost_trail.clear();
                                notice(p, "Chapter complete. Read the discovery in Dungeons [G].");
                            }
                        }
                        if run.chapter + 1 == d.chapters.len() {
                            run.phase = Phase::Decision;
                            run.deadline = self.time + rules.vote_seconds;
                        } else {
                            run.chapter += 1;
                            run.phase = Phase::Briefing;
                            run.ready.clear();
                            run.evidence.clear();
                            run.signed.clear();
                        }
                    }
                }
            }
            self.dungeons.runs.insert(key, run);
        }
        self.match_dungeons();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn shard() -> Shard {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let data = Arc::new(Content::load(&manifest.join("../client")).unwrap());
        // Read-only fixture lease; no database is opened, written, or created.
        let root = manifest.join("dungeons-in-memory-test-unused");
        let db = Arc::new(Database {
            signer: SigningIdentity::load(&root).unwrap(),
            root,
            mutation: Mutex::new(()),
            _lease: File::open(manifest.join("../LICENSE")).unwrap(),
            social: Mutex::new(SocialState::default()),
            write_failed: std::sync::atomic::AtomicBool::new(false),
        });
        let (saves, _) = mpsc::channel(1);
        let mut shard = Shard::new(data, saves, 0, db);
        shard.seed = 87421;
        shard
    }
    fn add(s: &mut Shard, id: &str, race: &str, faction: &str, level: u32) {
        let mut c:Character=serde_json::from_value(json!({"version":2,"id":id,"name":id,"race":race,"faction":faction,"level":level,"xp":0,"gold":45,"position":[0,0,32],"yaw":0,"health":140,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true})).unwrap();
        let stats = Stats::new(&c, &s.content);
        c.health = stats.health;
        c.energy = stats.energy;
        let (output, _) = mpsc::channel(64);
        s.players.insert(
            id.into(),
            Player {
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
            },
        );
    }
    fn command(s: &mut Shard, id: &str, operation: &str, extra: Value) {
        let snapshot = s.dungeon_snapshot(id);
        let r = &snapshot["run"];
        let mut value = json!({"type":"dungeon","operation":operation,"run":r["id"],"chapter":r["chapter"],"attempt":r["attempt"]});
        if let Some(extra) = extra.as_object() {
            for (k, v) in extra {
                value[k] = v.clone();
            }
        }
        s.action(id, &value);
    }
    fn queue(s: &mut Shard, id: &str, dungeon: &str) {
        command(s, id, "queue", json!({"dungeon":dungeon}));
    }
    fn crew(s: &mut Shard, dungeon: &str, n: usize, prefix: &str) -> Vec<String> {
        let ids: Vec<_> = (0..n).map(|i| format!("{prefix}{i}")).collect();
        for id in &ids {
            add(s, id, "human", "relay", 60);
            queue(s, id, dungeon);
        }
        for id in &ids {
            command(s, id, "ready", json!({}));
        }
        ids
    }
    fn begin(s: &mut Shard, ids: &[String]) {
        for id in ids {
            command(s, id, "begin", json!({}));
        }
    }
    fn clear(s: &mut Shard, ids: &[String]) {
        begin(s, ids);
        let run = s.dungeon_snapshot(&ids[0]);
        let key = run["run"]["id"].as_u64().unwrap();
        let chapter = run["run"]["chapter"].as_u64().unwrap() as usize;
        let d = s
            .content
            .dungeons
            .get(text(&run["run"]["dungeon"]))
            .unwrap()
            .clone();
        let rules = s.content.dungeons.rules.clone();
        for id in ids {
            for e in &d.chapters[chapter].evidence {
                s.players.get_mut(id).unwrap().c.position = position(&rules, e.position);
                command(s, id, "interact", json!({"target":e.id}));
            }
        }
        for enemy in s.enemies.iter_mut().filter(|e| e.instance == Some(key)) {
            enemy.health = 0.0;
        }
        s.tick_dungeons();
    }
    #[test]
    fn exact_size_fifo_duplicate_admission_and_stale_ready_are_enforced() {
        let mut s = shard();
        for id in ["first", "second", "third"] {
            add(&mut s, id, "human", "relay", 8);
        }
        queue(&mut s, "first", "borrowed-ferry");
        queue(&mut s, "first", "borrowed-ferry");
        assert_eq!(s.dungeons.queue.len(), 1);
        assert!(s.dungeons.runs.is_empty());
        queue(&mut s, "second", "borrowed-ferry");
        queue(&mut s, "third", "borrowed-ferry");
        let key = s.dungeons.run_for("first").unwrap();
        assert_eq!(
            s.dungeons.runs[&key]
                .tickets
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "second"]
        );
        command(&mut s, "first", "ready", json!({"run":key+1}));
        assert!(s.dungeons.runs[&key].ready.is_empty());
        command(&mut s, "first", "ready", json!({}));
        s.time = s.dungeons.runs[&key].deadline;
        s.tick_dungeons();
        let next = s.dungeons.run_for("first").unwrap();
        assert_ne!(next, key);
        assert_eq!(
            s.dungeons.runs[&next]
                .tickets
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>(),
            vec!["first", "third"]
        );
        assert!(!s.dungeons.busy("second"));
        command(&mut s, "first", "leave", json!({"run":key}));
        assert!(s.dungeons.run_for("first").is_some());
    }
    #[test]
    fn all_lineages_factions_and_duplicate_builds_enter_every_exact_size() {
        let mut s = shard();
        let defs = s.content.dungeons.entries.clone();
        for d in defs {
            for race in ["human", "lattice", "revenant", "bloom"] {
                for faction in ["relay", "covenant", "foundry", "choir"] {
                    let ids: Vec<_> = (0..d.players).map(|i| format!("runner{i}")).collect();
                    for id in &ids {
                        add(&mut s, id, race, faction, d.level);
                        queue(&mut s, id, &d.id);
                    }
                    let key = s.dungeons.run_for(&ids[0]).unwrap();
                    for id in &ids {
                        command(&mut s, id, "ready", json!({}));
                    }
                    assert_eq!(s.dungeons.runs[&key].phase, Phase::Briefing);
                    assert!(ids.iter().all(|id| s.players[id].instance == Some(key)));
                    begin(&mut s, &ids);
                    assert_eq!(
                        s.enemies.iter().filter(|e| e.instance == Some(key)).count(),
                        d.players.div_ceil(2)
                    );
                    s.leave_dungeon(&ids[0]);
                    assert!(!s.dungeons.runs.contains_key(&key));
                    s.players.clear();
                }
            }
        }
    }
    #[test]
    fn instance_isolation_covers_snapshots_attacks_area_healing_and_ghost_contacts() {
        let mut s = shard();
        let a = crew(&mut s, "borrowed-ferry", 2, "alpha");
        let b = crew(&mut s, "borrowed-ferry", 2, "beta");
        begin(&mut s, &a);
        begin(&mut s, &b);
        let ka = s.players[&a[0]].instance;
        let kb = s.players[&b[0]].instance;
        assert_ne!(ka, kb);
        let target = s
            .enemies
            .iter()
            .find(|e| e.instance == kb)
            .unwrap()
            .id
            .clone();
        let hp = s.enemies.iter().find(|e| e.id == target).unwrap().health;
        s.action(&a[0], &json!({"type":"ability","id":"arc","target":target}));
        assert_eq!(
            s.enemies.iter().find(|e| e.id == target).unwrap().health,
            hp
        );
        for p in s.players.values_mut() {
            p.c.health = 20.0;
            p.c.position = [2000.0, 0.0, 0.0];
        }
        s.action(&a[0], &json!({"type":"ability","id":"mend"}));
        assert!(s.players[&a[1]].c.health > 20.0);
        assert_eq!(s.players[&b[0]].c.health, 20.0);
        s.time += 1.0;
        let own = s
            .enemies
            .iter()
            .find(|e| e.instance == ka)
            .unwrap()
            .id
            .clone();
        s.action(&a[0], &json!({"type":"ability","id":"echo","target":own}));
        assert!(
            s.enemies
                .iter()
                .filter(|e| e.instance == kb)
                .all(|e| e.health == e.max_health)
        );
        // Record an echo for A, place only a B runner at its crossing point.
        let data = s.content.clone();
        let p = s.players.get_mut(&a[0]).unwrap();
        for i in 0..=30 {
            p.ghost_trail
                .record(i as f64 * 0.1, [2000.0, 0.0, 15.0 - i as f64], 46.0, &data);
        }
        let ghost = p.ghost_trail.release(&p.c, 3.0, &data).unwrap();
        for id in &a {
            s.players.get_mut(id).unwrap().c.position = [2025.0, 0.0, 25.0];
            s.players.get_mut(id).unwrap().previous_position = [2025.0, 0.0, 25.0];
        }
        for id in &b {
            s.players.get_mut(id).unwrap().c.position = [2000.0, 0.0, 5.0];
            s.players.get_mut(id).unwrap().previous_position = [2000.0, 0.0, 5.0];
        }
        assert!(
            ghost
                .contact(4.0, 0.05, &s.players, &s.world, &s.content)
                .is_none()
        );
        let (tx, mut rx) = mpsc::channel(4);
        s.players.get_mut(&a[0]).unwrap().output = tx;
        s.snapshots();
        let snapshot = rx.try_recv().unwrap();
        assert!(
            snapshot["players"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| !text(&p["id"]).starts_with("beta"))
        );
        assert!(
            snapshot["enemies"]
                .as_array()
                .unwrap()
                .iter()
                .all(|e| e["instance"].as_u64() == ka)
        );
    }
    #[test]
    fn evidence_requires_proximity_and_every_witness_and_wipes_keep_prior_chapters() {
        let mut s = shard();
        let ids = crew(&mut s, "borrowed-ferry", 2, "crew");
        clear(&mut s, &ids);
        let key = s.players[&ids[0]].instance.unwrap();
        assert_eq!(s.dungeons.runs[&key].chapter, 1);
        begin(&mut s, &ids);
        let attempt = s.dungeons.runs[&key].attempt;
        let evidence = s.content.dungeons.get("borrowed-ferry").unwrap().chapters[1]
            .evidence
            .clone();
        s.players.get_mut(&ids[0]).unwrap().c.position = [2000.0, 0.0, 14.0];
        command(
            &mut s,
            &ids[0],
            "interact",
            json!({"target":evidence[0].id}),
        );
        assert!(s.dungeons.runs[&key].evidence.is_empty());
        for e in &evidence {
            s.players.get_mut(&ids[0]).unwrap().c.position =
                position(&s.content.dungeons.rules, e.position);
            command(&mut s, &ids[0], "interact", json!({"target":e.id}));
        }
        for e in s.enemies.iter_mut().filter(|e| e.instance == Some(key)) {
            e.health = 0.0;
        }
        s.tick_dungeons();
        assert_eq!(
            s.dungeons.runs[&key].phase,
            Phase::Active,
            "Both witnesses must sign"
        );
        for id in &ids {
            s.players.get_mut(id).unwrap().c.health = 0.0;
        }
        s.tick_dungeons();
        assert_eq!(s.dungeons.runs[&key].phase, Phase::Wipe);
        s.time = s.dungeons.runs[&key].deadline;
        s.tick_dungeons();
        assert_eq!(s.dungeons.runs[&key].chapter, 1);
        begin(&mut s, &ids);
        command(
            &mut s,
            &ids[0],
            "interact",
            json!({"target":evidence[0].id,"attempt":attempt}),
        );
        assert!(s.dungeons.runs[&key].evidence.is_empty());
        assert_eq!(s.players[&ids[0]].c.gold, 45);
    }
    #[test]
    fn recovery_is_personal_and_revives_are_spatial_bounded_and_non_replayable() {
        let mut s = shard();
        let ids = crew(&mut s, "borrowed-ferry", 2, "crew");
        begin(&mut s, &ids);
        let key = s.players[&ids[0]].instance.unwrap();
        for id in &ids {
            let p = s.players.get_mut(id).unwrap();
            p.c.health = 10.0;
            p.c.position = s.content.dungeons.rules.recovery_position;
            command(&mut s, id, "recover", json!({}));
            assert!(s.players[id].c.health > 10.0);
        }
        let health = s.players[&ids[0]].c.health;
        command(&mut s, &ids[0], "recover", json!({}));
        assert_eq!(s.players[&ids[0]].c.health, health);
        for left in [1, 0] {
            s.players.get_mut(&ids[1]).unwrap().c.health = 0.0;
            command(&mut s, &ids[0], "revive", json!({"target":ids[1]}));
            assert!(s.players[&ids[1]].c.health > 0.0);
            assert_eq!(s.dungeons.runs[&key].revives[&ids[0]], left);
            command(&mut s, &ids[0], "revive", json!({"target":ids[1]}));
            assert_eq!(s.dungeons.runs[&key].revives[&ids[0]], left);
        }
        s.players.get_mut(&ids[1]).unwrap().c.health = 0.0;
        command(&mut s, &ids[0], "revive", json!({"target":ids[1]}));
        assert_eq!(s.players[&ids[1]].c.health, 0.0);
    }
    #[test]
    fn ballots_tie_to_provisional_pay_once_and_do_not_rewrite_dissent() {
        let mut s = shard();
        let ids = crew(&mut s, "borrowed-ferry", 2, "crew");
        for _ in 0..3 {
            clear(&mut s, &ids);
        }
        let key = s.players[&ids[0]].instance.unwrap();
        command(&mut s, &ids[0], "vote", json!({"choice":"publish"}));
        command(&mut s, &ids[1], "vote", json!({"choice":"contact"}));
        assert_eq!(s.dungeons.runs[&key].phase, Phase::Complete);
        assert_eq!(s.dungeons.runs[&key].ending.as_deref(), Some("defer"));
        assert_eq!(s.dungeons.runs[&key].votes[&ids[0]], "publish");
        for id in &ids {
            assert_eq!(s.players[id].c.gold, 195);
            assert_eq!(s.players[id].c.dungeon_history["borrowed-ferry"].clears, 1);
            command(&mut s, id, "vote", json!({"choice":"publish"}));
            assert_eq!(s.players[id].c.gold, 195);
        }
        s.leave_dungeon(&ids[0]);
        assert!(s.dungeons.runs.contains_key(&key));
        assert!(s.players[&ids[0]].instance.is_none());
        s.leave_dungeon(&ids[1]);
        assert!(!s.dungeons.runs.contains_key(&key));
    }
    #[test]
    fn disconnects_end_active_runs_and_return_everyone_without_partial_rewards() {
        let mut s = shard();
        let ids = crew(&mut s, "borrowed-ferry", 2, "crew");
        begin(&mut s, &ids);
        let key = s.players[&ids[0]].instance.unwrap();
        s.leave_dungeon(&ids[0]);
        assert!(s.dungeons.runs.is_empty());
        assert!(s.enemies.iter().all(|e| e.instance != Some(key)));
        for id in &ids {
            assert_eq!(s.players[id].c.position, s.content.map.spawn);
            assert!(s.players[id].instance.is_none());
            assert!(s.players[id].c.dungeon_return.is_none());
            assert!(s.players[id].c.dungeon_history.is_empty());
        }
    }
    #[tokio::test]
    async fn transfer_preserves_cooldowns_ownership_and_stable_home_route() {
        let mut source = shard();
        let mut lobby = shard();
        source.time = 10.0;
        lobby.time = 40.0;
        add(&mut source, "migrant", "bloom", "relay", 8);
        let p = source.players.get_mut("migrant").unwrap();
        p.cooldowns.insert("mend".into(), 18.0);
        p.dash_ready = 12.0;
        p.last_sequence = 88;
        let (tx, mut rx) = mpsc::channel(1);
        source.lobby = Some(tx);
        let host = tokio::spawn(async move {
            if let Some(Command::Transfer {
                player,
                source_time,
                request,
                reply,
            }) = rx.recv().await
            {
                lobby.accept_dungeon_transfer(player, source_time, request, reply);
            }
            lobby
        });
        source
            .transfer_to_dungeons(
                "migrant".into(),
                json!({"type":"dungeon","operation":"queue","dungeon":"borrowed-ferry"}),
            )
            .await;
        let lobby = host.await.unwrap();
        assert!(!source.players.contains_key("migrant"));
        assert!(source.forwarded.contains("migrant"));
        let p = &lobby.players["migrant"];
        assert_eq!(p.owner, "account");
        assert_eq!(p.cooldowns["mend"], 48.0);
        assert_eq!(p.dash_ready, 42.0);
        assert_eq!(p.last_sequence, 88);
        assert_eq!(lobby.dungeons.queue.len(), 1);
    }
    #[tokio::test]
    async fn full_lobby_returns_live_ownership_to_the_source_without_clock_conversion() {
        let mut source = shard();
        let mut lobby = shard();
        source.time = 10.0;
        lobby.time = 100.0;
        Arc::get_mut(&mut lobby.content).unwrap().rules["network"]["maxPlayersPerShard"] = json!(1);
        add(&mut lobby, "resident", "human", "relay", 8);
        add(&mut source, "migrant", "human", "relay", 8);
        source
            .players
            .get_mut("migrant")
            .unwrap()
            .cooldowns
            .insert("mend".into(), 17.0);
        let (tx, mut rx) = mpsc::channel(1);
        source.lobby = Some(tx);
        let host = tokio::spawn(async move {
            if let Some(Command::Transfer {
                player,
                source_time,
                request,
                reply,
            }) = rx.recv().await
            {
                lobby.accept_dungeon_transfer(player, source_time, request, reply);
            }
            lobby
        });
        source
            .transfer_to_dungeons(
                "migrant".into(),
                json!({"type":"dungeon","operation":"queue","dungeon":"borrowed-ferry"}),
            )
            .await;
        let lobby = host.await.unwrap();
        assert!(source.players.contains_key("migrant"));
        assert!(!source.forwarded.contains("migrant"));
        assert!(!lobby.players.contains_key("migrant"));
        assert_eq!(source.players["migrant"].cooldowns["mend"], 17.0);
        assert!(lobby.dungeons.queue.is_empty());
    }
    #[test]
    fn timed_ballots_default_missing_votes_and_serialized_history_preserves_the_reward_receipt() {
        let mut s = shard();
        let ids = crew(&mut s, "borrowed-ferry", 2, "crew");
        for _ in 0..3 {
            clear(&mut s, &ids);
        }
        let key = s.players[&ids[0]].instance.unwrap();
        command(&mut s, &ids[0], "vote", json!({"choice":"publish"}));
        s.time = s.dungeons.runs[&key].deadline;
        command(&mut s, &ids[1], "vote", json!({"choice":"publish"}));
        assert_eq!(s.dungeons.runs[&key].votes.len(), 1);
        s.tick_dungeons();
        assert_eq!(s.dungeons.runs[&key].ending.as_deref(), Some("defer"));
        let stored = saved_player(&s.players[&ids[0]], s.time);
        let decoded: StoredCharacter =
            serde_json::from_value(serde_json::to_value(stored).unwrap()).unwrap();
        assert_eq!(
            decoded.character.dungeon_history["borrowed-ferry"].clears,
            1
        );
        assert_eq!(
            decoded.character.dungeon_history["borrowed-ferry"].ending,
            "defer"
        );
        assert_eq!(decoded.character.gold, 195);
        assert_eq!(decoded.character.dungeon_return, Some(s.content.map.spawn));
    }
}
