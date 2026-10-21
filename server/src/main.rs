// Sloperberpunk — GPL-3.0-or-later. See ../../LICENSE.
// One service owns gameplay, transport, frontend delivery, and persistence.
#![forbid(unsafe_code)]

mod config;
mod dungeons;
mod founders;
mod ghostline;
mod social;
mod web;
use ghostline::{GhostTrail, Ghostline};
use social::{SigningIdentity, SocialState};

use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier, password_hash::SaltString};
use axum::{
    Json, Router,
    extract::{
        ConnectInfo, DefaultBodyLimit, Path, Query, State, WebSocketUpgrade,
        ws::{Message, WebSocket},
    },
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Write},
    net::{IpAddr, SocketAddr},
    path::{Path as FsPath, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{Semaphore, mpsc, oneshot};

type Vec3 = [f64; 3];
type ResultApi<T> = Result<T, ApiError>;
#[derive(Debug)]
struct ApiError(StatusCode, &'static str);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
fn bad(text: &'static str) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, text)
}
fn internal() -> ApiError {
    ApiError(
        StatusCode::INTERNAL_SERVER_ERROR,
        "The server could not persist this change.",
    )
}
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or("")
}
fn dist(a: Vec3, b: Vec3) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}
fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn token() -> ResultApi<String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| internal())?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn valid_user(s: &str) -> bool {
    (3..=24).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
}
fn valid_id(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
}
fn valid_name(s: &str) -> bool {
    (2..=24).contains(&s.chars().count())
        && s.chars().all(|c| c.is_alphanumeric() || " _-".contains(c))
}
fn read_json<T: for<'de> Deserialize<'de>>(path: impl AsRef<FsPath>) -> io::Result<T> {
    serde_json::from_slice(&fs::read(path)?).map_err(io::Error::other)
}

