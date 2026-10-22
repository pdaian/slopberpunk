// Ordered, saved contract objectives. GPL-3.0-or-later.
use super::*;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Stage {
    pub index: usize,
    pub progress: u32,
    #[serde(default)]
    pub hold_ticks: u32,
}

pub(super) fn validate(data: &Content) -> io::Result<()> {
    for q in &data.quests {
        if q.steps.len() > 8 || (!q.steps.is_empty() && q.steps.len() < 2) {
            return Err(io::Error::other(format!("Invalid steps for {}", q.id)));
        }
        for step in &q.steps {
            let valid = match step.kind.as_str() {
                "kill" => data.enemies.iter().any(|e| text(&e["id"]) == step.target),
                "explore" | "interact" | "hold" => {
                    data.map.landmarks.iter().any(|l| l.id == step.target)
                }
                "event" => data
                    .world_events
                    .entries
                    .iter()
                    .any(|e| e.id == step.target),
                _ => false,
            };
            if !valid
                || step.text.is_empty()
                || !(1..=60).contains(&step.count)
                || (matches!(step.kind.as_str(), "explore" | "interact" | "event")
                    && step.count != 1)
            {
                return Err(io::Error::other(format!("Invalid step for {}", q.id)));
            }
        }
    }
    Ok(())
}

pub(super) fn progress(p: &mut Player, data: &Content, kind: &str, target: &str) {
    if p.c.health <= 0.0 || p.instance.is_some() {
        return;
    }
    for q in &data.quests {
        let Some(&count) = p.c.active_quests.get(&q.id) else {
            continue;
        };
        if count >= q.objective.count {
            continue;
        }
        // Saves accepted before staged contracts were introduced keep their original objective.
        let objective = match p.c.quest_stages.get(&q.id) {
            Some(stage) => q.steps.get(stage.index),
            None => Some(&q.objective),
        };
        let Some(objective) = objective else { continue };
        if objective.target != target
            || !(objective.kind == kind || kind == "interact" && objective.kind == "explore")
        {
            continue;
        }
        advance(p, data, q, objective.count);
    }
}

fn advance(p: &mut Player, data: &Content, q: &Quest, required: u32) {
    if let Some(stage) = p.c.quest_stages.get_mut(&q.id) {
        stage.progress += 1;
        stage.hold_ticks = 0;
        if stage.progress >= required {
            stage.index += 1;
            stage.progress = 0;
        }
        if stage.index == q.steps.len() {
            p.c.active_quests.insert(q.id.clone(), q.objective.count);
        }
    } else if let Some(count) = p.c.active_quests.get_mut(&q.id) {
        *count += 1;
    }
    p.dirty = true;
    emit(
        p,
        json!({"type":"questProgress","quest":data.quest_values.get(&q.id),"progress":p.c.active_quests[&q.id],"stage":p.c.quest_stages.get(&q.id)}),
    );
}

pub(super) fn tick(p: &mut Player, data: &Content, world: &World) {
    if p.c.health <= 0.0 || p.instance.is_some() || p.c.quest_stages.is_empty() {
        return;
    }
    for q in &data.quests {
        if !p.c.active_quests.contains_key(&q.id) {
            continue;
        }
        let Some(stage) = p.c.quest_stages.get_mut(&q.id) else {
            continue;
        };
        let Some(step) = q.steps.get(stage.index).filter(|s| s.kind == "hold") else {
            continue;
        };
        let Some(site) = data.map.landmarks.iter().find(|l| l.id == step.target) else {
            continue;
        };
        if dist(p.c.position, site.position) < data.r("interactionRadius")
            && world.visible(p.c.position, site.position)
        {
            stage.hold_ticks += 1;
            p.dirty = true;
            if stage.hold_ticks >= 20 {
                advance(p, data, q, step.count);
            }
        }
    }
}
