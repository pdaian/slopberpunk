// First Signal Halo: server-owned signup reward. GPL-3.0-or-later.
use super::*;

pub(super) const LIMIT: u16 = 1000;

pub(super) fn halo_for_signup(existing_accounts: u16) -> Option<u16> {
    (existing_accounts < LIMIT).then(|| existing_accounts + 1)
}

impl Database {
    // Call under mutation: the entitlement and successful signup share one atomic write.
    // Pending writes never count. Existing legacy accounts occupy their signup slots.
    pub(super) fn founder_account_count(&self) -> io::Result<u16> {
        let mut count = 0;
        for entry in fs::read_dir(self.root.join("accounts"))? {
            let entry = entry?;
            let path = entry.path();
            if entry.file_type()?.is_file()
                && path
                    .extension()
                    .is_some_and(|extension| extension == "json")
                && path
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .is_some_and(valid_user)
            {
                count += 1;
                if count == LIMIT {
                    break;
                }
            }
        }
        Ok(count)
    }
}

pub(super) fn xp_reward(c: &Character, data: &Content, amount: u64) -> (u64, u8) {
    if !c
        .founder_halo
        .is_some_and(|serial| (1..=LIMIT).contains(&serial))
        || c.level >= 10
    {
        return (amount, 0);
    }
    let cost = |level: u32| progression::xp_cost(level, data);
    let prologue = if c.level == 0 {
        amount.min(cost(0).saturating_sub(c.xp))
    } else {
        0
    };
    let to_ten: u64 = (c.level.max(1)..10).map(cost).sum();
    let to_ten = to_ten.saturating_sub(if c.level >= 1 { c.xp } else { 0 });
    if to_ten == 0 {
        return (amount, 0);
    }
    let remainder = if c.level == 0 {
        0
    } else {
        c.founder_xp_remainder.min(19)
    } as u64;
    // Keep twentieths of XP across rewards; never boost XP beyond reaching level ten.
    let eligible = (amount - prologue).min((to_ten * 20 - remainder).div_ceil(21));
    let bonus = ((eligible + remainder) / 20).min(to_ten - eligible);
    let remainder = if eligible + bonus >= to_ten {
        0
    } else {
        ((eligible + remainder) % 20) as u8
    };
    (amount.saturating_add(bonus), remainder)
}

pub(super) async fn offer(State(app): State<Arc<App>>) -> ResultApi<Json<Value>> {
    let db = app.db.clone();
    let remaining = tokio::task::spawn_blocking(move || -> ResultApi<u16> {
        let _guard = db.mutation.lock().map_err(|_| internal())?;
        Ok(LIMIT - db.founder_account_count().map_err(|_| internal())?)
    })
    .await
    .map_err(|_| internal())??;
    Ok(Json(
        json!({"item":"first-signal-halo","limit":LIMIT,"remaining":remaining}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn content() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }

    fn runner(level: u32, xp: u64) -> Character {
        serde_json::from_value(json!({"version":2,"id":"runner","name":"Runner",
            "race":"human","faction":"relay","level":level,"xp":xp,"gold":45,
            "position":[0,0,0],"yaw":0,"health":140,"energy":100,"medkits":3,
            "weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true,
            "founderHalo":1}))
        .unwrap()
    }

    #[test]
    fn only_the_first_thousand_accounts_receive_a_persistent_serial() {
        for existing in 0..LIMIT {
            let account = Account {
                version: DATA_VERSION,
                username: format!("runner_{existing}"),
                password_hash: "test-only".into(),
                characters: vec![],
                founder_halo: halo_for_signup(existing),
            };
            let restored: Account =
                serde_json::from_slice(&serde_json::to_vec(&account).unwrap()).unwrap();
            assert_eq!(restored.founder_halo, Some(existing + 1));
            assert!(
                restored.characters.is_empty(),
                "Deleting characters cannot remove the account reward"
            );
        }
        assert_eq!(halo_for_signup(LIMIT), None);
        assert_eq!(halo_for_signup(u16::MAX), None);
    }

    #[test]
    fn legacy_accounts_and_characters_do_not_invent_entitlements() {
        let mut account: Account = serde_json::from_value(json!({"username":"legacy",
            "password_hash":"test-only","characters":[]}))
        .unwrap();
        migrate_version(&mut account.version).unwrap();
        assert_eq!(account.founder_halo, None);
        let mut value = serde_json::to_value(runner(1, 0)).unwrap();
        value.as_object_mut().unwrap().remove("founderHalo");
        value.as_object_mut().unwrap().remove("founderXpRemainder");
        let c: Character = serde_json::from_value(value).unwrap();
        assert_eq!(c.founder_halo, None);
        assert_eq!(c.founder_xp_remainder, 0);
        assert_eq!(xp_reward(&c, &content(), 100), (100, 0));
    }

    #[test]
    fn xp_is_five_percent_with_persistent_fractional_credit() {
        let data = content();
        for level in [1, 5, 9] {
            assert_eq!(xp_reward(&runner(level, 0), &data, 100), (105, 0));
        }
        for level in [0, 10, 60] {
            assert_eq!(xp_reward(&runner(level, 0), &data, 20), (20, 0));
        }
        let mut c = runner(1, 0);
        let mut earned = 0;
        for _ in 0..19 {
            let (xp, remainder) = xp_reward(&c, &data, 1);
            earned += xp;
            c.founder_xp_remainder = remainder;
        }
        assert_eq!(earned, 19);
        let c: Character = serde_json::from_slice(&serde_json::to_vec(&c).unwrap()).unwrap();
        assert_eq!(xp_reward(&c, &data, 1), (2, 0));
    }

    #[test]
    fn prologue_and_level_ten_boundaries_do_not_leak_bonus_xp() {
        let data = content();
        assert_eq!(
            xp_reward(&runner(0, 0), &data, progression::xp_cost(0, &data) + 100),
            (progression::xp_cost(0, &data) + 105, 0)
        );
        assert_eq!(
            xp_reward(&runner(9, progression::xp_cost(9, &data) - 21), &data, 120),
            (121, 0)
        );
        let mut last = runner(9, progression::xp_cost(9, &data) - 1);
        last.founder_xp_remainder = 19;
        assert_eq!(xp_reward(&last, &data, 1), (1, 0));
        last.founder_halo = Some(1001);
        assert_eq!(xp_reward(&last, &data, 100), (100, 0));
    }
}