const DATA_VERSION: u32 = 2;
fn legacy_version() -> u32 {
    1
}
fn migrate_version(version: &mut u32) -> io::Result<()> {
    if !(1..=DATA_VERSION).contains(version) {
        return Err(io::Error::other(
            "Unsupported data version; refusing to overwrite it",
        ));
    }
    *version = DATA_VERSION;
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Character {
    #[serde(default = "legacy_version")]
    version: u32,
    #[serde(default)]
    revision: u64,
    id: String,
    name: String,
    race: String,
    faction: String,
    level: u32,
    xp: u64,
    #[serde(default)]
    founder_halo: Option<u16>,
    #[serde(default)]
    founder_xp_remainder: u8,
    credits: u64,
    position: Vec3,
    yaw: f64,
    health: f64,
    energy: f64,
    medkits: u32,
    weapon_rank: u32,
    talents: HashMap<String, u32>,
    active_quests: HashMap<String, u32>,
    completed: Vec<String>,
    #[serde(default)]
    dungeon_history: HashMap<String, dungeons::History>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    dungeon_return: Option<Vec3>,
    intro_seen: bool,
}
#[derive(Clone, Serialize, Deserialize)]
struct StoredCharacter {
    #[serde(default = "legacy_version")]
    version: u32,
    owner: String,
    character: Character,
    #[serde(default)]
    cooldowns: HashMap<String, f64>,
    #[serde(default)]
    global_ready: f64,
    #[serde(default)]
    dash_ready: f64,
}
#[derive(Serialize, Deserialize)]
struct Account {
    #[serde(default = "legacy_version")]
    version: u32,
    username: String,
    password_hash: String,
    characters: Vec<String>,
    #[serde(default)]
    founder_halo: Option<u16>,
}
#[derive(Clone, Deserialize)]
struct Objective {
    #[serde(rename = "type")]
    kind: String,
    target: String,
    count: u32,
}
#[derive(Clone, Deserialize)]
struct Reward {
    xp: u64,
    credits: u64,
}
#[derive(Clone, Deserialize)]
struct Quest {
    id: String,
    title: String,
    faction: Option<String>,
    race: Option<String>,
    level: u32,
    requires: Vec<String>,
    giver: String,
    briefing: String,
    completion: String,
    objective: Objective,
    reward: Reward,
}
#[derive(Clone, Deserialize)]
struct Ability {
    id: String,
    name: String,
    level: u32,
    cost: f64,
    cooldown: f64,
    range: f64,
    power: f64,
    kind: String,
    color: String,
    #[serde(default)]
    duration: f64,
    #[serde(default)]
    radius: f64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Talent {
    id: String,
    name: String,
    stat: String,
    amount: f64,
    level: u32,
    max_rank: u32,
}
#[derive(Clone, Deserialize)]
struct Npc {
    id: String,
    position: Vec3,
}
#[derive(Clone, Deserialize)]
struct Platform {
    position: Vec3,
    size: Vec3,
}
#[derive(Clone, Deserialize)]
struct Landmark {
    id: String,
    name: String,
    position: Vec3,
}
#[derive(Clone, Deserialize)]
struct Lift {
    id: String,
    position: Vec3,
    stops: Vec<f64>,
}
#[derive(Clone, Deserialize)]
struct Spawn {
    #[serde(rename = "type")]
    kind: String,
    position: Vec3,
    level: u32,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Grid {
    min: i32,
    max: i32,
    spacing: f64,
    width_min: f64,
    width_max: f64,
    height_min: f64,
    height_max: f64,
    exclude_center: f64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Map {
    seed: u32,
    bounds: f64,
    spawn: Vec3,
    building_grid: Grid,
    platforms: Vec<Platform>,
    lifts: Vec<Lift>,
    landmarks: Vec<Landmark>,
    enemy_spawns: Vec<Spawn>,
}
struct Content {
    dungeons: dungeons::Catalog,
    rules: Value,
    races: Vec<Value>,
    factions: Vec<Value>,
    abilities: Vec<Ability>,
    talents: Vec<Talent>,
    quests: Vec<Quest>,
    quest_values: HashMap<String, Value>,
    npcs: Vec<Npc>,
    map: Map,
    enemies: Vec<Value>,
}
impl Content {
    fn load(client: &FsPath) -> io::Result<Self> {
        let dir = client.join("data");
        let manifest: Value = read_json(dir.join("manifest.json"))?;
        if manifest["format"] != "sloperberpunk-content-manifest"
            || manifest["version"] != DATA_VERSION
            || [
                "rules",
                "world",
                "races",
                "factions",
                "quests",
                "dungeons",
                "talents",
                "abilities",
                "enemies",
                "npcs",
                "intro",
                "audio",
                "lore",
                "models",
            ]
            .iter()
            .any(|name| manifest["files"][name] != 1)
        {
            return Err(io::Error::other("Unsupported content schema version"));
        }
        let quests: Vec<Quest> = read_json(dir.join("quests.json"))?;
        let values: Vec<Value> = read_json(dir.join("quests.json"))?;
        let content = Self {
            dungeons: read_json(dir.join("dungeons.json"))?,
            rules: read_json(dir.join("rules.json"))?,
            races: read_json(dir.join("races.json"))?,
            factions: read_json(dir.join("factions.json"))?,
            abilities: read_json(dir.join("abilities.json"))?,
            talents: read_json(dir.join("talents.json"))?,
            quest_values: values
                .into_iter()
                .map(|v| (text(&v["id"]).to_owned(), v))
                .collect(),
            quests,
            npcs: read_json(dir.join("npcs.json"))?,
            map: read_json(dir.join("world.json"))?,
            enemies: read_json(dir.join("enemies.json"))?,
        };
        content.validate()?;
        Ok(content)
    }
    fn validate(&self) -> io::Result<()> {
        self.dungeons.validate(self)?;
        let ghost_rule = |key| self.rule("ghostline", key);
        if ![
            "historySeconds",
            "sampleSeconds",
            "minSeconds",
            "minDistance",
            "armSeconds",
            "triggerRadius",
            "allyMultiplier",
            "energyReturn",
            "maxVisible",
        ]
        .iter()
        .all(|key| ghost_rule(key).is_finite() && ghost_rule(key) > 0.0)
            || ghost_rule("sampleSeconds") < 0.05
            || ghost_rule("historySeconds") > 6.0
            || ghost_rule("minSeconds") < ghost_rule("sampleSeconds")
            || ghost_rule("minSeconds") > ghost_rule("historySeconds")
            || ghost_rule("armSeconds") >= ghost_rule("minSeconds")
            || ghost_rule("maxVisible") > 8.0
            || ghost_rule("maxVisible").fract() != 0.0
            || ghost_rule("allyMultiplier") < 1.0
            || !self.abilities.iter().any(|a| {
                a.id == "ghostline"
                    && a.kind == "ghostline"
                    && a.cooldown > ghost_rule("historySeconds")
                    && a.cost >= ghost_rule("energyReturn")
                    && a.radius > 0.0
            })
        {
            return Err(io::Error::other("Invalid Ghostline rules"));
        }
        let ids: HashSet<_> = self.quests.iter().map(|q| q.id.as_str()).collect();
        if ids.len() != self.quests.len()
            || self.r("levelCap") != 60.0
            || self.rules["network"]["tickHz"] != 20
            || self.map.building_grid.spacing <= 0.0
        {
            return Err(io::Error::other(
                "Invalid rules, map or duplicate quest IDs",
            ));
        }
        for q in &self.quests {
            if q.level > 60
                || q.objective.count == 0
                || q.requires.iter().any(|id| !ids.contains(id.as_str()))
                || !self.npcs.iter().any(|n| n.id == q.giver)
            {
                return Err(io::Error::other(format!("Invalid quest {}", q.id)));
            }
            let valid = match q.objective.kind.as_str() {
                "kill" => self
                    .enemies
                    .iter()
                    .any(|e| text(&e["id"]) == q.objective.target),
                "interact" | "explore" => self
                    .map
                    .landmarks
                    .iter()
                    .any(|l| l.id == q.objective.target),
                _ => false,
            };
            if !valid {
                return Err(io::Error::other(format!("Missing objective {}", q.id)));
            }
        }
        for section in [
            "player",
            "movement",
            "combat",
            "network",
            "inventory",
            "xp",
            "talents",
        ] {
            if !self.rules[section].is_object() {
                return Err(io::Error::other("Missing rules section"));
            }
        }
        Ok(())
    }
    fn r(&self, key: &str) -> f64 {
        num(&self.rules[key])
    }
    fn rule(&self, section: &str, key: &str) -> f64 {
        num(&self.rules[section][key])
    }
}

#[derive(Clone)]
struct Building {
    x: f64,
    z: f64,
    width: f64,
    depth: f64,
    height: f64,
}
struct World {
    map: Map,
    cells: HashMap<(i32, i32), Building>,
}
fn lcg(seed: &mut u32) -> f64 {
    *seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
    f64::from(*seed) / 4294967296.0
}
impl World {
    fn new(map: &Map) -> Self {
        let mut cells = HashMap::new();
        let g = &map.building_grid;
        let mut seed = map.seed;
        for ix in g.min..=g.max {
            for iz in g.min..=g.max {
                let x = f64::from(ix) * g.spacing + g.spacing / 2.0;
                let z = f64::from(iz) * g.spacing + g.spacing / 2.0;
                if x.hypot(z) < g.exclude_center {
                    continue;
                }
                let width = g.width_min + lcg(&mut seed) * (g.width_max - g.width_min);
                let depth = g.width_min + lcg(&mut seed) * (g.width_max - g.width_min);
                let height = g.height_min + lcg(&mut seed) * (g.height_max - g.height_min);
                for _ in 0..3 {
                    lcg(&mut seed);
                }
                cells.insert(
                    (ix, iz),
                    Building {
                        x,
                        z,
                        width,
                        depth,
                        height,
                    },
                );
            }
        }
        Self {
            map: map.clone(),
            cells,
        }
    }
    fn collides(&self, p: Vec3, radius: f64) -> bool {
        let cx = (p[0] / self.map.building_grid.spacing).floor() as i32;
        let cz = (p[2] / self.map.building_grid.spacing).floor() as i32;
        if p[0].abs() > self.map.bounds || p[2].abs() > self.map.bounds {
            return true;
        }
        for x in cx - 1..=cx + 1 {
            for z in cz - 1..=cz + 1 {
                if let Some(b) = self.cells.get(&(x, z)) {
                    if p[1] < b.height
                        && p[1] + 2.1 > 0.0
                        && (p[0] - b.x).abs() < b.width / 2.0 + radius
                        && (p[2] - b.z).abs() < b.depth / 2.0 + radius
                    {
                        return true;
                    }
                }
            }
        }
        false
    }
    fn floor(&self, x: f64, z: f64, previous: f64, next: f64) -> f64 {
        let mut floor = self
            .map
            .platforms
            .iter()
            .filter(|p| {
                (x - p.position[0]).abs() <= p.size[0] / 2.0
                    && (z - p.position[2]).abs() <= p.size[2] / 2.0
                    && previous >= p.position[1] - 0.05
                    && next <= p.position[1]
            })
            .fold(0.0_f64, |a, p| a.max(p.position[1]));
        let spacing = self.map.building_grid.spacing;
        if let Some(b) = self
            .cells
            .get(&((x / spacing).floor() as i32, (z / spacing).floor() as i32))
        {
            if (x - b.x).abs() <= b.width / 2.0
                && (z - b.z).abs() <= b.depth / 2.0
                && previous >= b.height - 0.05
                && next <= b.height
            {
                floor = floor.max(b.height);
            }
        }
        floor
    }
    fn visible(&self, a: Vec3, b: Vec3) -> bool {
        let steps = (dist(a, b) / 2.0).ceil() as u32;
        (1..steps).all(|i| {
            let t = f64::from(i) / f64::from(steps);
            !self.collides(
                [
                    a[0] + (b[0] - a[0]) * t,
                    a[1] + (b[1] - a[1]) * t,
                    a[2] + (b[2] - a[2]) * t,
                ],
                0.0,
            )
        })
    }
}

struct Database {
    root: PathBuf,
    mutation: Mutex<()>,
    _lease: File,
    social: Mutex<SocialState>,
    signer: SigningIdentity,
    write_failed: std::sync::atomic::AtomicBool,
}
impl Database {
    fn open(root: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(root.join("accounts"))?;
        fs::create_dir_all(root.join("characters"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            for p in [&root, &root.join("accounts"), &root.join("characters")] {
                fs::set_permissions(p, fs::Permissions::from_mode(0o700))?;
            }
        }
        let lease = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".instance.lock"))?;
        lease.try_lock().map_err(|e| {
            io::Error::other(format!(
                "The database is already in use or cannot be locked: {e}"
            ))
        })?;
        let social = SocialState::load(&root)?;
        let signer = SigningIdentity::load(&root)?;
        let db = Self {
            root,
            mutation: Mutex::new(()),
            _lease: lease,
            social: Mutex::new(social),
            signer,
            write_failed: std::sync::atomic::AtomicBool::new(false),
        };
        db.signer.persist(&db)?;
        Ok(db)
    }
    fn account_path(&self, name: &str) -> PathBuf {
        self.root.join("accounts").join(format!("{name}.json"))
    }
    fn character_path(&self, id: &str) -> PathBuf {
        self.root.join("characters").join(format!("{id}.json"))
    }
    fn account(&self, name: &str) -> io::Result<Account> {
        let mut account: Account = read_json(self.account_path(name))?;
        migrate_version(&mut account.version)?;
        Ok(account)
    }
    fn character(&self, id: &str) -> io::Result<StoredCharacter> {
        let social = self
            .social
            .lock()
            .map_err(|_| io::Error::other("Social storage lock"))?;
        let mut saved: StoredCharacter = read_json(self.character_path(id))?;
        migrate_version(&mut saved.version)?;
        migrate_version(&mut saved.character.version)?;
        if let Some(committed) = social.characters.get(id) {
            if committed.character.revision > saved.character.revision {
                saved = committed.clone();
            }
        }
        // Ownership comes from the account, including after reconnect or character recreation.
        saved.character.founder_halo = self.account(&saved.owner)?.founder_halo;
        Ok(saved)
    }
    fn atomic<T: Serialize>(&self, path: &FsPath, value: &T) -> io::Result<()> {
        if self.write_failed.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(io::Error::other(
                "Storage durability failed; restart after repairing storage",
            ));
        }
        let suffix = token().map_err(|_| io::Error::other("OS entropy unavailable"))?;
        let pending = path.with_extension(format!("{}.pending", &suffix[..16]));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let result = (|| {
            let mut file = options.open(&pending)?;
            serde_json::to_writer_pretty(&mut file, value).map_err(io::Error::other)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&pending, path)?;
            #[cfg(unix)]
            if let Err(error) = File::open(
                path.parent()
                    .ok_or_else(|| io::Error::other("No parent directory"))?,
            )
            .and_then(|directory| directory.sync_all())
            {
                // Rename committed, but durability is uncertain. Never allow a second transaction
                // against stale memory; recovery must reload the committed file after restart.
                self.write_failed
                    .store(true, std::sync::atomic::Ordering::SeqCst);
                return Err(error);
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&pending);
        }
        result
    }
    fn save_character(&self, saved: &StoredCharacter) -> io::Result<()> {
        // A queued gameplay checkpoint may predate a durable social/economy transaction.
        let social = self
            .social
            .lock()
            .map_err(|_| io::Error::other("Social storage lock"))?;
        if social
            .characters
            .get(&saved.character.id)
            .is_some_and(|c| c.character.revision > saved.character.revision)
        {
            return Ok(());
        }
        self.atomic(&self.character_path(&saved.character.id), saved)
    }
}
#[derive(Clone)]
struct Session {
    username: String,
    expires: u64,
}
struct Rate {
    start: Instant,
    count: u32,
}
struct App {
    db: Arc<Database>,
    content: Arc<Content>,
    sessions: Mutex<HashMap<String, Session>>,
    active: Arc<Mutex<HashSet<String>>>,
    rates: Mutex<HashMap<IpAddr, Rate>>,
    social_rates: Mutex<HashMap<String, Rate>>,
    auth_slots: Arc<Semaphore>,
    dummy_hash: String,
    origins: Vec<String>,
    secure: bool,
    shards: Vec<mpsc::Sender<Command>>,
    dungeon_lobby: mpsc::Sender<Command>,
    saves: mpsc::Sender<Save>,
}
fn origin(headers: &HeaderMap, app: &App) -> ResultApi<()> {
    let supplied = headers
        .get(header::ORIGIN)
        .and_then(|h| h.to_str().ok())
        .ok_or(ApiError(
            StatusCode::FORBIDDEN,
            "A same-origin request is required.",
        ))?;
    if app.origins.iter().any(|s| s == supplied) {
        Ok(())
    } else {
        Err(ApiError(
            StatusCode::FORBIDDEN,
            "This origin is not allowed.",
        ))
    }
}
fn mutation(headers: &HeaderMap, app: &App) -> ResultApi<()> {
    origin(headers, app)?;
    if headers.get("X-Sloperberpunk").and_then(|h| h.to_str().ok()) != Some("1") {
        return Err(ApiError(StatusCode::FORBIDDEN, "Missing request marker."));
    }
    Ok(())
}
fn session_token(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|c| c.trim().strip_prefix("sp_session="))
}
fn authenticate(headers: &HeaderMap, app: &App) -> ResultApi<(String, Session)> {
    let token =
        session_token(headers).ok_or(ApiError(StatusCode::UNAUTHORIZED, "Sign in to continue."))?;
    let sessions = app.sessions.lock().map_err(|_| internal())?;
    let s = sessions
        .get(token)
        .filter(|s| s.expires > now_seconds())
        .ok_or(ApiError(
            StatusCode::UNAUTHORIZED,
            "Your session expired. Sign in again.",
        ))?;
    Ok((token.to_owned(), s.clone()))
}
fn cookie(token: &str, secure: bool, age: u64) -> String {
    format!(
        "sp_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={age}{}",
        if secure { "; Secure" } else { "" }
    )
}
fn rate_limit(app: &App, ip: IpAddr) -> ResultApi<()> {
    let mut rates = app.rates.lock().map_err(|_| internal())?;
    let now = Instant::now();
    rates.retain(|_, r| now.duration_since(r.start) < Duration::from_secs(60));
    if rates.len() >= 10000 && !rates.contains_key(&ip) {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again later.",
        ));
    }
    let rate = rates.entry(ip).or_insert(Rate {
        start: now,
        count: 0,
    });
    rate.count += 1;
    if rate.count > 20 {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many account attempts. Wait a minute.",
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
}
async fn auth(
    app: Arc<App>,
    headers: HeaderMap,
    ip: IpAddr,
    credentials: Credentials,
    register: bool,
) -> ResultApi<Response> {
    mutation(&headers, &app)?;
    rate_limit(&app, ip)?;
    let username = credentials.username.to_ascii_lowercase();
    if !valid_user(&username) || !(12..=128).contains(&credentials.password.chars().count()) {
        return Err(bad(
            "Use a 3–24 character username and a 12–128 character password.",
        ));
    }
    let permit = app.auth_slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "Authentication is busy. Try again shortly.",
        )
    })?;
    let db = app.db.clone();
    let name = username.clone();
    let dummy = app.dummy_hash.clone();
    let founder_halo = tokio::task::spawn_blocking(move || -> ResultApi<Option<u16>> {
        let _permit = permit;
        if register {
            let mut salt_bytes = [0u8; 16];
            getrandom::fill(&mut salt_bytes).map_err(|_| internal())?;
            let salt = SaltString::encode_b64(&salt_bytes).map_err(|_| internal())?;
            let hash = Argon2::default()
                .hash_password(credentials.password.as_bytes(), &salt)
                .map_err(|_| internal())?
                .to_string();
            let _guard = db.mutation.lock().map_err(|_| internal())?;
            if db.account_path(&name).exists() {
                return Err(ApiError(
                    StatusCode::CONFLICT,
                    "This username is already registered.",
                ));
            }
            let founder_halo =
                founders::halo_for_signup(db.founder_account_count().map_err(|_| internal())?);
            db.atomic(
                &db.account_path(&name),
                &Account {
                    version: DATA_VERSION,
                    username: name,
                    password_hash: hash,
                    characters: vec![],
                    founder_halo,
                },
            )
            .map_err(|_| internal())?;
            Ok(founder_halo)
        } else {
            let account = match db.account(&name) {
                Ok(a) => Some(a),
                Err(e) if e.kind() == io::ErrorKind::NotFound => None,
                Err(_) => return Err(internal()),
            };
            let stored = account
                .as_ref()
                .map(|a| a.password_hash.as_str())
                .unwrap_or(&dummy);
            let hash = PasswordHash::new(stored).map_err(|_| internal())?;
            let valid = Argon2::default()
                .verify_password(credentials.password.as_bytes(), &hash)
                .is_ok();
            if !valid || account.is_none() {
                return Err(ApiError(
                    StatusCode::UNAUTHORIZED,
                    "Username or password is incorrect.",
                ));
            }
            Ok(account.and_then(|a| a.founder_halo))
        }
    })
    .await
    .map_err(|_| internal())??;
    let token = token()?;
    let mut sessions = app.sessions.lock().map_err(|_| internal())?;
    sessions.retain(|_, s| s.expires > now_seconds());
    if sessions.len() >= 8192 {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "The session limit has been reached.",
        ));
    }
    sessions.insert(
        token.clone(),
        Session {
            username: username.clone(),
            expires: now_seconds() + 86400,
        },
    );
    let mut response =
        Json(json!({"username":username,"founderHalo":founder_halo})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie(&token, app.secure, 86400)).map_err(|_| internal())?,
    );
    Ok(response)
}
async fn register(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(credentials): Json<Credentials>,
) -> ResultApi<Response> {
    auth(app, headers, peer.ip(), credentials, true).await
}
async fn login(
    State(app): State<Arc<App>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(credentials): Json<Credentials>,
) -> ResultApi<Response> {
    auth(app, headers, peer.ip(), credentials, false).await
}
async fn session(State(app): State<Arc<App>>, headers: HeaderMap) -> ResultApi<Json<Value>> {
    let (_, s) = authenticate(&headers, &app)?;
    let db = app.db.clone();
    let name = s.username.clone();
    let founder_halo =
        tokio::task::spawn_blocking(move || db.account(&name).map(|account| account.founder_halo))
            .await
            .map_err(|_| internal())?
            .map_err(|_| internal())?;
    Ok(Json(
        json!({"username":s.username,"founderHalo":founder_halo}),
    ))
}
async fn logout(State(app): State<Arc<App>>, headers: HeaderMap) -> ResultApi<Response> {
    mutation(&headers, &app)?;
    if let Some(token) = session_token(&headers) {
        app.sessions.lock().map_err(|_| internal())?.remove(token);
    }
    let mut response = Json(json!({"ok":true})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&cookie("", app.secure, 0)).map_err(|_| internal())?,
    );
    Ok(response)
}
async fn characters(State(app): State<Arc<App>>, headers: HeaderMap) -> ResultApi<Json<Value>> {
    let (_, session) = authenticate(&headers, &app)?;
    let db = app.db.clone();
    let chars = tokio::task::spawn_blocking(move || -> ResultApi<Vec<Character>> {
        let _guard = db.mutation.lock().map_err(|_| internal())?;
        let account = db.account(&session.username).map_err(|_| internal())?;
        account
            .characters
            .iter()
            .map(|id| {
                let stored = db.character(id).map_err(|_| internal())?;
                if stored.owner != session.username {
                    return Err(internal());
                }
                Ok(stored.character)
            })
            .collect()
    })
    .await
    .map_err(|_| internal())??;
    Ok(Json(json!({"characters":chars})))
}
#[derive(Deserialize)]
struct NewCharacter {
    name: String,
    race: String,
    faction: String,
}
async fn create_character(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Json(new): Json<NewCharacter>,
) -> ResultApi<Json<Value>> {
    mutation(&headers, &app)?;
    let (_, session) = authenticate(&headers, &app)?;
    if !valid_name(new.name.trim())
        || !app.content.races.iter().any(|r| text(&r["id"]) == new.race)
        || !app
            .content
            .factions
            .iter()
            .any(|f| text(&f["id"]) == new.faction)
    {
        return Err(bad("Choose a valid name, lineage, and faction."));
    }
    let mut c = Character {
        version: DATA_VERSION,
        revision: 0,
        id: token()?,
        name: new.name.trim().to_owned(),
        race: new.race,
        faction: new.faction,
        level: 0,
        xp: 0,
        founder_halo: None,
        founder_xp_remainder: 0,
        credits: app.content.r("startingCredits") as u64,
        position: app.content.map.spawn,
        yaw: 0.0,
        health: 0.0,
        energy: 0.0,
        medkits: app.content.r("startingMedkits") as u32,
        weapon_rank: 0,
        talents: HashMap::new(),
        active_quests: HashMap::new(),
        completed: vec![],
        dungeon_history: HashMap::new(),
        dungeon_return: None,
        intro_seen: false,
    };
    let stats = Stats::new(&c, &app.content);
    c.health = stats.health;
    c.energy = stats.energy;
    let mut saved = StoredCharacter {
        version: DATA_VERSION,
        owner: session.username.clone(),
        character: c.clone(),
        cooldowns: HashMap::new(),
        global_ready: 0.0,
        dash_ready: 0.0,
    };
    let db = app.db.clone();
    let c = tokio::task::spawn_blocking(move || -> ResultApi<Character> {
        let _guard = db.mutation.lock().map_err(|_| internal())?;
        let mut account = db.account(&session.username).map_err(|_| internal())?;
        if account.characters.len() >= 8 {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "All eight character slots are occupied.",
            ));
        }
        saved.character.founder_halo = account.founder_halo;
        db.save_character(&saved).map_err(|_| internal())?;
        account.characters.push(saved.character.id.clone());
        if db
            .atomic(&db.account_path(&session.username), &account)
            .is_err()
        {
            let _ = fs::remove_file(db.character_path(&saved.character.id));
            return Err(internal());
        }
        Ok(saved.character)
    })
    .await
    .map_err(|_| internal())??;
    Ok(Json(json!({"character":c})))
}
async fn delete_character(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ResultApi<Json<Value>> {
    mutation(&headers, &app)?;
    let (_, session) = authenticate(&headers, &app)?;
    if !valid_id(&id) {
        return Err(bad("Invalid character ID."));
    }
    let db = app.db.clone();
    let active = app.active.clone();
    tokio::task::spawn_blocking(move || -> ResultApi<()> {
        let active = active.lock().map_err(|_| internal())?;
        if active.contains(&id) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Leave the world before deleting this character.",
            ));
        }
        let _guard = db.mutation.lock().map_err(|_| internal())?;
        let mut account = db.account(&session.username).map_err(|_| internal())?;
        if !account.characters.contains(&id) {
            return Err(ApiError(StatusCode::NOT_FOUND, "Character not found."));
        }
        db.prepare_delete(&id)?;
        account.characters.retain(|c| c != &id);
        db.atomic(&db.account_path(&session.username), &account)
            .map_err(|_| internal())?;
        fs::remove_file(db.character_path(&id)).map_err(|_| internal())?;
        Ok(())
    })
    .await
    .map_err(|_| internal())??;
    Ok(Json(json!({"ok":true})))
}

