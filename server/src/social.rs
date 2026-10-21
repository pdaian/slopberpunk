// Durable community and escrow transactions. GPL-3.0-or-later.
use super::*;
use ed25519_dalek::{Signer, SigningKey};

const PAGE: usize = 40;
const MAX_CREDITS: u64 = 9_000_000_000;

#[derive(Clone, Serialize, Deserialize)]
struct KeyFile {
    version: u32,
    algorithm: String,
    secret: [u8; 32],
}
pub(super) struct SigningIdentity {
    record: KeyFile,
    key: SigningKey,
}
impl SigningIdentity {
    pub(super) fn load(root: &FsPath) -> io::Result<Self> {
        let record = match read_json::<KeyFile>(root.join("signing-key.json")) {
            Ok(record) => record,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                let mut secret = [0; 32];
                getrandom::fill(&mut secret).map_err(|e| io::Error::other(e.to_string()))?;
                KeyFile {
                    version: DATA_VERSION,
                    algorithm: "Ed25519".into(),
                    secret,
                }
            }
            Err(e) => return Err(e),
        };
        if record.version != DATA_VERSION || record.algorithm != "Ed25519" {
            return Err(io::Error::other("Unsupported signing identity"));
        }
        Ok(Self {
            key: SigningKey::from_bytes(&record.secret),
            record,
        })
    }
    pub(super) fn persist(&self, db: &Database) -> io::Result<()> {
        let path = db.root.join("signing-key.json");
        if !path.exists() {
            db.atomic(&path, &self.record)?;
        }
        Ok(())
    }
    fn public(&self) -> Value {
        json!({"version":DATA_VERSION,"algorithm":"Ed25519","publicKey":hex(&self.key.verifying_key().to_bytes()),"encoding":"hex"})
    }
    fn sign(&self, payload: Value) -> ResultApi<Value> {
        // Sign these exact UTF-8 bytes. No canonical-JSON dependency for future importers.
        let payload = serde_json::to_string(&payload).map_err(|_| internal())?;
        let signature = self.key.sign(payload.as_bytes());
        Ok(
            json!({"format":"sloperberpunk-character-export","version":DATA_VERSION,
            "algorithm":"Ed25519","publicKey":hex(&self.key.verifying_key().to_bytes()),
            "signature":hex(&signature.to_bytes()),"encoding":"hex","payload":payload}),
        )
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Clone, Serialize, Deserialize)]
struct Profile {
    version: u32,
    id: String,
    name: String,
    race: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Tabard {
    base: String,
    trim: String,
    emblem: String,
    pattern: String,
}
impl Default for Tabard {
    fn default() -> Self {
        Self {
            base: "#284d42".into(),
            trim: "#c7ed99".into(),
            emblem: "signal".into(),
            pattern: "stripe".into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Group {
    version: u32,
    id: u64,
    name: String,
    owner: String,
    race: Option<String>,
    members: HashMap<String, String>,
    invitations: HashSet<String>,
    tabard: Tabard,
}
#[derive(Clone, Serialize, Deserialize)]
struct Post {
    version: u32,
    id: u64,
    author: String,
    name: String,
    body: String,
    created: u64,
    channel: String,
    recipient: Option<String>,
    thread: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Thread {
    version: u32,
    id: u64,
    author: String,
    name: String,
    section: String,
    title: String,
    created: u64,
}
#[derive(Clone, Serialize, Deserialize)]
struct Auction {
    version: u32,
    id: u64,
    seller: String,
    quantity: u32,
    minimum: u64,
    buyout: u64,
    bid: u64,
    bidder: Option<String>,
    expires: u64,
    status: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Delivery {
    version: u32,
    id: u64,
    recipient: String,
    credits: u64,
    medkits: u32,
    reason: String,
    claimed: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct Contact {
    version: u32,
    from: String,
    to: String,
    accepted: bool,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SocialState {
    version: u32,
    format: String,
    pub(super) revision: u64,
    sequence: u64,
    // Last committed character in each social transaction is its recovery record.
    pub(super) characters: HashMap<String, StoredCharacter>,
    profiles: HashMap<String, Profile>,
    guilds: Vec<Group>,
    parties: Vec<Group>,
    posts: Vec<Post>,
    threads: Vec<Thread>,
    auctions: Vec<Auction>,
    deliveries: Vec<Delivery>,
    contacts: Vec<Contact>,
    blocks: HashMap<String, HashSet<String>>,
    read_through: HashMap<String, HashMap<String, u64>>,
    lineage_claims: HashMap<String, u64>,
    receipts: HashMap<String, Vec<(String, Value)>>,
}
impl Default for SocialState {
    fn default() -> Self {
        Self {
            version: DATA_VERSION,
            format: "sloperberpunk-social".into(),
            revision: 0,
            sequence: 0,
            characters: HashMap::new(),
            profiles: HashMap::new(),
            guilds: vec![],
            parties: vec![],
            posts: vec![],
            threads: vec![],
            auctions: vec![],
            deliveries: vec![],
            contacts: vec![],
            blocks: HashMap::new(),
            read_through: HashMap::new(),
            lineage_claims: HashMap::new(),
            receipts: HashMap::new(),
        }
    }
}
impl SocialState {
    pub(super) fn load(root: &FsPath) -> io::Result<Self> {
        let state: Self = match read_json(root.join("social.json")) {
            Ok(s) => s,
            Err(e) if e.kind() == io::ErrorKind::NotFound => Self::default(),
            Err(e) => return Err(e),
        };
        if state.version != DATA_VERSION
            || state.format != "sloperberpunk-social"
            || state
                .characters
                .values()
                .any(|s| s.version != DATA_VERSION || s.character.version != DATA_VERSION)
            || state.profiles.values().any(|r| r.version != DATA_VERSION)
            || state
                .guilds
                .iter()
                .chain(&state.parties)
                .any(|r| r.version != DATA_VERSION)
            || state.posts.iter().any(|r| r.version != DATA_VERSION)
            || state.threads.iter().any(|r| r.version != DATA_VERSION)
            || state.auctions.iter().any(|r| r.version != DATA_VERSION)
            || state.deliveries.iter().any(|r| r.version != DATA_VERSION)
            || state.contacts.iter().any(|r| r.version != DATA_VERSION)
        {
            return Err(io::Error::other("Unsupported social data version"));
        }
        Ok(state)
    }
    fn next(&mut self) -> u64 {
        self.sequence += 1;
        self.sequence
    }
    fn blocked(&self, a: &str, b: &str) -> bool {
        self.blocks.get(a).is_some_and(|s| s.contains(b))
            || self.blocks.get(b).is_some_and(|s| s.contains(a))
    }
    fn target(&self, id: &str, other: &str) -> ResultApi<()> {
        if id == other || !self.profiles.contains_key(other) || self.blocked(id, other) {
            return Err(bad("This player is unavailable."));
        }
        Ok(())
    }
    pub(super) fn guild_badge(&self, id: &str) -> Option<Value> {
        self.guilds
            .iter()
            .find(|g| g.members.contains_key(id))
            .map(|g| json!({"id":g.id,"name":g.name,"tabard":g.tabard}))
    }
    fn channel(&self, c: &Character, channel: &str, forum: bool) -> bool {
        if channel == "world" || channel == "trade" || (forum && channel == "general") {
            return true;
        }
        if channel == format!("race:{}", c.race) {
            return true;
        }
        for (prefix, groups) in [("guild", &self.guilds), ("party", &self.parties)] {
            if groups
                .iter()
                .any(|g| channel == format!("{prefix}:{}", g.id) && g.members.contains_key(&c.id))
            {
                return true;
            }
        }
        false
    }
    fn deliver(&mut self, recipient: String, credits: u64, medkits: u32, reason: &str) {
        let id = self.next();
        self.deliveries.push(Delivery {
            version: DATA_VERSION,
            id,
            recipient,
            credits,
            medkits,
            reason: reason.into(),
            claimed: false,
        });
    }
    fn settle(&mut self, index: usize) {
        let a = self.auctions[index].clone();
        if a.status != "open" {
            return;
        }
        if let Some(buyer) = a.bidder {
            // A 5% sink supports the economy. Bid escrow was already debited durably.
            let fee = a.bid.div_ceil(20);
            self.deliver(a.seller, a.bid - fee, 0, "Auction proceeds (5% market fee)");
            self.deliver(buyer, 0, a.quantity, "Auction purchase");
            self.auctions[index].status = "sold".into();
        } else {
            self.deliver(a.seller, 0, a.quantity, "Expired auction returned");
            self.auctions[index].status = "expired".into();
        }
    }
    fn expire(&mut self, now: u64) -> bool {
        let indices: Vec<_> = self
            .auctions
            .iter()
            .enumerate()
            .filter(|(_, a)| a.status == "open" && a.expires <= now)
            .map(|(i, _)| i)
            .collect();
        let changed = !indices.is_empty();
        for i in indices {
            self.settle(i);
        }
        changed
    }
    fn post(
        &mut self,
        c: &Character,
        body: String,
        channel: String,
        recipient: Option<String>,
        thread: Option<u64>,
        now: u64,
    ) -> u64 {
        let id = self.next();
        self.posts.push(Post {
            version: DATA_VERSION,
            id,
            author: c.id.clone(),
            name: c.name.clone(),
            body,
            created: now,
            channel,
            recipient,
            thread,
        });
        id
    }
    fn apply(
        &mut self,
        saved: &mut StoredCharacter,
        request: &Value,
        data: &Content,
        now: u64,
    ) -> ResultApi<Value> {
        let c = &mut saved.character;
        let kind = text(&request["action"]);
        let id = c.id.clone();
        self.profiles.insert(
            id.clone(),
            Profile {
                version: DATA_VERSION,
                id: id.clone(),
                name: c.name.clone(),
                race: c.race.clone(),
            },
        );
        match kind {
            "register" => {}
            "chat" | "dm" => {
                let body = bounded_text(&request["body"], 1, 1000)?;
                let target = text(&request["target"]);
                let channel = text(&request["channel"]);
                if kind == "dm" {
                    self.target(&id, target)?;
                } else if !self.channel(c, channel, false) {
                    return Err(forbidden());
                }
                let post = self.post(
                    c,
                    body,
                    if kind == "dm" { "dm" } else { channel }.into(),
                    if kind == "dm" {
                        Some(target.into())
                    } else {
                        None
                    },
                    None,
                    now,
                );
                return Ok(json!({"id":post}));
            }
            "dm_read" => {
                let target = text(&request["target"]);
                if !valid_id(target) || target == id {
                    return Err(bad("Invalid conversation."));
                }
                // Only mark what the client actually displayed, never unseen concurrent messages.
                let through = request["through"]
                    .as_u64()
                    .ok_or_else(|| bad("Invalid read cursor."))?;
                let valid = self.posts.iter().any(|p| {
                    p.id == through
                        && p.channel == "dm"
                        && p.author == target
                        && p.recipient.as_deref() == Some(&id)
                });
                if valid {
                    let read = self
                        .read_through
                        .entry(id)
                        .or_default()
                        .entry(target.into())
                        .or_default();
                    *read = (*read).max(through);
                }
            }
            "thread" | "reply" => {
                let body = bounded_text(&request["body"], 1, 2000)?;
                let (thread, section) = if kind == "thread" {
                    let section = text(&request["section"]).to_owned();
                    if !self.channel(c, &section, true) {
                        return Err(forbidden());
                    }
                    let title = bounded_text(&request["title"], 3, 100)?;
                    let thread = self.next();
                    self.threads.push(Thread {
                        version: DATA_VERSION,
                        id: thread,
                        author: id,
                        name: c.name.clone(),
                        section: section.clone(),
                        title,
                        created: now,
                    });
                    (thread, section)
                } else {
                    let thread = self
                        .threads
                        .iter()
                        .find(|t| t.id == number(request, "thread", 1, u64::MAX).unwrap_or(0))
                        .ok_or_else(|| bad("Thread not found."))?;
                    if !self.channel(c, &thread.section, true) {
                        return Err(forbidden());
                    }
                    (thread.id, thread.section.clone())
                };
                self.post(c, body, section, None, Some(thread), now);
                return Ok(json!({"thread":thread}));
            }
            "friend_request" | "friend_accept" | "friend_remove" | "block" | "unblock" => {
                let other = text(&request["target"]);
                if kind == "unblock" {
                    self.blocks.entry(id).or_default().remove(other);
                } else if kind == "block" {
                    if other == id || !self.profiles.contains_key(other) {
                        return Err(bad("Player not found."));
                    }
                    self.blocks
                        .entry(id.clone())
                        .or_default()
                        .insert(other.into());
                    self.contacts.retain(|f| !pair(f, &id, other));
                } else if kind == "friend_remove" {
                    self.contacts.retain(|f| !pair(f, &id, other));
                } else {
                    self.target(&id, other)?;
                    if kind == "friend_request" {
                        if self.contacts.iter().any(|f| pair(f, &id, other)) {
                            return Err(bad("A contact or invitation already exists."));
                        }
                        if self
                            .contacts
                            .iter()
                            .filter(|f| f.from == id || f.to == id || f.to == other)
                            .count()
                            >= 200
                        {
                            return Err(bad("The contact list is full."));
                        }
                        self.contacts.push(Contact {
                            version: DATA_VERSION,
                            from: id,
                            to: other.into(),
                            accepted: false,
                        });
                    } else {
                        let contact = self
                            .contacts
                            .iter_mut()
                            .find(|f| f.to == id && f.from == other && !f.accepted)
                            .ok_or_else(|| bad("Invitation not found."))?;
                        contact.accepted = true;
                    }
                }
            }
            action if action.starts_with("guild_") || action.starts_with("party_") => {
                self.group_action(c, request)?;
            }
            "auction_list" => {
                if self
                    .auctions
                    .iter()
                    .filter(|a| a.seller == id && a.status == "open")
                    .count()
                    >= 20
                {
                    return Err(bad("At most 20 active auctions per character."));
                }
                let quantity = number(request, "quantity", 1, u64::from(c.medkits))? as u32;
                let minimum = number(request, "minimum", 1, 1_000_000)?;
                let buyout = number(request, "buyout", minimum, 1_000_000)?;
                let hours = number(request, "hours", 1, 48)?;
                c.medkits -= quantity;
                let auction = self.next();
                self.auctions.push(Auction {
                    version: DATA_VERSION,
                    id: auction,
                    seller: id,
                    quantity,
                    minimum,
                    buyout,
                    bid: 0,
                    bidder: None,
                    expires: now + hours * 3600,
                    status: "open".into(),
                });
                return Ok(json!({"auction":auction}));
            }
            "auction_bid" | "auction_buy" | "auction_cancel" => {
                let auction = number(request, "auction", 1, u64::MAX)?;
                let index = self
                    .auctions
                    .iter()
                    .position(|a| a.id == auction && a.status == "open" && a.expires > now)
                    .ok_or_else(|| bad("This auction is no longer open."))?;
                let a = self.auctions[index].clone();
                if kind == "auction_cancel" {
                    if a.seller != id || a.bidder.is_some() {
                        return Err(bad("Only an unbid auction's seller may cancel it."));
                    }
                    self.deliver(id, 0, a.quantity, "Cancelled auction returned");
                    self.auctions[index].status = "cancelled".into();
                } else {
                    if a.seller == id {
                        return Err(bad("You cannot bid on your own auction."));
                    }
                    let amount = if kind == "auction_buy" {
                        a.buyout
                    } else {
                        number(request, "amount", a.minimum.max(a.bid + 1), a.buyout)?
                    };
                    let held = if a.bidder.as_deref() == Some(&id) {
                        a.bid
                    } else {
                        0
                    };
                    let cost = amount - held;
                    if c.credits < cost {
                        return Err(bad("Not enough credits."));
                    }
                    c.credits -= cost;
                    if let Some(previous) = a.bidder.filter(|p| p != &id) {
                        self.deliver(previous, a.bid, 0, "Outbid: escrow refunded");
                    }
                    self.auctions[index].bidder = Some(id);
                    self.auctions[index].bid = amount;
                    if amount == a.buyout {
                        self.settle(index);
                    }
                }
            }
            "claim" => {
                let delivery = number(request, "delivery", 1, u64::MAX)?;
                let item = self
                    .deliveries
                    .iter_mut()
                    .find(|d| d.id == delivery && d.recipient == id && !d.claimed)
                    .ok_or_else(|| bad("Delivery is already claimed or unavailable."))?;
                let room = (data.rule("inventory", "slots") as u32).saturating_sub(c.medkits);
                let kits = item.medkits.min(room);
                let credits = item.credits.min(MAX_CREDITS.saturating_sub(c.credits));
                if kits == 0 && credits == 0 {
                    return Err(bad(
                        "Make room in your pack or wallet before claiming this delivery.",
                    ));
                }
                c.medkits += kits;
                c.credits += credits;
                item.medkits -= kits;
                item.credits -= credits;
                item.claimed = item.medkits == 0 && item.credits == 0;
            }
            "gift" => {
                let other = text(&request["target"]);
                self.target(&id, other)?;
                let amount = number(request, "amount", 1, c.credits.min(1_000_000))?;
                c.credits -= amount;
                self.deliver(other.into(), amount, 0, &format!("Gift from {}", c.name));
            }
            "lineage_reward" => {
                let day = now / 86400;
                if self.lineage_claims.get(&id) == Some(&day) {
                    return Err(bad("Today's lineage supply has already been claimed."));
                }
                if !data
                    .quests
                    .iter()
                    .any(|q| q.race.as_ref() == Some(&c.race) && c.completed.contains(&q.id))
                {
                    return Err(bad(
                        "Complete your first lineage chapter to unlock daily community supplies.",
                    ));
                }
                let in_lineage_guild = self
                    .guilds
                    .iter()
                    .any(|g| g.race.as_ref() == Some(&c.race) && g.members.contains_key(&id));
                self.lineage_claims.insert(id.clone(), day);
                self.deliver(
                    id,
                    0,
                    if in_lineage_guild { 2 } else { 1 },
                    "Daily lineage supply",
                );
            }
            _ => return Err(bad("Unknown social action.")),
        }
        Ok(json!({"ok":true}))
    }
    fn group_action(&mut self, c: &Character, request: &Value) -> ResultApi<()> {
        let action = text(&request["action"]);
        let guild = action.starts_with("guild_");
        let operation = action.split_once('_').map(|s| s.1).unwrap_or("");
        let id = &c.id;
        let target = text(&request["target"]);
        if operation == "invite" {
            self.target(id, target)?;
        }
        let new_id = if operation == "create" {
            self.next()
        } else {
            0
        };
        let groups = if guild {
            &mut self.guilds
        } else {
            &mut self.parties
        };
        if operation == "create" {
            if groups.iter().any(|g| g.members.contains_key(id)) {
                return Err(bad("Leave your current group first."));
            }
            let name = bounded_text(&request["name"], 3, 32)?;
            if groups
                .iter()
                .any(|g| g.name.to_lowercase() == name.to_lowercase())
            {
                return Err(bad("That group name is in use."));
            }
            groups.push(Group {
                version: DATA_VERSION,
                id: new_id,
                name,
                owner: id.clone(),
                race: if request["raceOnly"] == true {
                    Some(c.race.clone())
                } else {
                    None
                },
                members: HashMap::from([(id.clone(), "leader".into())]),
                invitations: HashSet::new(),
                tabard: Tabard::default(),
            });
            return Ok(());
        }
        let group_id = number(request, "group", 1, u64::MAX)?;
        if operation == "join" && groups.iter().any(|g| g.members.contains_key(id)) {
            return Err(bad("Leave your current group first."));
        }
        let index = groups
            .iter()
            .position(|g| g.id == group_id)
            .ok_or_else(|| bad("Group not found."))?;
        let g = &mut groups[index];
        let leader = &g.owner == id;
        let officer = leader || g.members.get(id).is_some_and(|r| r == "officer");
        match operation {
            "join" => {
                if !g.invitations.contains(id) || g.race.as_ref().is_some_and(|r| r != &c.race) {
                    return Err(forbidden());
                }
                if g.members.len() >= if guild { 100 } else { 8 } {
                    return Err(bad("This group is full."));
                }
                g.invitations.remove(id);
                g.members.insert(id.clone(), "member".into());
            }
            "decline" => {
                g.invitations.remove(id);
            }
            "invite" if officer => {
                if g.invitations.len() >= 100 || g.members.contains_key(target) {
                    return Err(bad("Already a member or invitation list full."));
                }
                if g.race
                    .as_ref()
                    .is_some_and(|r| self.profiles.get(target).is_none_or(|p| &p.race != r))
                {
                    return Err(bad("This charter is reserved for your lineage."));
                }
                g.invitations.insert(target.into());
            }
            "leave" if g.members.contains_key(id) => {
                if leader && g.members.len() > 1 {
                    return Err(bad("Transfer leadership before leaving."));
                }
                g.members.remove(id);
                if g.members.is_empty() {
                    groups.remove(index);
                }
            }
            "kick" if officer => {
                if target == g.owner
                    || (!leader && g.members.get(target).is_some_and(|r| r == "officer"))
                {
                    return Err(forbidden());
                }
                g.members.remove(target);
                g.invitations.remove(target);
            }
            "promote" if leader => {
                if target == id {
                    return Err(bad("Use leadership transfer for the leader role."));
                }
                let member = g
                    .members
                    .get_mut(target)
                    .ok_or_else(|| bad("Member not found."))?;
                let role = text(&request["role"]);
                if !["member", "officer"].contains(&role) {
                    return Err(bad("Invalid role."));
                }
                *member = role.into();
            }
            "transfer" if leader && g.members.contains_key(target) => {
                g.members.insert(id.clone(), "officer".into());
                g.members.insert(target.into(), "leader".into());
                g.owner = target.into();
            }
            "tabard" if guild && officer => {
                let tabard: Tabard = serde_json::from_value(request["tabard"].clone())
                    .map_err(|_| bad("Invalid tabard."))?;
                if !valid_color(&tabard.base)
                    || !valid_color(&tabard.trim)
                    || !["stripe", "cross", "split"].contains(&tabard.pattern.as_str())
                    || !["signal", "star", "tower"].contains(&tabard.emblem.as_str())
                {
                    return Err(bad("Choose valid colors, a pattern, and an emblem."));
                }
                g.tabard = tabard;
            }
            _ => return Err(forbidden()),
        }
        Ok(())
    }
}
fn pair(f: &Contact, a: &str, b: &str) -> bool {
    (f.from == a && f.to == b) || (f.from == b && f.to == a)
}
fn valid_color(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s.bytes().skip(1).all(|b| b.is_ascii_hexdigit())
}
fn forbidden() -> ApiError {
    ApiError(
        StatusCode::FORBIDDEN,
        "This character cannot access that community or action.",
    )
}
fn bounded_text(value: &Value, min: usize, max: usize) -> ResultApi<String> {
    let s = text(value).trim();
    if !(min..=max).contains(&s.chars().count())
        || s.chars().any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err(bad(
            "Text is empty, too long, or contains control characters.",
        ));
    }
    Ok(s.into())
}
fn number(v: &Value, key: &str, min: u64, max: u64) -> ResultApi<u64> {
    v[key]
        .as_u64()
        .filter(|n| *n >= min && *n <= max)
        .ok_or_else(|| bad("Invalid quantity, price, duration, or identifier."))
}

impl SocialState {
    fn stage(
        &self,
        mut saved: StoredCharacter,
        request: Value,
        data: &Content,
        now: u64,
    ) -> ResultApi<(Option<Self>, StoredCharacter, Value)> {
        let id = saved.character.id.clone();
        if self
            .characters
            .get(&id)
            .is_some_and(|s| s.character.revision > saved.character.revision)
        {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Character state changed; reconnect before continuing.",
            ));
        }
        let request_id = text(&request["requestId"]);
        if request_id.len() != 36
            || !request_id
                .bytes()
                .all(|b| b.is_ascii_hexdigit() || b == b'-')
        {
            return Err(bad("A unique request ID is required."));
        }
        if let Some((_, receipt)) = self
            .receipts
            .get(&id)
            .and_then(|receipts| receipts.iter().find(|(key, _)| key == request_id))
        {
            if receipt["request"] != request {
                return Err(bad("A request ID cannot be reused for a different action."));
            }
            return Ok((None, saved, receipt["result"].clone()));
        }
        let mut next = self.clone();
        next.expire(now);
        let result = next.apply(&mut saved, &request, data, now)?;
        saved.character.revision += 1;
        next.revision += 1;
        next.characters.insert(id.clone(), saved.clone());
        let response = json!({"version":DATA_VERSION,"revision":next.revision,"result":result});
        // Receipts are retained: a retried monetary request must never execute twice.
        next.receipts.entry(id).or_default().push((
            request_id.into(),
            json!({"request":request,"result":response}),
        ));
        Ok((Some(next), saved, response))
    }
}

impl Database {
    pub(super) fn social_transaction(
        &self,
        saved: StoredCharacter,
        request: Value,
        data: &Content,
    ) -> ResultApi<(StoredCharacter, Value)> {
        let mut state = self.social.lock().map_err(|_| internal())?;
        if self.write_failed.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(internal());
        }
        if text(&request["action"]) == "export" {
            return Ok((saved.clone(), self.character_export(&saved, &state)?));
        }
        let (next, saved, response) = state.stage(saved, request, data, now_seconds())?;
        if let Some(next) = next {
            self.atomic(&self.root.join("social.json"), &next)
                .map_err(|_| internal())?;
            *state = next;
        }
        Ok((saved, response))
    }
    pub(super) fn expire_auctions(&self) -> ResultApi<()> {
        let mut state = self.social.lock().map_err(|_| internal())?;
        if !state
            .auctions
            .iter()
            .any(|a| a.status == "open" && a.expires <= now_seconds())
        {
            return Ok(());
        }
        let mut next = state.clone();
        next.expire(now_seconds());
        next.revision += 1;
        self.atomic(&self.root.join("social.json"), &next)
            .map_err(|_| internal())?;
        *state = next;
        Ok(())
    }
    pub(super) fn prepare_delete(&self, id: &str) -> ResultApi<()> {
        let mut state = self.social.lock().map_err(|_| internal())?;
        if state
            .guilds
            .iter()
            .chain(&state.parties)
            .any(|g| g.members.contains_key(id))
            || state
                .auctions
                .iter()
                .any(|a| a.status == "open" && (a.seller == id || a.bidder.as_deref() == Some(id)))
            || state
                .deliveries
                .iter()
                .any(|d| d.recipient == id && !d.claimed)
        {
            return Err(bad(
                "Leave your guild and party, settle auctions, and claim deliveries before deleting this character.",
            ));
        }
        let mut next = state.clone();
        next.profiles.remove(id);
        for g in next.guilds.iter_mut().chain(&mut next.parties) {
            g.invitations.remove(id);
        }
        next.contacts.retain(|f| f.from != id && f.to != id);
        next.revision += 1;
        self.atomic(&self.root.join("social.json"), &next)
            .map_err(|_| internal())?;
        *state = next;
        Ok(())
    }
    fn character_export(&self, saved: &StoredCharacter, s: &SocialState) -> ResultApi<Value> {
        if self.write_failed.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(internal());
        }
        let id = &saved.character.id;
        let posts: Vec<_> = s
            .posts
            .iter()
            .filter(|p| &p.author == id || p.recipient.as_ref() == Some(id))
            .collect();
        let payload = json!({"format":"sloperberpunk-character","version":DATA_VERSION,
            "authority":"server","exportedAt":now_seconds(),"serverKey":self.signer.public(),
            "character":saved.character,"cooldowns":saved.cooldowns,"globalReady":saved.global_ready,"dashReady":saved.dash_ready,
            "social":{"version":DATA_VERSION,"revision":s.revision,
                "guilds":s.guilds.iter().filter(|g|g.members.contains_key(id)||g.invitations.contains(id)).collect::<Vec<_>>(),
                "parties":s.parties.iter().filter(|g|g.members.contains_key(id)||g.invitations.contains(id)).collect::<Vec<_>>(),
                "posts":posts,"threads":s.threads.iter().filter(|t|&t.author==id).collect::<Vec<_>>(),
                "contacts":s.contacts.iter().filter(|f|&f.from==id||&f.to==id).collect::<Vec<_>>(),
                "blocks":s.blocks.get(id),"readThrough":s.read_through.get(id),"lastLineageDay":s.lineage_claims.get(id),
                "auctions":s.auctions.iter().filter(|a|&a.seller==id||a.bidder.as_ref()==Some(id)).collect::<Vec<_>>(),
                "deliveries":s.deliveries.iter().filter(|d|&d.recipient==id).collect::<Vec<_>>(),"receipts":s.receipts.get(id)}});
        self.signer.sign(payload)
    }
}
impl Shard {
    pub(super) async fn social_command(
        &mut self,
        id: &str,
        owner: &str,
        request: Value,
    ) -> ResultApi<Value> {
        let p = self
            .players
            .get(id)
            .filter(|p| p.owner == owner)
            .ok_or_else(|| {
                bad("Enter the world with this character before using community actions.")
            })?;
        let saved = saved_player(p, self.time);
        let db = self.db.clone();
        let data = self.content.clone();
        let (saved, result) =
            tokio::task::spawn_blocking(move || db.social_transaction(saved, request, &data))
                .await
                .map_err(|_| internal())??;
        if let Some(p) = self.players.get_mut(id) {
            p.c = saved.character;
            p.dirty = true;
        }
        Ok(result)
    }
}

#[derive(Default, Deserialize)]
pub(super) struct Browse {
    #[serde(default)]
    view: String,
    #[serde(default)]
    channel: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    section: String,
    thread: Option<u64>,
    before: Option<u64>,
    #[serde(default)]
    search: String,
}
fn page<T: Serialize>(rows: impl Iterator<Item = (u64, T)>, before: Option<u64>) -> Value {
    let mut rows: Vec<_> = rows
        .filter(|(id, _)| before.is_none_or(|b| *id < b))
        .collect();
    rows.sort_unstable_by(|a, b| b.0.cmp(&a.0));
    let more = rows.len() > PAGE;
    rows.truncate(PAGE);
    json!({"items":rows.iter().map(|(_, value)|value).collect::<Vec<_>>(),"before":if more { rows.last().map(|r|r.0) } else { None }})
}
impl SocialState {
    fn browse(&self, c: &Character, query: &Browse, active: &HashSet<String>) -> ResultApi<Value> {
        let id = &c.id;
        let visible = |p: &&Post| !self.blocks.get(id).is_some_and(|b| b.contains(&p.author));
        let result = match query.view.as_str() {
            "chat" => {
                if !self.channel(c, &query.channel, false) { return Err(forbidden()); }
                page(self.posts.iter().filter(|p| p.channel == query.channel && p.thread.is_none() && p.recipient.is_none()).filter(visible).map(|p| (p.id, p)), query.before)
            }
            "dm" => {
                if !valid_id(&query.target) { return Err(bad("Choose a player to message.")); }
                page(self.posts.iter().filter(|p| p.channel == "dm" && ((&p.author == id && p.recipient.as_ref() == Some(&query.target)) || (p.author == query.target && p.recipient.as_ref() == Some(id)))).map(|p| (p.id, p)), query.before)
            }
            "forum" => {
                if let Some(thread) = query.thread {
                    let t = self.threads.iter().find(|t| t.id == thread).ok_or_else(|| bad("Thread not found."))?;
                    if !self.channel(c, &t.section, true) { return Err(forbidden()); }
                    let mut result = page(self.posts.iter().filter(|p| p.thread == Some(thread)).filter(visible).map(|p| (p.id, p)), query.before);
                    result["thread"] = json!(t); result
                } else {
                    if !self.channel(c, &query.section, true) { return Err(forbidden()); }
                    page(self.threads.iter().filter(|t| t.section == query.section && !self.blocks.get(id).is_some_and(|b| b.contains(&t.author))).map(|t| (t.id, t)), query.before)
                }
            }
            "auctions" => page(self.auctions.iter().filter(|a| a.status == "open" || &a.seller == id || a.bidder.as_ref() == Some(id)).map(|a| (a.id, a)), query.before),
            "deliveries" => page(self.deliveries.iter().filter(|d| &d.recipient == id && !d.claimed).map(|d| (d.id, d)), query.before),
            "guilds" => page(self.guilds.iter().filter(|g| g.name.to_lowercase().contains(&query.search.to_lowercase())).map(|g| (g.id, json!({"id":g.id,"name":g.name,"race":g.race,"members":g.members.len(),"leader":g.owner,"tabard":g.tabard}))), query.before),
            "people" => {
                // Stable ID cursor is separate from post cursors; numeric offset is safe for this directory.
                let mut people: Vec<_> = self.profiles.values().filter(|p| p.name.to_lowercase().contains(&query.search.to_lowercase()) || p.id == query.search).collect();
                people.sort_by(|a,b| a.id.cmp(&b.id));
                let start = query.before.unwrap_or(0).min(people.len() as u64) as usize;
                json!({"items":people.iter().skip(start).take(PAGE).map(|p|json!({"id":p.id,"name":p.name,"race":p.race,"online":active.contains(&p.id)})).collect::<Vec<_>>(),"before":if start+PAGE<people.len(){Some(start+PAGE)}else{None}})
            }
            "" | "summary" => {
                let guild = self.guilds.iter().find(|g|g.members.contains_key(id));
                let party = self.parties.iter().find(|g|g.members.contains_key(id));
                let contacts: Vec<_> = self.contacts.iter().filter(|f| &f.from == id || &f.to == id).map(|f| {
                    let other = if &f.from == id { &f.to } else { &f.from };
                    json!({"id":other,"profile":self.profiles.get(other),"online":active.contains(other),"accepted":f.accepted,"incoming":&f.to==id})
                }).collect();
                let mut inbox: HashMap<String, Value> = HashMap::new();
                for p in self.posts.iter().filter(|p| p.channel == "dm" && (&p.author == id || p.recipient.as_ref() == Some(id))) {
                    let other = if &p.author == id { p.recipient.as_ref().unwrap() } else { &p.author };
                    let read = self.read_through.get(id).and_then(|r| r.get(other)).copied().unwrap_or(0);
                    let item = inbox.entry(other.clone()).or_insert_with(|| json!({"id":other,"profile":self.profiles.get(other),"unread":0,"latest":0}));
                    if &p.author != id && p.id > read && !self.blocked(id, other) { item["unread"] = json!(item["unread"].as_u64().unwrap_or(0)+1); }
                    item["latest"] = json!(p.id);
                }
                let mut inbox: Vec<_> = inbox.into_values().collect();
                inbox.sort_by_key(|r| std::cmp::Reverse(r["latest"].as_u64().unwrap_or(0)));
                let mut channels = vec!["world".to_owned(),"trade".into(),format!("race:{}",c.race)];
                if let Some(g) = guild { channels.push(format!("guild:{}",g.id)); }
                if let Some(g) = party { channels.push(format!("party:{}",g.id)); }
                let member_ids: HashSet<_> = guild.into_iter().chain(party).flat_map(|g|g.members.keys()).collect();
                json!({"guild":guild,"party":party,"channels":channels,
                    "members":member_ids.iter().map(|id|json!({"id":id,"profile":self.profiles.get(*id),"online":active.contains(*id)})).collect::<Vec<_>>(),
                    "guildInvites":self.guilds.iter().filter(|g|g.invitations.contains(id)).map(|g|json!({"id":g.id,"name":g.name,"race":g.race})).collect::<Vec<_>>(),
                    "partyInvites":self.parties.iter().filter(|g|g.invitations.contains(id)).map(|g|json!({"id":g.id,"name":g.name})).collect::<Vec<_>>(),
                    "contacts":contacts,"inbox":inbox,"blocked":self.blocks.get(id),
                    "deliveries":self.deliveries.iter().filter(|d|&d.recipient==id&&!d.claimed).count(),
                    "lineageClaimed":self.lineage_claims.get(id)==Some(&(now_seconds()/86400))})
            }
            _ => return Err(bad("Unknown community view.")),
        };
        Ok(
            json!({"version":DATA_VERSION,"revision":self.revision,"serverTime":now_millis(),"data":result}),
        )
    }
}
fn rate(app: &App, username: &str, write: bool) -> ResultApi<()> {
    let mut rates = app.social_rates.lock().map_err(|_| internal())?;
    rates.retain(|_, r| r.start.elapsed() < Duration::from_secs(60));
    let key = format!("{username}:{}", if write { "write" } else { "read" });
    let rate = rates.entry(key).or_insert(Rate {
        start: Instant::now(),
        count: 0,
    });
    rate.count += 1;
    if rate.count > if write { 30 } else { 180 } {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Community requests are too frequent. Wait a minute.",
        ));
    }
    Ok(())
}
fn owned(db: &Database, id: &str, username: &str) -> ResultApi<StoredCharacter> {
    if !valid_id(id) {
        return Err(bad("Invalid character ID."));
    }
    let _guard = db.mutation.lock().map_err(|_| internal())?;
    let account = db.account(username).map_err(|_| internal())?;
    if !account.characters.iter().any(|c| c == id) {
        return Err(ApiError(StatusCode::NOT_FOUND, "Character not found."));
    }
    let saved = db.character(id).map_err(|_| internal())?;
    if saved.owner != username {
        return Err(forbidden());
    }
    Ok(saved)
}
pub(super) async fn read(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    Query(query): Query<Browse>,
    headers: HeaderMap,
) -> ResultApi<Json<Value>> {
    let (_, session) = authenticate(&headers, &app)?;
    rate(&app, &session.username, false)?;
    if query.search.len() > 128 {
        return Err(bad("Search is too long."));
    }
    let result = tokio::task::spawn_blocking(move || {
        let saved = owned(&app.db, &id, &session.username)?;
        app.db.expire_auctions()?;
        // Copy the lease set first: admission and deletion lock active before storage.
        let active = app.active.lock().map_err(|_| internal())?.clone();
        app.db
            .social
            .lock()
            .map_err(|_| internal())?
            .browse(&saved.character, &query, &active)
    })
    .await
    .map_err(|_| internal())??;
    Ok(Json(result))
}
fn shard_index(id: &str, count: usize) -> usize {
    id.bytes().fold(0usize, |h, b| {
        h.wrapping_mul(31).wrapping_add(usize::from(b))
    }) % count
}
pub(super) async fn write(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<Value>,
) -> ResultApi<Json<Value>> {
    mutation(&headers, &app)?;
    let (_, session) = authenticate(&headers, &app)?;
    rate(&app, &session.username, true)?;
    if !valid_id(&id)
        || request["version"] != DATA_VERSION
        || text(&request["action"]) == "register"
        || text(&request["action"]) == "export"
    {
        return Err(bad("Invalid community request."));
    }
    let (tx, rx) = oneshot::channel();
    app.shards[shard_index(&id, app.shards.len())]
        .try_send(Command::Social {
            id,
            owner: session.username,
            request,
            reply: tx,
        })
        .map_err(|_| {
            ApiError(
                StatusCode::SERVICE_UNAVAILABLE,
                "Community queue is busy. Retry the same request.",
            )
        })?;
    Ok(Json(rx.await.map_err(|_| internal())??))
}
pub(super) async fn export(
    State(app): State<Arc<App>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> ResultApi<Response> {
    let (_, session) = authenticate(&headers, &app)?;
    rate(&app, &session.username, true)?;
    let check_app = app.clone();
    let check_id = id.clone();
    let owner = session.username.clone();
    // Admission/deletion and offline export share the active lease lock. The character
    // and community data in an offline export cannot straddle a new world session.
    let offline = tokio::task::spawn_blocking(move || -> ResultApi<Option<Value>> {
        let active = check_app.active.lock().map_err(|_| internal())?;
        let saved = owned(&check_app.db, &check_id, &owner)?;
        if active.contains(&check_id) {
            return Ok(None);
        }
        let state = check_app.db.social.lock().map_err(|_| internal())?;
        Ok(Some(check_app.db.character_export(&saved, &state)?))
    })
    .await
    .map_err(|_| internal())??;
    let result = if let Some(offline) = offline {
        offline
    } else {
        let (tx, rx) = oneshot::channel();
        app.shards[shard_index(&id, app.shards.len())]
            .try_send(Command::Social {
                id: id.clone(),
                owner: session.username,
                request: json!({"action":"export"}),
                reply: tx,
            })
            .map_err(|_| internal())?;
        rx.await.map_err(|_| internal())??
    };
    let mut response = Json(result).into_response();
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"sloperberpunk-{id}.json\""))
            .map_err(|_| internal())?,
    );
    Ok(response)
}
pub(super) async fn public_key(State(app): State<Arc<App>>) -> Json<Value> {
    Json(app.db.signer.public())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Content {
        Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap()
    }
    fn runner(letter: char, race: &str) -> StoredCharacter {
        serde_json::from_value(json!({"version":2,"owner":format!("user_{letter}"),"character":{
            "version":2,"revision":0,"id":letter.to_string().repeat(64),"name":format!("Runner {letter}"),
            "race":race,"faction":"relay","level":5,"xp":0,"credits":1000,"position":[0,0,0],"yaw":0,
            "health":100,"energy":100,"medkits":10,"weaponRank":0,"talents":{},"activeQuests":{},"completed":[],"introSeen":true}})).unwrap()
    }
    fn request(mut value: Value) -> Value {
        static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        value["requestId"] = json!(format!(
            "{:036x}",
            SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        value["version"] = json!(DATA_VERSION);
        value
    }
    fn commit(
        s: &mut SocialState,
        c: &mut StoredCharacter,
        value: Value,
        now: u64,
    ) -> ResultApi<Value> {
        let (next, saved, result) = s.stage(c.clone(), request(value), &content(), now)?;
        if let Some(next) = next {
            *s = next;
        }
        *c = saved;
        Ok(result)
    }
    fn register(s: &mut SocialState, c: &mut StoredCharacter) {
        commit(s, c, json!({"action":"register"}), 1).unwrap();
    }

    #[test]
    fn lineage_and_guild_channels_and_forum_replies_enforce_membership() {
        let mut s = SocialState::default();
        let mut a = runner('a', "human");
        let mut b = runner('b', "lattice");
        register(&mut s, &mut a);
        register(&mut s, &mut b);
        assert!(
            commit(
                &mut s,
                &mut b,
                json!({"action":"chat","channel":"race:human","body":"forged"}),
                2
            )
            .is_err()
        );
        let thread = commit(
            &mut s,
            &mut a,
            json!({"action":"thread","section":"race:human","title":"Our hall","body":"Welcome"}),
            2,
        )
        .unwrap()["result"]["thread"]
            .as_u64()
            .unwrap();
        assert!(
            commit(
                &mut s,
                &mut b,
                json!({"action":"reply","thread":thread,"body":"forged"}),
                2
            )
            .is_err()
        );
        assert!(
            s.browse(
                &b.character,
                &Browse {
                    view: "forum".into(),
                    thread: Some(thread),
                    ..Browse::default()
                },
                &HashSet::new()
            )
            .is_err()
        );
        commit(
            &mut s,
            &mut a,
            json!({"action":"guild_create","name":"Public wire","raceOnly":false}),
            3,
        )
        .unwrap();
        let guild = s.guilds[0].id;
        assert!(
            commit(
                &mut s,
                &mut b,
                json!({"action":"guild_join","group":guild}),
                4
            )
            .is_err()
        );
        let bid = b.character.id.clone();
        commit(
            &mut s,
            &mut a,
            json!({"action":"guild_invite","group":guild,"target":bid}),
            4,
        )
        .unwrap();
        commit(
            &mut s,
            &mut b,
            json!({"action":"guild_join","group":guild}),
            5,
        )
        .unwrap();
        let tabard = json!({"base":"#123456","trim":"#ffffff","pattern":"cross","emblem":"star"});
        assert!(
            commit(
                &mut s,
                &mut b,
                json!({"action":"guild_tabard","group":guild,"tabard":tabard}),
                5
            )
            .is_err()
        );
        commit(
            &mut s,
            &mut a,
            json!({"action":"guild_tabard","group":guild,"tabard":tabard}),
            6,
        )
        .unwrap();
        assert_eq!(
            s.guild_badge(&b.character.id).unwrap()["tabard"]["emblem"],
            "star"
        );
        commit(
            &mut s,
            &mut b,
            json!({"action":"guild_leave","group":guild}),
            7,
        )
        .unwrap();
        assert!(!s.channel(&b.character, &format!("guild:{guild}"), false));
    }
    #[test]
    fn private_messages_are_participant_only_persistent_and_blockable() {
        let mut s = SocialState::default();
        let mut a = runner('a', "human");
        let mut b = runner('b', "lattice");
        let c = runner('c', "bloom");
        register(&mut s, &mut a);
        register(&mut s, &mut b);
        let bid = b.character.id.clone();
        let aid = a.character.id.clone();
        commit(
            &mut s,
            &mut a,
            json!({"action":"dm","target":bid,"body":"Offline delivery"}),
            2,
        )
        .unwrap();
        let s: SocialState = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        let query = Browse {
            view: "dm".into(),
            target: aid.clone(),
            ..Browse::default()
        };
        assert_eq!(
            s.browse(&b.character, &query, &HashSet::new()).unwrap()["data"]["items"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert!(
            s.browse(&c.character, &query, &HashSet::new()).unwrap()["data"]["items"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        let mut s = s;
        commit(&mut s, &mut b, json!({"action":"block","target":aid}), 3).unwrap();
        assert!(
            commit(
                &mut s,
                &mut a,
                json!({"action":"dm","target":bid,"body":"Blocked"}),
                4
            )
            .is_err()
        );
        assert_eq!(s.posts.len(), 1);
    }
    #[test]
    fn chat_history_has_stable_older_pages_without_losing_new_messages() {
        let mut s = SocialState::default();
        let a = runner('a', "human");
        for i in 0..85 {
            s.post(
                &a.character,
                format!("Message {i}"),
                "world".into(),
                None,
                None,
                i,
            );
        }
        let query = Browse {
            view: "chat".into(),
            channel: "world".into(),
            ..Browse::default()
        };
        let first = s.browse(&a.character, &query, &HashSet::new()).unwrap();
        assert_eq!(first["data"]["items"].as_array().unwrap().len(), 40);
        let cursor = first["data"]["before"].as_u64().unwrap();
        s.post(
            &a.character,
            "New message".into(),
            "world".into(),
            None,
            None,
            100,
        );
        let next = s
            .browse(
                &a.character,
                &Browse {
                    before: Some(cursor),
                    ..query
                },
                &HashSet::new(),
            )
            .unwrap();
        assert!(
            next["data"]["items"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p["id"].as_u64().unwrap() < cursor)
        );
    }
    #[test]
    fn auction_escrow_refunds_and_settlement_conserve_items_and_currency() {
        let mut s = SocialState::default();
        let mut seller = runner('a', "human");
        let mut buyer = runner('b', "lattice");
        let mut rival = runner('c', "bloom");
        register(&mut s, &mut seller);
        register(&mut s, &mut buyer);
        register(&mut s, &mut rival);
        let auction = commit(
            &mut s,
            &mut seller,
            json!({"action":"auction_list","quantity":3,"minimum":10,"buyout":100,"hours":1}),
            10,
        )
        .unwrap()["result"]["auction"]
            .as_u64()
            .unwrap();
        assert_eq!(seller.character.medkits, 7);
        commit(
            &mut s,
            &mut buyer,
            json!({"action":"auction_bid","auction":auction,"amount":20}),
            11,
        )
        .unwrap();
        assert_eq!(buyer.character.credits, 980);
        assert!(
            commit(
                &mut s,
                &mut seller,
                json!({"action":"auction_cancel","auction":auction}),
                12
            )
            .is_err()
        );
        commit(
            &mut s,
            &mut rival,
            json!({"action":"auction_buy","auction":auction}),
            12,
        )
        .unwrap();
        assert_eq!(rival.character.credits, 900);
        assert_eq!(s.auctions[0].status, "sold");
        assert_eq!(s.deliveries.iter().map(|d| d.credits).sum::<u64>(), 115);
        assert_eq!(s.deliveries.iter().map(|d| d.medkits).sum::<u32>(), 3);
        assert!(
            commit(
                &mut s,
                &mut buyer,
                json!({"action":"auction_buy","auction":auction}),
                13
            )
            .is_err()
        );
        let refund = s
            .deliveries
            .iter()
            .find(|d| d.recipient == buyer.character.id)
            .unwrap()
            .id;
        commit(
            &mut s,
            &mut buyer,
            json!({"action":"claim","delivery":refund}),
            14,
        )
        .unwrap();
        assert_eq!(buyer.character.credits, 1000);
        assert!(
            commit(
                &mut s,
                &mut buyer,
                json!({"action":"claim","delivery":refund}),
                15
            )
            .is_err()
        );
        let count = s.deliveries.len();
        s.expire(10000);
        assert_eq!(s.deliveries.len(), count);
    }
    #[test]
    fn auctions_expire_once_after_restart_and_partial_claims_preserve_overflow() {
        let mut s = SocialState::default();
        let mut a = runner('a', "human");
        register(&mut s, &mut a);
        commit(
            &mut s,
            &mut a,
            json!({"action":"auction_list","quantity":5,"minimum":1,"buyout":10,"hours":1}),
            10,
        )
        .unwrap();
        let mut s: SocialState = serde_json::from_slice(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert!(s.expire(3610));
        assert!(!s.expire(3611));
        assert_eq!(s.deliveries.len(), 1);
        let delivery = s.deliveries[0].id;
        a.character.medkits = content().rule("inventory", "slots") as u32 - 2;
        commit(
            &mut s,
            &mut a,
            json!({"action":"claim","delivery":delivery}),
            3612,
        )
        .unwrap();
        assert_eq!(s.deliveries[0].medkits, 3);
        assert!(!s.deliveries[0].claimed);
        assert!(
            commit(
                &mut s,
                &mut a,
                json!({"action":"claim","delivery":delivery}),
                3613
            )
            .is_err()
        );
    }
    #[test]
    fn transaction_retries_and_failed_mutations_cannot_double_spend() {
        let mut s = SocialState::default();
        let mut a = runner('a', "human");
        let mut b = runner('b', "lattice");
        register(&mut s, &mut a);
        register(&mut s, &mut b);
        let original = a.clone();
        let r = request(json!({"action":"gift","target":b.character.id,"amount":30}));
        let (next, saved, result) = s.stage(a.clone(), r.clone(), &content(), 10).unwrap();
        assert_eq!(
            s.deliveries.len(),
            0,
            "Staging must not publish an uncommitted transaction"
        );
        s = next.unwrap();
        a = saved;
        let persisted = serde_json::to_vec(&s).unwrap();
        let recovered: SocialState = serde_json::from_slice(&persisted).unwrap();
        assert_eq!(recovered.characters[&a.character.id].character.credits, 970);
        let (no_write, retry, repeated) = recovered
            .stage(a.clone(), r.clone(), &content(), 11)
            .unwrap();
        assert!(no_write.is_none());
        assert_eq!(retry.character.credits, 970);
        assert_eq!(repeated, result);
        assert!(
            recovered
                .stage(original, r.clone(), &content(), 11)
                .is_err(),
            "Stale checkpoints cannot re-enter a transaction"
        );
        let mut forged = r;
        forged["amount"] = json!(31);
        assert!(recovered.stage(a.clone(), forged, &content(), 12).is_err());
        assert!(
            commit(
                &mut s,
                &mut a,
                json!({"action":"gift","target":b.character.id,"amount":2000}),
                13
            )
            .is_err()
        );
        assert_eq!(serde_json::to_vec(&s).unwrap(), persisted);
    }
    #[test]
    fn lineage_rewards_require_campaign_progress_and_reset_only_on_utc_day_boundary() {
        let mut s = SocialState::default();
        let mut a = runner('a', "human");
        register(&mut s, &mut a);
        assert!(commit(&mut s, &mut a, json!({"action":"lineage_reward"}), 86401).is_err());
        a.character.completed.push(
            content()
                .quests
                .iter()
                .find(|q| q.race.as_deref() == Some("human"))
                .unwrap()
                .id
                .clone(),
        );
        commit(
            &mut s,
            &mut a,
            json!({"action":"guild_create","name":"Afterborn care","raceOnly":true}),
            86401,
        )
        .unwrap();
        commit(&mut s, &mut a, json!({"action":"lineage_reward"}), 86402).unwrap();
        assert_eq!(s.deliveries[0].medkits, 2);
        assert!(commit(&mut s, &mut a, json!({"action":"lineage_reward"}), 172799).is_err());
        commit(&mut s, &mut a, json!({"action":"lineage_reward"}), 172800).unwrap();
        assert_eq!(s.deliveries.len(), 2);
    }
    #[test]
    fn export_signature_covers_the_exact_payload_and_legacy_versions_migrate() {
        let record = KeyFile {
            version: 2,
            algorithm: "Ed25519".into(),
            secret: [7; 32],
        };
        let identity = SigningIdentity {
            key: SigningKey::from_bytes(&record.secret),
            record,
        };
        let envelope = identity
            .sign(json!({"version":2,"character":{"credits":100}}))
            .unwrap();
        let signature: Vec<u8> = text(&envelope["signature"])
            .as_bytes()
            .chunks(2)
            .map(|b| u8::from_str_radix(std::str::from_utf8(b).unwrap(), 16).unwrap())
            .collect();
        let signature = ed25519_dalek::Signature::from_slice(&signature).unwrap();
        let payload = text(&envelope["payload"]);
        assert!(
            identity
                .key
                .verifying_key()
                .verify_strict(payload.as_bytes(), &signature)
                .is_ok()
        );
        assert!(
            identity
                .key
                .verifying_key()
                .verify_strict(payload.replace("100", "999").as_bytes(), &signature)
                .is_err()
        );
        assert!(envelope.get("secret").is_none());
        let mut legacy = serde_json::to_value(runner('a', "human")).unwrap();
        legacy.as_object_mut().unwrap().remove("version");
        legacy["character"]
            .as_object_mut()
            .unwrap()
            .remove("version");
        let mut saved: StoredCharacter = serde_json::from_value(legacy).unwrap();
        assert_eq!(saved.version, 1);
        migrate_version(&mut saved.version).unwrap();
        migrate_version(&mut saved.character.version).unwrap();
        assert_eq!(saved.version, 2);
        let mut future = 99;
        assert!(migrate_version(&mut future).is_err());
        assert_eq!(future, 99);
    }
}
