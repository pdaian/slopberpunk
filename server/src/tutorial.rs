// Saved, server-authoritative first steps in the Commons training courtyard.
// GPL-3.0-or-later.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum Stage {
    Move,
    Interact,
    Combat,
    Exit,
}

#[derive(Clone, Deserialize)]
pub(super) struct Area {
    pub center: Vec3,
    pub radius: f64,
    pub spawn: Vec3,
    pub beacon: String,
    pub terminal: String,
    pub target: String,
    pub exit: String,
}

impl Area {
    pub fn contains(&self, position: Vec3) -> bool {
        (position[0] - self.center[0]).hypot(position[2] - self.center[2]) <= self.radius
            && (position[1] - self.center[1]).abs() < 6.0
    }
}

pub(super) fn validate(data: &Content) -> io::Result<()> {
    let area = &data.map.tutorial;
    let world = World::new(&data.map);
    let invalid = || io::Error::other("Invalid tutorial courtyard or training station");
    if !area.radius.is_finite()
        || !(10.0..=40.0).contains(&area.radius)
        || !area.center.iter().all(|n| n.is_finite())
        || area.contains(data.map.spawn)
    {
        return Err(invalid());
    }
    let mut ids = HashSet::new();
    let mut positions = vec![area.spawn];
    for id in [&area.beacon, &area.terminal, &area.target, &area.exit] {
        let Some(site) = data.map.landmarks.iter().find(|l| &l.id == id) else {
            return Err(invalid());
        };
        if !ids.insert(id) {
            return Err(invalid());
        }
        positions.push(site.position);
    }
    for position in positions {
        if !position.iter().all(|n| n.is_finite())
            || !area.contains(position)
            || world.collides(position, 0.65)
            || (world.floor(
                position[0],
                position[2],
                position[1] + 0.1,
                position[1] - 0.2,
            ) - position[1])
                .abs()
                > 0.1
        {
            return Err(invalid());
        }
    }
    if data
        .map
        .enemy_spawns
        .iter()
        .any(|s| area.contains(s.position))
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn tick(p: &mut Player, data: &Content, world: &World) {
    if p.c.tutorial_stage != Some(Stage::Move)
        || !p.c.intro_seen
        || p.c.health <= 0.0
        || p.instance.is_some()
    {
        return;
    }
    let Some(beacon) = data
        .map
        .landmarks
        .iter()
        .find(|l| l.id == data.map.tutorial.beacon)
    else {
        return;
    };
    if dist(p.c.position, beacon.position) < 3.0 && world.visible(p.c.position, beacon.position) {
        p.c.tutorial_stage = Some(Stage::Interact);
        p.dirty = true;
        notice(
            p,
            "Movement complete. Select the training terminal, then use it.",
        );
    }
}

// Called only after the ordinary interaction distance, sightline, and rate checks.
pub(super) fn interact(p: &mut Player, data: &Content, id: &str) -> bool {
    let area = &data.map.tutorial;
    if p.instance.is_some() || p.c.health <= 0.0 {
        return false;
    }
    if id == area.exit {
        if p.c.tutorial_stage.take().is_some() {
            p.c.position = data.map.spawn;
            p.velocity = [0.0; 3];
            p.input = Movement {
                yaw: p.c.yaw,
                ..Movement::default()
            };
            p.dash = 0.0;
            p.jump_buffer = 0.0;
            p.coyote = 0.0;
            p.grounded = true;
            p.dirty = true;
            notice(
                p,
                "Welcome to the Commons. Your faction contact waits beside the exchange. Open Quests for directions.",
            );
        } else {
            notice(
                p,
                "Your training is finished. Open Quests → Next step to find your first contact.",
            );
        }
    } else if id == area.terminal {
        if p.c.tutorial_stage == Some(Stage::Interact) {
            p.c.tutorial_stage = Some(Stage::Combat);
            p.dirty = true;
            notice(
                p,
                "Terminal used. Select the practice target and use Shoot: 1, controller RT, or the SHOOT button.",
            );
        } else {
            notice(
                p,
                "Select objects before using them. The training terminal is on the west side; the Commons gate lets you leave at any time.",
            );
        }
    } else if id == area.beacon {
        notice(
            p,
            "Walk onto the cyan square in the courtyard. Use WASD, the controller’s left stick, or the touch pad.",
        );
    } else if id == area.target {
        notice(
            p,
            "Select this practice target and use Shoot. It cannot attack or award XP, gold, or items.",
        );
    } else {
        return false;
    }
    true
}

// The normal ability checks run before this: level, cooldown, global cooldown, and energy.
pub(super) fn practice(
    p: &mut Player,
    data: &Content,
    world: &World,
    ability: &Ability,
    time: f64,
) {
    let area = &data.map.tutorial;
    let Some(target) = data.map.landmarks.iter().find(|l| l.id == area.target) else {
        return;
    };
    if p.instance.is_some()
        || p.c.health <= 0.0
        || !area.contains(p.c.position)
        || dist(p.c.position, target.position) > ability.range
        || !world.visible(p.c.position, target.position)
    {
        notice(
            p,
            "Move into the training courtyard with a clear view of the practice target.",
        );
        return;
    }
    if ability.id != "arc" {
        notice(
            p,
            "Use Shoot for target practice: 1, controller RT, or the SHOOT button. It costs no energy.",
        );
        return;
    }
    let stats = Stats::new(&p.c, data);
    p.c.energy -= ability.cost * (1.0 - stats.efficiency);
    p.cooldowns.insert(
        ability.id.clone(),
        time + ability.cooldown * (1.0 - stats.haste),
    );
    p.global_ready = time + data.rule("combat", "globalCooldown");
    p.dirty = true;
    emit(
        p,
        json!({"type":"effect","kind":"beam","from":p.c.position,"position":target.position,"color":ability.color}),
    );
    emit(p, json!({"type":"sound","name":"shot"}));
    if p.c.tutorial_stage == Some(Stage::Combat) {
        p.c.tutorial_stage = Some(Stage::Exit);
        notice(
            p,
            "Target practice complete. Use the Commons gate to start your first quest.",
        );
    } else {
        notice(
            p,
            "Practice hit. Training targets give no XP, gold, or items.",
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Shard {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let content = Arc::new(Content::load(&manifest.join("../client")).unwrap());
        // Read-only lease and in-memory state; these tests never write runtime files.
        let root = manifest.join("tutorial-in-memory-test-unused");
        let db = Arc::new(Database {
            signer: SigningIdentity::load(&root).unwrap(),
            root,
            mutation: Mutex::new(()),
            _lease: File::open(manifest.join("../LICENSE")).unwrap(),
            social: Mutex::new(SocialState::default()),
            write_failed: std::sync::atomic::AtomicBool::new(false),
        });
        let (saves, _) = mpsc::channel(1);
        let mut s = Shard::new(content, saves, 0, db);
        let mut c: Character = serde_json::from_value(json!({"version":2,"id":"new","name":"New Runner","race":"human","faction":"relay","level":0,"xp":0,"gold":45,"position":s.content.map.tutorial.spawn,"yaw":0,"health":140,"energy":100,"medkits":3,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true,"tutorialStage":"move"})).unwrap();
        c.health = Stats::new(&c, &s.content).health;
        let (output, _) = mpsc::channel(32);
        s.players.insert(
            "new".into(),
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
        s.time = 10.0;
        s
    }
    fn visit(s: &mut Shard, id: &str) {
        let position = s
            .content
            .map
            .landmarks
            .iter()
            .find(|l| l.id == id)
            .unwrap()
            .position;
        s.players.get_mut("new").unwrap().c.position = position;
        s.time += 2.0;
    }
    fn use_site(s: &mut Shard, id: &str) {
        s.action("new", &json!({"type":"interact","id":id}));
    }
    fn shoot(s: &mut Shard) {
        let target = s.content.map.tutorial.target.clone();
        s.action("new", &json!({"type":"ability","id":"arc","target":target}));
    }

    #[test]
    fn training_is_ordered_saved_and_hands_off_without_rewards() {
        let mut s = fixture();
        let area = s.content.map.tutorial.clone();
        let before = s.players["new"].c.clone();
        visit(&mut s, &area.terminal);
        use_site(&mut s, &area.terminal);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Move));
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Move));
        visit(&mut s, &area.beacon);
        s.tick();
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Interact));
        visit(&mut s, &area.terminal);
        use_site(&mut s, &area.terminal);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        let saved = saved_player(&s.players["new"], s.time);
        let restored: StoredCharacter =
            serde_json::from_value(serde_json::to_value(saved).unwrap()).unwrap();
        assert_eq!(restored.character.tutorial_stage, Some(Stage::Combat));
        s.players.get_mut("new").unwrap().c = restored.character;
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Exit));
        for _ in 0..3 {
            s.time += 2.0;
            shoot(&mut s);
        }
        use_site(&mut s, &area.exit);
        assert_eq!(
            s.players["new"].c.tutorial_stage,
            Some(Stage::Exit),
            "the exit requires proximity"
        );
        visit(&mut s, &area.exit);
        s.players.get_mut("new").unwrap().velocity = [2.0, 1.0, 3.0];
        use_site(&mut s, &area.exit);
        let p = &s.players["new"];
        assert_eq!(p.c.tutorial_stage, None);
        assert_eq!(p.c.position, s.content.map.spawn);
        assert_eq!(p.velocity, [0.0; 3]);
        assert_eq!(p.c.xp, before.xp);
        assert_eq!(p.c.gold, before.gold);
        assert_eq!(p.c.items, before.items);
        assert_eq!(p.c.completed, before.completed);
        assert_eq!(p.c.active_quests, before.active_quests);
        let value = serde_json::to_value(&p.c).unwrap();
        assert!(value.get("tutorialStage").is_none());
        let legacy: Character = serde_json::from_value(value).unwrap();
        assert_eq!(legacy.tutorial_stage, None);
    }

    #[test]
    fn gate_allows_early_exit_but_cannot_be_reused_for_teleporting() {
        let mut s = fixture();
        let exit = s.content.map.tutorial.exit.clone();
        visit(&mut s, &exit);
        use_site(&mut s, &exit);
        assert_eq!(s.players["new"].c.tutorial_stage, None);
        visit(&mut s, &exit);
        let position = s.players["new"].c.position;
        use_site(&mut s, &exit);
        assert_eq!(s.players["new"].c.position, position);
        let terminal = s.content.map.tutorial.terminal.clone();
        visit(&mut s, &terminal);
        use_site(&mut s, &terminal);
        assert_eq!(s.players["new"].c.tutorial_stage, None);
    }

    #[test]
    fn unstuck_preserves_character_and_instance_while_clearing_motion() {
        for (stage, instance) in [(Some(Stage::Combat), None), (None, None), (None, Some(7))] {
            let mut s = fixture();
            let (output, mut messages) = mpsc::channel(16);
            let p = s.players.get_mut("new").unwrap();
            p.output = output;
            p.c.tutorial_stage = stage;
            p.instance = instance;
            p.c.position = [20.0, 10.0, 20.0];
            p.c.health = 43.0;
            p.c.energy = 17.0;
            p.c.yaw = 0.7;
            p.input = Movement {
                forward: 1.0,
                strafe: 1.0,
                jump: true,
                dash: true,
                sprint: true,
                ..Movement::default()
            };
            p.velocity = [4.0, -8.0, 6.0];
            p.grounded = false;
            p.dash = 0.2;
            p.jump_buffer = 0.1;
            p.coyote = 0.1;
            p.cooldowns.insert("arc".into(), 20.0);
            p.dash_ready = 15.0;
            let mut expected = serde_json::to_value(&p.c).unwrap();
            let destination = if instance.is_some() {
                let [x, y, z] = s.content.dungeons.rules.arena;
                [x, y, z + 14.0]
            } else if stage.is_some() {
                s.content.map.tutorial.spawn
            } else {
                s.content.map.spawn
            };
            expected["position"] = json!(destination);
            expected["revision"] = json!(p.c.revision + 1);
            s.action(
                "new",
                &json!({"type":"unstuck","position":[-9999,9999,9999]}),
            );
            let p = &s.players["new"];
            assert_eq!(serde_json::to_value(&p.c).unwrap(), expected);
            assert_eq!(p.instance, instance);
            assert!(
                !s.world
                    .collides(destination, s.content.rule("movement", "radius"))
            );
            assert_eq!(p.velocity, [0.0; 3]);
            assert_eq!(p.input.forward, 0.0);
            assert_eq!(p.input.strafe, 0.0);
            assert_eq!(p.input.yaw, p.c.yaw);
            assert!(!p.input.jump && !p.input.dash && !p.input.sprint);
            assert_eq!((p.dash, p.jump_buffer, p.coyote), (0.0, 0.0, 0.0));
            assert!(p.grounded && p.dirty);
            assert_eq!(p.cooldowns["arc"], 20.0);
            assert_eq!(p.dash_ready, 15.0);
            assert_eq!(p.cooldowns["unstuck"], 40.0);
            assert!(saved_player(p, s.time).cooldowns.contains_key("unstuck"));
            s.snapshots();
            let snapshot = std::iter::from_fn(|| messages.try_recv().ok())
                .find(|message| message["type"] == "snapshot")
                .unwrap();
            assert_eq!(snapshot["cooldowns"]["unstuck"], 40.0);
            assert_eq!(snapshot["character"]["position"], json!(destination));
        }
    }

    #[test]
    fn unstuck_cancels_an_elevator_and_rejects_repeats_until_its_cooldown_expires() {
        let mut s = fixture();
        let p = s.players.get_mut("new").unwrap();
        p.c.tutorial_stage = None;
        p.elevator = Some(elevators::Ride::new(
            "test-elevator".into(),
            [0.0, 0.0, 0.0],
            [0.0, 120.0, 0.0],
            s.time,
        ));
        s.action("new", &json!({"type":"unstuck"}));
        assert!(s.players["new"].elevator.is_none());
        assert_eq!(s.players["new"].c.position, s.content.map.spawn);
        let stuck = [20.0, 10.0, 20.0];
        s.players.get_mut("new").unwrap().c.position = stuck;
        s.time = 39.99;
        s.action("new", &json!({"type":"unstuck"}));
        assert_eq!(s.players["new"].c.position, stuck);
        assert_eq!(s.players["new"].cooldowns["unstuck"], 40.0);
        s.time = 40.0;
        s.action("new", &json!({"type":"unstuck"}));
        assert_eq!(s.players["new"].c.position, s.content.map.spawn);
        assert_eq!(s.players["new"].cooldowns["unstuck"], 70.0);
    }

    #[test]
    fn unstuck_cannot_bypass_death_or_dungeon_revival() {
        for (instance, released) in [(None, false), (None, true), (Some(7), false)] {
            let mut s = fixture();
            let p = s.players.get_mut("new").unwrap();
            p.instance = instance;
            p.c.health = 0.0;
            death::fallen(p, &s.content, s.time);
            if let Some(recovery) = &mut p.c.death {
                recovery.released = released;
            }
            let mut expected = serde_json::to_value(&p.c).unwrap();
            expected["revision"] = json!(p.c.revision + 1);
            s.action("new", &json!({"type":"unstuck"}));
            assert_eq!(serde_json::to_value(&s.players["new"].c).unwrap(), expected);
            assert!(!s.players["new"].cooldowns.contains_key("unstuck"));
        }
    }

    #[test]
    fn practice_rejects_remote_dead_instanced_and_cooling_down_actions() {
        let mut s = fixture();
        let area = s.content.map.tutorial.clone();
        {
            let p = s.players.get_mut("new").unwrap();
            p.c.tutorial_stage = Some(Stage::Combat);
            p.c.position = s.content.map.spawn;
        }
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        visit(&mut s, &area.terminal);
        s.players.get_mut("new").unwrap().c.health = 0.0;
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        {
            let p = s.players.get_mut("new").unwrap();
            p.c.health = 100.0;
            p.instance = Some(1);
        }
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        {
            let p = s.players.get_mut("new").unwrap();
            p.instance = None;
            p.cooldowns.insert("arc".into(), s.time + 5.0);
        }
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        s.time += 6.0;
        s.action(
            "new",
            &json!({"type":"ability","id":"surge","target":area.target}),
        );
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Combat));
        shoot(&mut s);
        assert_eq!(s.players["new"].c.tutorial_stage, Some(Stage::Exit));
        assert!(s.players["new"].cooldowns["arc"] > s.time);
        assert!(s.players["new"].global_ready > s.time);
    }

    #[test]
    fn courtyard_prevents_enemy_damage_and_safe_zone_farming() {
        let mut s = fixture();
        s.enemies.truncate(1);
        let enemy = &mut s.enemies[0];
        enemy.position = [0.0, 0.0, -45.0];
        enemy.home = enemy.position;
        enemy.health = enemy.max_health;
        enemy.damage = 20.0;
        s.players.get_mut("new").unwrap().c.position = [0.0, 0.0, -47.0];
        let health = s.players["new"].c.health;
        let target = s.enemies[0].id.clone();
        let target_health = s.enemies[0].health;
        s.action("new", &json!({"type":"ability","id":"arc","target":target}));
        for _ in 0..20 {
            s.tick();
        }
        assert_eq!(s.enemies[0].health, target_health);
        assert_eq!(s.players["new"].c.health, health);
        assert!(s.players["new"].cooldowns.is_empty());
        s.players.get_mut("new").unwrap().c.position = [0.0, 0.0, -44.0];
        s.tick();
        assert_eq!(
            s.players["new"].c.health, health,
            "leaving training still grants an attack warning"
        );
        assert!(s.enemies[0].attack.is_some());
        for _ in 0..40 {
            s.tick();
        }
        assert!(
            s.players["new"].c.health < health,
            "ordinary combat resumes outside training"
        );
    }
}