#[derive(Default)]
struct Stats {
    health: f64,
    energy: f64,
    speed: f64,
    crit: f64,
    damage: f64,
    shield: f64,
    healing: f64,
    regen: f64,
}
impl Stats {
    fn new(c: &Character, data: &Content) -> Self {
        let mut s = Self {
            health: data.rule("player", "health")
                + f64::from(c.level) * data.rule("player", "healthPerLevel"),
            energy: data.rule("player", "energy"),
            speed: 1.0,
            crit: data.rule("combat", "crit"),
            damage: 1.0,
            ..Self::default()
        };
        if let Some(r) = data.races.iter().find(|r| text(&r["id"]) == c.race) {
            s.add(text(&r["passive"]["stat"]), num(&r["passive"]["value"]));
        }
        for t in &data.talents {
            s.add(
                &t.stat,
                f64::from(*c.talents.get(&t.id).unwrap_or(&0)) * t.amount,
            );
        }
        s
    }
    fn add(&mut self, stat: &str, amount: f64) {
        match stat {
            "health" => self.health += amount,
            "energy" => self.energy += amount,
            "speed" => self.speed += amount,
            "crit" => self.crit += amount,
            "damage" => self.damage += amount,
            "shield" => self.shield += amount,
            "healing" => self.healing += amount,
            "regen" => self.regen += amount,
            _ => {}
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Enemy {
    id: String,
    instance: Option<u64>,
    #[serde(rename = "type")]
    kind: String,
    name: String,
    model: String,
    color: String,
    position: Vec3,
    level: u32,
    health: f64,
    max_health: f64,
    yaw: f64,
    #[serde(skip)]
    home: Vec3,
    #[serde(skip)]
    damage: f64,
    #[serde(skip)]
    speed: f64,
    #[serde(skip)]
    attack_at: f64,
    #[serde(skip)]
    stun_until: f64,
    #[serde(skip)]
    respawn_at: f64,
    #[serde(skip)]
    aggro: Option<(String, f64)>,
}
#[derive(Default, Clone)]
struct Movement {
    forward: f64,
    strafe: f64,
    yaw: f64,
    jump: bool,
    dash: bool,
    sprint: bool,
}
struct Player {
    instance: Option<u64>,
    owner: String,
    c: Character,
    output: mpsc::Sender<Value>,
    input: Movement,
    last_input: f64,
    velocity: Vec3,
    previous_position: Vec3,
    ghost_trail: GhostTrail,
    grounded: bool,
    coyote: f64,
    jump_buffer: f64,
    dash: f64,
    dash_ready: f64,
    cooldowns: HashMap<String, f64>,
    global_ready: f64,
    shield: f64,
    shield_until: f64,
    last_combat: f64,
    dead_at: f64,
    last_interact: f64,
    last_sequence: u64,
    dirty: bool,
}
fn emit(p: &Player, event: Value) {
    let _ = p
        .output
        .try_send(json!({"type":"event","version":DATA_VERSION,"event":event}));
}
fn notice(p: &Player, message: &str) {
    emit(p, json!({"type":"notice","text":message}));
}
fn damage_enemy(
    p: &mut Player,
    e: &mut Enemy,
    a: &Ability,
    data: &Content,
    time: f64,
    seed: &mut u32,
    from: Vec3,
    multiplier: f64,
) {
    if e.health <= 0.0 || e.instance != p.instance {
        return;
    }
    let stats = Stats::new(&p.c, data);
    let roll = (lcg(seed) * data.rule("combat", "die")).floor() + 1.0;
    let miss = (data.rule("combat", "miss") + f64::from(e.level.saturating_sub(p.c.level)) * 2.0)
        .clamp(0.0, 65.0);
    let critical = roll > data.rule("combat", "die") - stats.crit;
    let power = (a.power
        + f64::from(p.c.level) * 3.0
        + f64::from(p.c.weapon_rank) * data.rule("inventory", "weaponUpgradeDamage"))
        * stats.damage
        * multiplier;
    let damage = if roll <= miss {
        0.0
    } else {
        (power
            * if critical {
                data.rule("combat", "critMultiplier")
            } else {
                1.0
            }
            * (1.0 - data.rule("combat", "armorReduction")))
        .round()
        .max(1.0)
    };
    e.health = (e.health - damage).max(0.0);
    p.last_combat = time;
    p.dirty = true;
    e.aggro = Some((p.c.id.clone(), time + 6.0));
    if a.kind == "stun" && damage > 0.0 {
        e.stun_until = time + a.duration;
    }
    emit(
        p,
        json!({"type":"hit","roll":roll,"damage":damage,"critical":critical&&damage>0.0,"target":e.id,"position":e.position,"color":a.color,"ability":a.name}),
    );
    emit(
        p,
        json!({"type":"effect","kind":"beam","from":from,"position":e.position,"color":a.color}),
    );
    if e.health <= 0.0 && e.instance.is_none() {
        e.respawn_at = time + data.rule("combat", "enemyRespawnSeconds");
        progress(p, data, "kill", &e.kind);
        let xp = (data.rule("xp", "killBase")
            + f64::from(e.level) * data.rule("xp", "killPerLevel")
            - f64::from(p.c.level.saturating_sub(e.level)) * 4.0)
            .max(3.0) as u64;
        let xp = gain_xp(p, data, xp);
        p.c.credits += 5 + u64::from(e.level);
        emit(p, json!({"type":"reward","xp":xp,"credits":5+e.level}));
    }
}
fn quest_event(p: &Player, data: &Content, q: &Quest, kind: &str) {
    emit(p, json!({"type":kind,"quest":data.quest_values.get(&q.id)}));
}
fn progress(p: &mut Player, data: &Content, kind: &str, target: &str) {
    for q in &data.quests {
        if q.objective.kind == kind && q.objective.target == target {
            if let Some(count) = p.c.active_quests.get_mut(&q.id) {
                if *count < q.objective.count {
                    *count += 1;
                    let count = *count;
                    p.dirty = true;
                    emit(
                        p,
                        json!({"type":"questProgress","quest":data.quest_values.get(&q.id),"progress":count}),
                    );
                }
            }
        }
    }
}
fn gain_xp(p: &mut Player, data: &Content, amount: u64) -> u64 {
    let (amount, remainder) = founders::xp_reward(&p.c, data, amount);
    p.c.founder_xp_remainder = remainder;
    p.c.xp = p.c.xp.saturating_add(amount);
    let cost = |level: u32| {
        (data.rule("xp", "base") + f64::from(level) * data.rule("xp", "perLevel")) as u64
    };
    while p.c.level < data.r("levelCap") as u32 && p.c.xp >= cost(p.c.level) {
        p.c.xp -= cost(p.c.level);
        p.c.level += 1;
        let stats = Stats::new(&p.c, data);
        p.c.health = stats.health;
        p.c.energy = stats.energy;
        emit(p, json!({"type":"level","level":p.c.level}));
    }
    if p.c.level >= data.r("levelCap") as u32 {
        p.c.xp = 0;
    }
    p.dirty = true;
    amount
}
fn available(q: &Quest, c: &Character) -> bool {
    q.faction.as_ref().is_none_or(|f| f == &c.faction)
        && q.race.as_ref().is_none_or(|r| r == &c.race)
        && q.level <= c.level
        && q.requires.iter().all(|id| c.completed.contains(id))
        && !c.completed.contains(&q.id)
        && !c.active_quests.contains_key(&q.id)
}
fn movement(p: &mut Player, data: &Content, world: &World, time: f64, dt: f64) {
    if p.c.health <= 0.0 {
        return;
    }
    if time - p.last_input > 0.3 {
        p.input = Movement {
            yaw: p.c.yaw,
            ..Movement::default()
        };
    }
    let rule = |key| data.rule("movement", key);
    let stats = Stats::new(&p.c, data);
    p.c.yaw = p.input.yaw;
    if p.input.jump {
        p.jump_buffer = rule("jumpBuffer");
        p.input.jump = false;
    } else {
        p.jump_buffer = (p.jump_buffer - dt).max(0.0);
    }
    p.coyote = if p.grounded {
        rule("coyoteTime")
    } else {
        (p.coyote - dt).max(0.0)
    };
    if p.jump_buffer > 0.0 && p.coyote > 0.0 {
        p.velocity[1] = rule("jump");
        p.grounded = false;
        p.coyote = 0.0;
        p.jump_buffer = 0.0;
    }
    if p.input.dash && time >= p.dash_ready {
        p.dash = rule("dashDuration");
        p.dash_ready = time + rule("dashCooldown");
    }
    p.input.dash = false;
    p.dash = (p.dash - dt).max(0.0);
    let (mut f, mut side) = (p.input.forward, p.input.strafe);
    let length = f.hypot(side);
    if length > 1.0 {
        f /= length;
        side /= length;
    }
    if p.dash > 0.0 && length == 0.0 {
        f = 1.0;
    }
    let speed = if p.dash > 0.0 {
        rule("dashSpeed")
    } else if p.input.sprint {
        rule("sprint")
    } else {
        rule("speed")
    } * stats.speed;
    let tx = (-p.c.yaw.sin() * f + p.c.yaw.cos() * side) * speed;
    let tz = (-p.c.yaw.cos() * f - p.c.yaw.sin() * side) * speed;
    let acceleration =
        if p.grounded { 1.0 } else { rule("airControl") } * rule("acceleration") * dt;
    for (axis, target) in [(0, tx), (2, tz)] {
        p.velocity[axis] += (target - p.velocity[axis]).clamp(-acceleration, acceleration);
    }
    if length == 0.0 && p.dash == 0.0 && p.grounded {
        p.velocity[0] *= (-rule("friction") * dt).exp();
        p.velocity[2] *= (-rule("friction") * dt).exp();
    }
    let steps = (p.velocity[0].hypot(p.velocity[2]) * dt / 0.35)
        .ceil()
        .max(1.0) as u32;
    for _ in 0..steps {
        for axis in [0, 2] {
            let mut next = p.c.position;
            next[axis] += p.velocity[axis] * dt / f64::from(steps);
            let arena = &data.dungeons.rules;
            let in_bounds = p.instance.is_none()
                || (next[0] - arena.arena[0]).abs() <= arena.arena_radius
                    && (next[2] - arena.arena[2]).abs() <= arena.arena_radius;
            if in_bounds && !world.collides(next, rule("radius")) {
                p.c.position = next;
            } else {
                p.velocity[axis] = 0.0;
            }
        }
    }
    p.velocity[1] -= rule("gravity") * dt;
    let next = p.c.position[1] + p.velocity[1] * dt;
    let floor = world.floor(p.c.position[0], p.c.position[2], p.c.position[1], next);
    if next <= floor {
        p.c.position[1] = floor;
        p.velocity[1] = 0.0;
        p.grounded = true;
    } else {
        p.c.position[1] = next;
        p.grounded = false;
    }
    p.c.energy =
        (p.c.energy + (data.rule("player", "energyRegen") + stats.regen) * dt).min(stats.energy);
    if time - p.last_combat > data.rule("combat", "outOfCombatSeconds") {
        p.c.health = (p.c.health + data.rule("player", "healthRegen") * dt).min(stats.health);
    }
    if time > p.shield_until {
        p.shield = 0.0;
    }
    let visits: Vec<_> = data
        .map
        .landmarks
        .iter()
        .filter(|l| {
            p.instance.is_none() && dist(p.c.position, l.position) < data.r("interactionRadius")
        })
        .map(|l| l.id.as_str())
        .collect();
    for id in visits {
        progress(p, data, "explore", id);
    }
}

enum Command {
    Transfer {
        player: Box<Player>,
        source_time: f64,
        request: Value,
        reply: oneshot::Sender<Result<(), Box<Player>>>,
    },
    Social {
        id: String,
        owner: String,
        request: Value,
        reply: oneshot::Sender<ResultApi<Value>>,
    },
    Join {
        stored: StoredCharacter,
        output: mpsc::Sender<Value>,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Action {
        id: String,
        value: Value,
    },
    Leave {
        id: String,
    },
    Shutdown {
        reply: oneshot::Sender<()>,
    },
}
struct Save {
    stored: StoredCharacter,
    release: bool,
    reply: Option<oneshot::Sender<()>>,
}
fn saved_player(p: &Player, time: f64) -> StoredCharacter {
    let clock = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64();
    StoredCharacter {
        version: DATA_VERSION,
        owner: p.owner.clone(),
        character: p.c.clone(),
        cooldowns: p
            .cooldowns
            .iter()
            .filter(|(_, ready)| **ready > time)
            .map(|(id, ready)| (id.clone(), clock + ready - time))
            .collect(),
        global_ready: clock + (p.global_ready - time).max(0.0),
        dash_ready: clock + (p.dash_ready - time).max(0.0),
    }
}
fn start_writer(
    db: Arc<Database>,
    active: Arc<Mutex<HashSet<String>>>,
) -> (mpsc::Sender<Save>, std::thread::JoinHandle<()>) {
    let (tx, mut rx) = mpsc::channel::<Save>(8192);
    let handle = std::thread::spawn(move || {
        while let Some(save) = rx.blocking_recv() {
            // Disk failure is fail-closed: hold the character lease and retry this ordered write.
            loop {
                match db.save_character(&save.stored) {
                    Ok(()) => break,
                    Err(error) => {
                        eprintln!("Character persistence failed; retrying: {error}");
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            }
            if save.release {
                if let Ok(mut leases) = active.lock() {
                    leases.remove(&save.stored.character.id);
                }
            }
            if let Some(reply) = save.reply {
                let _ = reply.send(());
            }
        }
    });
    (tx, handle)
}
// CPU-heavy simulation futures stay on dedicated OS threads. Tokio's shared
// multithread runtime continues driving socket I/O, timers and blocking storage jobs.
fn start_shard(
    shard: Shard,
    commands: mpsc::Receiver<Command>,
    name: String,
) -> io::Result<std::thread::JoinHandle<()>> {
    let runtime = tokio::runtime::Handle::current();
    std::thread::Builder::new()
        .name(name)
        .spawn(move || runtime.block_on(shard.run(commands)))
}

struct Shard {
    dungeons: dungeons::State,
    lobby: Option<mpsc::Sender<Command>>,
    forwarded: HashSet<String>,
    db: Arc<Database>,
    content: Arc<Content>,
    world: World,
    players: HashMap<String, Player>,
    enemies: Vec<Enemy>,
    ghostlines: HashMap<String, Ghostline>,
    saves: mpsc::Sender<Save>,
    time: f64,
    ticks: u64,
    seed: u32,
}
impl Shard {
    fn new(
        content: Arc<Content>,
        saves: mpsc::Sender<Save>,
        index: usize,
        db: Arc<Database>,
    ) -> Self {
        let world = World::new(&content.map);
        let enemies = content
            .map
            .enemy_spawns
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let e = content
                    .enemies
                    .iter()
                    .find(|e| text(&e["id"]) == s.kind)
                    .expect("validated enemy template");
                let health = num(&e["health"]) + f64::from(s.level) * 12.0;
                Enemy {
                    id: format!("enemy-{i}"),
                    instance: None,
                    kind: s.kind.clone(),
                    name: text(&e["name"]).to_owned(),
                    model: text(&e["model"]).to_owned(),
                    color: text(&e["color"]).to_owned(),
                    position: s.position,
                    home: s.position,
                    level: s.level,
                    health,
                    max_health: health,
                    yaw: 0.0,
                    damage: num(&e["damage"]),
                    speed: num(&e["speed"]),
                    attack_at: 0.0,
                    stun_until: 0.0,
                    respawn_at: 0.0,
                    aggro: None,
                }
            })
            .collect();
        let mut seed_bytes = [0u8; 4];
        let seed = if getrandom::fill(&mut seed_bytes).is_ok() {
            u32::from_le_bytes(seed_bytes)
        } else {
            content.map.seed.wrapping_add(index as u32)
        };
        Self {
            dungeons: dungeons::State::default(),
            lobby: None,
            forwarded: HashSet::new(),
            db,
            content,
            world,
            players: HashMap::new(),
            enemies,
            ghostlines: HashMap::new(),
            saves,
            time: 0.0,
            ticks: 0,
            seed,
        }
    }
    async fn run(mut self, mut commands: mpsc::Receiver<Command>) {
        let mut interval = tokio::time::interval(Duration::from_millis(50));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _=interval.tick()=>{self.tick();if self.ticks%2==0{self.snapshots();}if self.ticks%(self.content.rule("network","checkpointSeconds") as u64*20).max(20)==0{self.checkpoint();}}
                command=commands.recv()=>{match command{
                    Some(Command::Join{mut stored,output,reply})=>{
                        if self.players.len()>=self.content.rule("network","maxPlayersPerShard") as usize{let _=reply.send(Err("This world shard is full. Try again later.".into()));continue;}
                        let db=self.db.clone();let data=self.content.clone();let registering=stored.clone();
                        let registration=tokio::task::spawn_blocking(move || {
                            let request_id=token()?;
                            db.social_transaction(registering,json!({"action":"register","requestId":&request_id[..36]}),&data)
                        }).await;
                        match registration {
                            Ok(Ok((updated,_)))=>stored=updated,
                            _=>{let _=reply.send(Err("Community storage is unavailable. Try again after storage recovers.".into()));continue;}
                        }
                        let clock=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs_f64();
                        let cooldowns=stored.cooldowns.into_iter().map(|(id,ready)|(id,self.time+(ready-clock).max(0.0))).collect();
                        let global_ready=self.time+(stored.global_ready-clock).max(0.0);let dash_ready=self.time+(stored.dash_ready-clock).max(0.0);
                        let mut c=stored.character;
                        if let Some(destination)=c.dungeon_return.take(){c.position=destination;c.health=Stats::new(&c,&self.content).health;c.revision+=1;}
                        let id=c.id.clone();let yaw=c.yaw;
                        let previous_position=c.position;
                        self.players.insert(id,Player{instance:None,owner:stored.owner,c,output,input:Movement{yaw,..Movement::default()},last_input:self.time,velocity:[0.0;3],previous_position,ghost_trail:GhostTrail::default(),grounded:true,coyote:0.0,jump_buffer:0.0,dash:0.0,dash_ready,cooldowns,global_ready,shield:0.0,shield_until:0.0,last_combat:self.time,dead_at:self.time,last_interact:-100.0,last_sequence:0,dirty:false});
                        let _=reply.send(Ok(()));self.snapshots();
                    }
                    Some(Command::Transfer{player,source_time,request,reply})=>self.accept_dungeon_transfer(player,source_time,request,reply),
                    Some(Command::Action{id,value})=>{
                        if self.forwarded.contains(&id){if let Some(lobby)=&self.lobby{let _=lobby.send(Command::Action{id,value}).await;}}
                        else if self.lobby.is_some()&&text(&value["type"])=="dungeon"&&text(&value["operation"])=="queue"{self.transfer_to_dungeons(id,value).await;}
                        else{self.action(&id,&value);}
                    },
                    Some(Command::Social{id,owner,request,reply})=>{
                        if self.forwarded.contains(&id){if let Some(lobby)=&self.lobby{let _=lobby.send(Command::Social{id,owner,request,reply}).await;}}
                        else {let result = self.social_command(&id, &owner, request).await;let _ = reply.send(result);}
                    }
                    Some(Command::Leave{id})=>{
                        if self.forwarded.remove(&id){if let Some(lobby)=&self.lobby{let _=lobby.send(Command::Leave{id}).await;}}
                        else{self.leave_dungeon(&id);self.ghostlines.remove(&id);if let Some(p)=self.players.remove(&id){let save=Save{stored:saved_player(&p,self.time),release:true,reply:None};let _=self.saves.send(save).await;}}
                    }
                    Some(Command::Shutdown{reply})=>{
                        let mut acknowledgements=Vec::new();for (_,p) in self.players.drain(){let(tx,rx)=oneshot::channel();let _=self.saves.send(Save{stored:saved_player(&p,self.time),release:true,reply:Some(tx)}).await;acknowledgements.push(rx);}
                        for ack in acknowledgements{let _=ack.await;}let _=reply.send(());break;
                    }
                    None=>break,
                }}
            }
        }
    }
    fn checkpoint(&mut self) {
        for p in self.players.values_mut() {
            let job = Save {
                stored: saved_player(p, self.time),
                release: false,
                reply: None,
            };
            if self.saves.try_send(job).is_ok() {
                p.dirty = false;
            } else {
                notice(
                    p,
                    "Persistence is busy. Keep your connection open while the server catches up.",
                );
            }
        }
    }
    fn snapshots(&self) {
        if self.players.is_empty() {
            return;
        }
        // Cell buckets avoid broadcasting the whole shard to every player.
        let radius = self.content.rule("network", "interestRadius");
        let cell = 80.0;
        let reach = (radius / cell).ceil() as i32;
        let mut buckets: HashMap<(i32, i32), Vec<&Player>> = HashMap::new();
        for p in self.players.values() {
            buckets
                .entry((
                    (p.c.position[0] / cell).floor() as i32,
                    (p.c.position[2] / cell).floor() as i32,
                ))
                .or_default()
                .push(p);
        }
        let (social_revision, badges) = {
            let social = self.db.social.lock().ok();
            let badges: HashMap<_, _> = self
                .players
                .keys()
                .filter_map(|id| {
                    social
                        .as_ref()
                        .and_then(|s| s.guild_badge(id))
                        .map(|badge| (id.clone(), badge))
                })
                .collect();
            (social.as_ref().map(|s| s.revision), badges)
        };
        for p in self.players.values() {
            let cx = (p.c.position[0] / cell).floor() as i32;
            let cz = (p.c.position[2] / cell).floor() as i32;
            let mut nearby = Vec::new();
            for x in cx - reach..=cx + reach {
                for z in cz - reach..=cz + reach {
                    if let Some(bucket) = buckets.get(&(x, z)) {
                        for other in bucket {
                            if other.c.id != p.c.id
                                && other.instance == p.instance
                                && dist(other.c.position, p.c.position) < radius
                            {
                                nearby.push((dist(other.c.position, p.c.position), other));
                            }
                        }
                    }
                }
            }
            nearby.sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
            let nearby:Vec<_>=nearby.into_iter().take(self.content.rule("network","maxVisiblePlayers") as usize).map(|(_,other)|json!({"id":other.c.id,"name":other.c.name,"race":other.c.race,"position":other.c.position,"yaw":other.c.yaw+std::f64::consts::PI,"health":other.c.health,"level":other.c.level,"founderHalo":other.c.founder_halo,"guild":badges.get(&other.c.id)})).collect();
            let enemies: Vec<_> = self
                .enemies
                .iter()
                .filter(|e| e.instance == p.instance && dist(e.position, p.c.position) < radius)
                .collect();
            let mut ghosts: Vec<_> = self
                .ghostlines
                .values()
                .filter(|g| {
                    self.players
                        .get(&g.owner)
                        .is_some_and(|owner| owner.instance == p.instance)
                        && (g.owner == p.c.id || dist(g.position(self.time), p.c.position) < radius)
                })
                .collect();
            ghosts.sort_by(|a, b| {
                (a.owner != p.c.id)
                    .cmp(&(b.owner != p.c.id))
                    .then_with(|| {
                        dist(a.position(self.time), p.c.position)
                            .total_cmp(&dist(b.position(self.time), p.c.position))
                    })
                    .then_with(|| a.owner.cmp(&b.owner))
            });
            ghosts.truncate(self.content.rule("ghostline", "maxVisible") as usize);
            let _=p.output.try_send(json!({"type":"snapshot","version":DATA_VERSION,"character":p.c,"enemies":enemies,"players":nearby,"time":self.time,"serverTime":now_millis(),"guild":badges.get(&p.c.id),"socialRevision":social_revision,"cooldowns":p.cooldowns,"dashReady":p.dash_ready,"shield":p.shield,"sequence":p.last_sequence,"ghostlines":ghosts,"ghostCharge":p.ghost_trail.charge(&self.content),"dungeon":self.dungeon_snapshot(&p.c.id)}));
        }
    }
    fn tick(&mut self) {
        self.time += 0.05;
        self.ticks += 1;
        self.tick_dungeons();
        for p in self.players.values_mut() {
            p.c.revision += 1;
            p.previous_position = p.c.position;
            movement(p, &self.content, &self.world, self.time, 0.05);
        }
        for e in &mut self.enemies {
            if e.health <= 0.0 {
                if e.instance.is_none() && self.time >= e.respawn_at {
                    e.health = e.max_health;
                    e.position = e.home;
                    e.aggro = None;
                }
                continue;
            }
            if e.stun_until > self.time {
                continue;
            }
            if dist(e.position, e.home) > self.content.rule("combat", "leash") {
                e.position = e.home;
                e.health = e.max_health;
                e.aggro = None;
                continue;
            }
            let forced = e
                .aggro
                .as_ref()
                .filter(|(_, until)| *until > self.time)
                .map(|(id, _)| id.clone());
            let target = self
                .players
                .values()
                .filter(|p| {
                    p.c.health > 0.0
                        && p.instance == e.instance
                        && (p.c.position[1] - e.position[1]).abs() < 4.0
                        && (e.instance.is_some()
                            || dist(p.c.position, e.position)
                                < self.content.rule("combat", "aggroRadius"))
                        && self.world.visible(e.position, p.c.position)
                })
                .min_by(|a, b| {
                    let da = if forced.as_ref() == Some(&a.c.id) {
                        0.0
                    } else {
                        dist(a.c.position, e.position)
                    };
                    let db = if forced.as_ref() == Some(&b.c.id) {
                        0.0
                    } else {
                        dist(b.c.position, e.position)
                    };
                    da.total_cmp(&db)
                })
                .map(|p| p.c.id.clone());
            if let Some(id) = target {
                if let Some(p) = self.players.get_mut(&id) {
                    let distance = dist(p.c.position, e.position);
                    e.yaw =
                        (p.c.position[0] - e.position[0]).atan2(p.c.position[2] - e.position[2]);
                    if distance > self.content.rule("combat", "meleeRange") {
                        for axis in [0, 2] {
                            let mut next = e.position;
                            next[axis] +=
                                (p.c.position[axis] - e.position[axis]) / distance * e.speed * 0.05;
                            if !self.world.collides(next, 0.65) {
                                e.position = next;
                            }
                        }
                    } else if self.time >= e.attack_at {
                        e.attack_at = self.time + self.content.rule("combat", "enemyAttackSeconds");
                        p.last_combat = self.time;
                        let damage = if e.instance.is_some() {
                            (Stats::new(&p.c, &self.content).health
                                * self.content.dungeons.rules.enemy_damage_fraction)
                                .round()
                        } else {
                            (e.damage + f64::from(e.level) * 2.0).round()
                        };
                        let absorbed = p.shield.min(damage);
                        p.shield -= absorbed;
                        p.c.health = (p.c.health - damage + absorbed).max(0.0);
                        p.dirty = true;
                        emit(p, json!({"type":"hurt","amount":damage-absorbed}));
                        if p.c.health <= 0.0 {
                            p.dead_at = self.time;
                            emit(p, json!({"type":"death"}));
                        }
                    }
                }
            } else if dist(e.position, e.home) > 1.0 {
                let d = dist(e.position, e.home);
                for axis in 0..3 {
                    e.position[axis] +=
                        (e.home[axis] - e.position[axis]) / d * (e.speed * 0.05).min(d);
                }
            }
        }
        self.tick_ghostlines();
    }
    fn action(&mut self, id: &str, value: &Value) {
        if text(&value["type"]) == "dungeon" {
            self.dungeon_action(id, value);
            return;
        }
        let Some(mut p) = self.players.remove(id) else {
            return;
        };
        p.c.revision += 1;
        let kind = text(&value["type"]);
        if kind == "move" {
            let sequence = value["sequence"].as_u64().unwrap_or(0);
            if sequence > p.last_sequence
                && ["forward", "strafe", "yaw"]
                    .iter()
                    .all(|key| value[key].as_f64().is_some_and(f64::is_finite))
            {
                p.last_sequence = sequence;
                p.last_input = self.time;
                p.input.forward = num(&value["forward"]).clamp(-1.0, 1.0);
                p.input.strafe = num(&value["strafe"]).clamp(-1.0, 1.0);
                p.input.yaw = num(&value["yaw"]).rem_euclid(std::f64::consts::TAU);
                p.input.jump |= value["jump"].as_bool().unwrap_or(false);
                p.input.dash |= value["dash"].as_bool().unwrap_or(false);
                p.input.sprint = value["sprint"].as_bool().unwrap_or(false);
            }
        } else if kind == "intro_seen" {
            p.c.intro_seen = true;
            p.dirty = true;
        } else if p.c.health <= 0.0 {
            if kind == "respawn"
                && p.instance.is_none()
                && self.time - p.dead_at >= self.content.rule("player", "respawnSeconds")
            {
                let stats = Stats::new(&p.c, &self.content);
                p.c.position = self.content.map.spawn;
                p.c.health = stats.health;
                p.c.energy = stats.energy;
                p.velocity = [0.0; 3];
                p.previous_position = p.c.position;
                p.ghost_trail.clear();
                self.ghostlines.remove(id);
                p.dirty = true;
                notice(&p, "Signal recovered. Welcome back.");
            }
        } else {
            self.game_action(&mut p, value);
        }
        self.players.insert(id.to_owned(), p);
    }
    fn game_action(&mut self, p: &mut Player, value: &Value) {
        let data = &self.content;
        let kind = text(&value["type"]);
        if p.instance.is_some() && matches!(kind, "quest" | "interact" | "lift" | "buy") {
            notice(p, "Use the expedition casebook and recovery station.");
            return;
        }
        let id = text(&value["id"]);
        match kind {
            "ability" => {
                let Some(a) = data.abilities.iter().find(|a| a.id == id) else {
                    return;
                };
                let stats = Stats::new(&p.c, data);
                if p.c.level < a.level {
                    notice(p, "That ability is not unlocked yet.");
                    return;
                }
                if self.time < *p.cooldowns.get(id).unwrap_or(&0.0) || self.time < p.global_ready {
                    return;
                }
                if p.c.energy < a.cost {
                    notice(p, "Not enough energy.");
                    return;
                }
                let target = self.enemies.iter().position(|e| {
                    e.id == text(&value["target"])
                        && e.instance == p.instance
                        && e.health > 0.0
                        && dist(p.c.position, e.position) <= a.range
                        && self.world.visible(p.c.position, e.position)
                });
                if matches!(a.kind.as_str(), "damage" | "stun" | "area") && target.is_none() {
                    notice(p, "Choose a visible target within range.");
                    return;
                }
                let ghost = if a.kind == "ghostline" {
                    let speed = data.rule("movement", "dashSpeed") * stats.speed
                        + data.rule("movement", "jump");
                    p.ghost_trail.record(self.time, p.c.position, speed, data);
                    let Some(ghost) = p.ghost_trail.release(&p.c, self.time, data) else {
                        notice(
                            p,
                            "Ghostline needs a fresh route: move at least 12 m over 2 seconds.",
                        );
                        return;
                    };
                    Some(ghost)
                } else {
                    None
                };
                p.c.energy -= a.cost;
                p.cooldowns.insert(id.to_owned(), self.time + a.cooldown);
                p.global_ready = self.time + data.rule("combat", "globalCooldown");
                p.dirty = true;
                if let Some(ghost) = ghost {
                    self.ghostlines.insert(p.c.id.clone(), ghost);
                    notice(p, "Ghostline released. Cross the cyan runner to braid.");
                    emit(p, json!({"type":"sound","name":"surge"}));
                } else if a.kind == "heal" {
                    let power = a.power + f64::from(p.c.level) * 3.0 + stats.healing;
                    p.c.health = (p.c.health + power).min(stats.health);
                    for ally in self.players.values_mut().filter(|ally| {
                        ally.c.health > 0.0
                            && ally.instance == p.instance
                            && dist(ally.c.position, p.c.position) <= a.range
                    }) {
                        let s = Stats::new(&ally.c, data);
                        ally.c.health = (ally.c.health + power).min(s.health);
                        ally.dirty = true;
                        emit(
                            ally,
                            json!({"type":"effect","kind":"heal","position":ally.c.position,"color":a.color}),
                        );
                    }
                    emit(
                        p,
                        json!({"type":"effect","kind":"heal","position":p.c.position,"color":a.color}),
                    );
                    emit(p, json!({"type":"sound","name":"heal"}));
                } else if a.kind == "shield" {
                    p.shield = a.power + f64::from(p.c.level) * 4.0 + stats.shield;
                    p.shield_until = self.time + a.duration;
                    for e in self.enemies.iter_mut().filter(|e| {
                        e.instance == p.instance
                            && e.health > 0.0
                            && dist(p.c.position, e.position) < a.range
                    }) {
                        e.aggro = Some((p.c.id.clone(), p.shield_until));
                    }
                    emit(
                        p,
                        json!({"type":"effect","kind":"shield","position":p.c.position,"color":a.color}),
                    );
                } else if let Some(target) = target {
                    let center = self.enemies[target].position;
                    for (index, e) in self.enemies.iter_mut().enumerate() {
                        if e.health <= 0.0
                            || e.instance != p.instance
                            || !((a.kind == "area" && dist(center, e.position) <= a.radius)
                                || index == target)
                            || !self.world.visible(p.c.position, e.position)
                        {
                            continue;
                        }
                        let from = p.c.position;
                        damage_enemy(p, e, a, data, self.time, &mut self.seed, from, 1.0);
                    }
                    emit(
                        p,
                        json!({"type":"sound","name":if a.id=="arc"{"shot"}else{"surge"}}),
                    );
                }
            }
            "quest" => {
                let Some(q) = data.quests.iter().find(|q| q.id == id) else {
                    return;
                };
                if !data.npcs.iter().any(|n| {
                    n.id == q.giver && dist(n.position, p.c.position) < data.r("interactionRadius")
                }) {
                    notice(p, "Return to the quest giver marked on your map.");
                    return;
                }
                if text(&value["operation"]) == "accept" && available(q, &p.c) {
                    p.c.active_quests.insert(id.to_owned(), 0);
                    p.dirty = true;
                    quest_event(p, data, q, "questAccepted");
                } else if text(&value["operation"]) == "complete"
                    && p.c
                        .active_quests
                        .get(id)
                        .is_some_and(|v| *v >= q.objective.count)
                    && !p.c.completed.iter().any(|s| s == id)
                {
                    p.c.active_quests.remove(id);
                    p.c.completed.push(id.to_owned());
                    p.c.credits += q.reward.credits;
                    let xp = gain_xp(p, data, q.reward.xp);
                    emit(
                        p,
                        json!({"type":"questComplete","quest":data.quest_values.get(&q.id),"xp":xp}),
                    );
                } else {
                    notice(p, "This contract is not ready.");
                }
            }
            "interact" => {
                if self.time - p.last_interact < 1.0 {
                    return;
                }
                if let Some(l) = data.map.landmarks.iter().find(|l| {
                    l.id == id && dist(l.position, p.c.position) < data.r("interactionRadius")
                }) {
                    p.last_interact = self.time;
                    progress(p, data, "interact", &l.id);
                    progress(p, data, "explore", &l.id);
                    notice(p, &format!("{} · connection established", l.name));
                } else {
                    notice(p, "Move closer to the terminal.");
                }
            }
            "lift" => {
                if let Some(l) = data.map.lifts.iter().find(|l| {
                    l.id == id
                        && (p.c.position[0] - l.position[0]).hypot(p.c.position[2] - l.position[2])
                            < 5.0
                }) {
                    if let Some(i) = l
                        .stops
                        .iter()
                        .position(|y| (p.c.position[1] - y).abs() < 3.0)
                    {
                        p.c.position[1] = l.stops[(i + 1) % l.stops.len()];
                        p.velocity = [0.0; 3];
                        p.previous_position = p.c.position;
                        p.ghost_trail.clear();
                        self.ghostlines.remove(&p.c.id);
                        p.dirty = true;
                    }
                }
            }
            "talent" => {
                if let Some(t) = data.talents.iter().find(|t| t.id == id) {
                    let spent: u32 = p.c.talents.values().sum();
                    let rank = *p.c.talents.get(id).unwrap_or(&0);
                    if p.c.level >= t.level
                        && spent < p.c.level / data.rule("talents", "levelsPerPoint") as u32
                        && rank < t.max_rank
                    {
                        p.c.talents.insert(id.to_owned(), rank + 1);
                        p.dirty = true;
                        notice(p, &format!("{} improved", t.name));
                    } else {
                        notice(p, "No talent point is available for that node.");
                    }
                }
            }
            "medkit" => {
                if p.c.medkits == 0 {
                    notice(p, "No medkits. Visit Patch.");
                    return;
                }
                if self.time < *p.cooldowns.get("medkit").unwrap_or(&0.0) {
                    return;
                }
                p.c.medkits -= 1;
                p.c.health = (p.c.health + data.rule("inventory", "medkitHeal"))
                    .min(Stats::new(&p.c, data).health);
                p.cooldowns.insert(
                    "medkit".into(),
                    self.time + data.rule("inventory", "medkitCooldown"),
                );
                p.dirty = true;
                emit(p, json!({"type":"sound","name":"heal"}));
            }
            "buy" => {
                if !data.npcs.iter().any(|n| {
                    n.id == "merchant"
                        && dist(n.position, p.c.position) < data.r("interactionRadius")
                }) {
                    notice(p, "Visit Patch to trade.");
                    return;
                }
                let item = text(&value["item"]);
                let price = if item == "medkit" {
                    data.rule("inventory", "medkitPrice") as u64
                } else if item == "upgrade" {
                    data.rule("inventory", "weaponUpgradePrice") as u64
                        * u64::from(p.c.weapon_rank + 1)
                } else {
                    return;
                };
                if p.c.credits < price {
                    notice(p, "Not enough credits.");
                    return;
                }
                if item == "medkit" {
                    if p.c.medkits >= data.rule("inventory", "slots") as u32 {
                        notice(p, "Medkit pack is full.");
                        return;
                    }
                    p.c.medkits += 1;
                } else {
                    if p.c.weapon_rank >= data.rule("inventory", "maxWeaponRank") as u32 {
                        notice(p, "Carbine is fully upgraded.");
                        return;
                    }
                    p.c.weapon_rank += 1;
                }
                p.c.credits -= price;
                p.dirty = true;
                emit(p, json!({"type":"sound","name":"confirm"}));
            }
            _ => {}
        }
    }
}

async fn world_upgrade(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> ResultApi<Response> {
    origin(&headers, &app)?;
    let (token, session) = authenticate(&headers, &app)?;
    Ok(upgrade
        .read_buffer_size(8192)
        .write_buffer_size(0)
        .max_write_buffer_size(131072)
        .max_message_size(4096)
        .max_frame_size(4096)
        .on_upgrade(move |socket| world_socket(socket, app, token, session)))
}
async fn world_socket(mut socket: WebSocket, app: Arc<App>, token: String, session: Session) {
    let first = tokio::time::timeout(Duration::from_secs(10), socket.recv()).await;
    let id = match first {
        Ok(Some(Ok(Message::Text(t)))) => serde_json::from_str::<Value>(&t)
            .ok()
            .filter(|v| text(&v["type"]) == "join" && v["version"] == DATA_VERSION)
            .and_then(|v| v["id"].as_str().map(str::to_owned)),
        _ => None,
    };
    let Some(id) = id.filter(|id| valid_id(id)) else {
        let _ = socket.send(Message::Close(None)).await;
        return;
    };
    let db = app.db.clone();
    let active = app.active.clone();
    let character_id = id.clone();
    let stored = tokio::task::spawn_blocking(move || -> ResultApi<StoredCharacter> {
        let mut leases = active.lock().map_err(|_| internal())?;
        if leases.contains(&character_id) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "This character is already connected or still being saved.",
            ));
        }
        let _guard = db.mutation.lock().map_err(|_| internal())?;
        let account = db.account(&session.username).map_err(|_| internal())?;
        if !account.characters.contains(&character_id) {
            return Err(ApiError(StatusCode::NOT_FOUND, "Character not found."));
        }
        let stored = db.character(&character_id).map_err(|_| internal())?;
        if stored.owner != session.username {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "Character ownership does not match.",
            ));
        }
        leases.insert(character_id);
        Ok(stored)
    })
    .await;
    let stored = match stored {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            let _ = socket
                .send(Message::Text(
                    json!({"type":"error","error":e.1}).to_string().into(),
                ))
                .await;
            return;
        }
        Err(_) => return,
    };
    let shard_index = id.bytes().fold(0usize, |hash, b| {
        hash.wrapping_mul(31).wrapping_add(usize::from(b))
    }) % app.shards.len();
    let shard = &app.shards[shard_index];
    let (tx, mut rx) = mpsc::channel::<Value>(4);
    let (reply, joined) = oneshot::channel();
    if shard
        .send(Command::Join {
            stored,
            output: tx,
            reply,
        })
        .await
        .is_err()
    {
        if let Ok(mut a) = app.active.lock() {
            a.remove(&id);
        }
        return;
    }
    match joined.await {
        Ok(Ok(())) => {}
        result => {
            if let Ok(mut a) = app.active.lock() {
                a.remove(&id);
            }
            let message = match result {
                Ok(Err(s)) => s,
                _ => "The world is unavailable.".into(),
            };
            let _ = socket
                .send(Message::Text(
                    json!({"type":"error","error":message}).to_string().into(),
                ))
                .await;
            return;
        }
    }
    let mut check = tokio::time::interval(Duration::from_secs(5));
    let mut rate_start = Instant::now();
    let mut rate_count = 0u32;
    let mut last_message = Instant::now();
    loop {
        tokio::select! {
            _=check.tick()=>{
                let alive=app.sessions.lock().map(|s|s.get(&token).is_some_and(|s|s.expires>now_seconds())).unwrap_or(false);
                if !alive||last_message.elapsed()>Duration::from_secs(45){break;}
            }
            message=socket.recv()=>{
                let value=match message{Some(Ok(Message::Text(t)))=>{if t.len()>4096{break;}serde_json::from_str::<Value>(&t).ok()},Some(Ok(Message::Close(_)))|None|Some(Err(_))=>break,_=>None};
                last_message=Instant::now();if rate_start.elapsed()>Duration::from_secs(1){rate_start=Instant::now();rate_count=0;}rate_count+=1;if rate_count>90{break;}
                if let Some(value)=value{if !value.is_object()||value["version"]!=DATA_VERSION{break;}if shard.try_send(Command::Action{id:id.clone(),value}).is_err(){break;}}
            }
            message=rx.recv()=>{
                if let Some(message)=message{if !matches!(tokio::time::timeout(Duration::from_secs(3),socket.send(Message::Text(message.to_string().into()))).await,Ok(Ok(()))){break;}}
                else{break;}
            }
        }
    }
    let _ = shard.send(Command::Leave { id }).await;
    let _ = socket.send(Message::Close(None)).await;
}
async fn health(State(app): State<Arc<App>>) -> Json<Value> {
    Json(
        json!({"status":"ok","version":env!("CARGO_PKG_VERSION"),"dataVersion":DATA_VERSION,"serverTime":now_millis(),"timeZone":"UTC","dayLengthSeconds":86400,"players":app.active.lock().map(|a|a.len()).unwrap_or(0),"shards":app.shards.len(),"tickHz":20}),
    )
}

async fn shutdown_signal() {
    #[cfg(unix)]
    if let Ok(mut terminate) =
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
    {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = terminate.recv() => {},
        }
        return;
    }
    let _ = tokio::signal::ctrl_c().await;
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = config::Config::load()?;
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(config.workers)
        .thread_name("sloperberpunk-io")
        .enable_all()
        .build()?
        .block_on(serve(config))
}

async fn serve(config: config::Config) -> Result<(), Box<dyn std::error::Error>> {
    let config::Config {
        bind,
        origins,
        secure,
        workers,
        shards: count,
    } = config;
    // Bind before opening storage or starting workers so listener failures leave no live world.
    let listener = tokio::net::TcpListener::bind(bind).await?;
    let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let client = std::env::var_os("SLOPERBERPUNK_CLIENT")
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("../client"))
        .canonicalize()?;
    let data_dir = std::env::var_os("SLOPERBERPUNK_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| base.join("data"));
    let content = Arc::new(Content::load(&client)?);
    let db = Arc::new(Database::open(data_dir)?);
    db.expire_auctions().map_err(|e| io::Error::other(e.1))?;
    let market_db = db.clone();
    let market_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(30));
        loop {
            interval.tick().await;
            let db = market_db.clone();
            if !matches!(
                tokio::task::spawn_blocking(move || db.expire_auctions()).await,
                Ok(Ok(()))
            ) {
                eprintln!("Auction settlement could not be persisted; it will be retried.");
            }
        }
    });
    let active = Arc::new(Mutex::new(HashSet::new()));
    let (saves, writer) = start_writer(db.clone(), active.clone());
    let mut shards = Vec::new();
    let (dungeon_lobby, dungeon_rx) = mpsc::channel(4096);
    let mut world_threads = vec![start_shard(
        Shard::new(content.clone(), saves.clone(), count, db.clone()),
        dungeon_rx,
        "sloperberpunk-expeditions".into(),
    )?];
    for index in 0..count {
        let (tx, rx) = mpsc::channel(4096);
        shards.push(tx);
        let mut shard = Shard::new(content.clone(), saves.clone(), index, db.clone());
        shard.lobby = Some(dungeon_lobby.clone());
        world_threads.push(start_shard(
            shard,
            rx,
            format!("sloperberpunk-world-{index}"),
        )?);
    }
    let salt = SaltString::encode_b64(b"dummy-not-a-user")
        .map_err(|_| "Could not initialize password salt")?;
    let dummy_hash = Argon2::default()
        .hash_password(
            token().map_err(|_| "OS entropy unavailable")?.as_bytes(),
            &salt,
        )
        .map_err(|_| "Could not initialize password hashing")?
        .to_string();
    let app = Arc::new(App {
        db,
        content,
        sessions: Mutex::new(HashMap::new()),
        active,
        rates: Mutex::new(HashMap::new()),
        social_rates: Mutex::new(HashMap::new()),
        auth_slots: Arc::new(Semaphore::new(4)),
        dummy_hash,
        origins,
        secure,
        shards,
        dungeon_lobby,
        saves,
    });
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/founder-offer", get(founders::offer))
        .route("/api/register", post(register))
        .route("/api/login", post(login))
        .route("/api/session", get(session))
        .route("/api/logout", post(logout))
        .route("/api/characters", get(characters).post(create_character))
        .route("/api/characters/{id}", delete(delete_character))
        .route(
            "/api/characters/{id}/social",
            get(social::read).post(social::write),
        )
        .route("/api/characters/{id}/export", get(social::export))
        .route("/api/signing-key", get(social::public_key))
        .route("/api/world", get(world_upgrade))
        .with_state(app.clone())
        .merge(web::routes(client))
        .layer(DefaultBodyLimit::max(16384))
        .layer(axum::middleware::from_fn(web::security_headers));
    eprintln!(
        "Sloperberpunk 0.1.0 — GPL-3.0-or-later, no warranty. http://{bind} ({workers} I/O workers, {count} world threads + 1 expedition thread)"
    );
    let shutdown = app.clone();
    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async move {
        shutdown_signal().await;
        shutdown.sessions.lock().expect("session mutex").clear();
        let mut waiting = Vec::new();
        for shard in &shutdown.shards {
            let (tx, rx) = oneshot::channel();
            let _ = shard.send(Command::Shutdown { reply: tx }).await;
            waiting.push(rx);
        }
        for ack in waiting {
            let _ = ack.await;
        }
        // Home shards finish forwarding pending transfers before the lobby is drained.
        let (tx, rx) = oneshot::channel();
        let _ = shutdown
            .dungeon_lobby
            .send(Command::Shutdown { reply: tx })
            .await;
        let _ = rx.await;
    })
    .await?;
    market_task.abort();
    drop(app);
    tokio::task::spawn_blocking(move || -> io::Result<()> {
        for thread in world_threads {
            thread
                .join()
                .map_err(|_| io::Error::other("A world thread panicked"))?;
        }
        writer
            .join()
            .map_err(|_| io::Error::other("The persistence thread panicked"))?;
        Ok(())
    })
    .await??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn content() -> Arc<Content> {
        Arc::new(
            Content::load(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../client")).unwrap(),
        )
    }
    #[test]
    fn identifiers_reject_traversal() {
        assert!(valid_user("runner_01"));
        assert!(!valid_user("../runner"));
        assert!(!valid_user("a"));
        assert!(!valid_id("../../data"));
        assert!(valid_name("Oru-7"));
        assert!(!valid_name("<script>"));
    }
    #[test]
    fn map_and_content_are_consistent() {
        let d = content();
        let w = World::new(&d.map);
        assert!(!w.collides(d.map.spawn, 0.65));
        assert!(w.cells.len() > 700);
        let b = w.cells.values().next().unwrap();
        assert!(w.collides([b.x, 0.0, b.z], 0.65));
        assert_eq!(w.floor(0.0, -80.0, 25.0, 23.0), 24.0);
        assert_eq!(d.quests.len(), 188);
    }
    #[test]
    fn deterministic_rng_matches_client() {
        let mut seed = 87421;
        assert_eq!((lcg(&mut seed) * 4294967296.0) as u32, 499456184);
    }
    #[test]
    fn password_hash_and_verification() {
        let salt = SaltString::encode_b64(b"test-only-salt-16").unwrap();
        let hash = Argon2::default()
            .hash_password(b"test-passphrase-123", &salt)
            .unwrap()
            .to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(
            Argon2::default()
                .verify_password(b"test-passphrase-123", &parsed)
                .is_ok()
        );
        assert!(
            Argon2::default()
                .verify_password(b"wrong-password", &parsed)
                .is_err()
        );
    }
}
