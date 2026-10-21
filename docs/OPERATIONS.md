# Running and verifying Sloperberpunk

From the repository root, `cargo run --release` starts the complete Rust application at `http://localhost:8080`. It serves `/`, `/play.html`, browser modules/assets, `/LICENSE`, the account/community API, and `/api/world` WebSockets on one listener. All characters and gameplay use this server. Set `PORT=80` to serve the same application on port 80. Browser requests remain relative to the page origin.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket port, 1–65535; use `80` for standard HTTP |
| `HOST` | `127.0.0.1` | Bind IPv4 or IPv6 address |
| `SLOPERBERPUNK_BIND` | unset | Explicit `IP:port` (or `[IPv6]:port`), overriding `HOST` and `PORT` |
| `SLOPERBERPUNK_CLIENT` | `../client` relative to the server Cargo manifest | Public source/assets directory |
| `SLOPERBERPUNK_DATA` | `server/data` | Private plaintext runtime database |
| `SLOPERBERPUNK_ORIGINS` | HTTP localhost, IPv4/IPv6 loopback, and the specific bind IP on the listener port | Exact comma-separated browser origins; override for the public HTTPS URL |
| `SLOPERBERPUNK_SECURE` | `0` | Set `1` to add Secure to session cookies |
| `SLOPERBERPUNK_WORKERS` | available CPU parallelism, capped at 4 | Tokio HTTP/WebSocket worker threads, 1–64 |
| `SLOPERBERPUNK_SHARDS` | CPU parallelism minus I/O workers minus 1, bounded to 1–64 | Dedicated ordinary-world simulation threads; one extra thread runs expeditions |

Invalid ports, thread counts, and origins fail startup. Standard origin ports are normalized (`http://localhost:80` becomes `http://localhost`, and HTTPS port 443 is omitted). An explicit origin list replaces the defaults. Bind configuration is checked and the socket is bound before storage or world workers start. Port 80 may require a service-manager capability such as `CAP_NET_BIND_SERVICE` on Linux; the default 8080 works without it.

For public hosting, terminate HTTPS at the deployment's TLS ingress and forward HTTP and WebSocket upgrades directly to this Rust listener. Set `SLOPERBERPUNK_ORIGINS` to the exact public browser origin and `SLOPERBERPUNK_SECURE=1`. Supply connection/header limits and per-client rate limits at the ingress; the server does not trust forwarded client-IP headers. Binding beyond loopback requires `SLOPERBERPUNK_SECURE=1`; this flag enables secure cookies, not a TLS listener. Keep the private data directory outside the public client directory.

World simulation runs on named OS threads, isolated from HTTP/WebSocket workers. Each thread owns its shard and communicates through bounded channels. Password hashing and database transactions use Tokio's blocking pool; ordered character checkpoints have a dedicated writer. Snapshot generation copies public guild badges once under the social lock, then releases it before spatial filtering and JSON assembly. Tune thread counts to CPU allocation and measured load; the expedition shard and persistence writer are additional threads. On a small host, one world thread is retained even when networking already uses all reported cores.

Use a writable persistent data volume with enough space for character records. A process-level lock protects the directory against a second server writer. Unix account/character directories are mode 0700 and new records mode 0600. Session state is intentionally in memory, so a restart requires users to sign in again. Do not expose the data directory or source-control real player records.

On first startup the service generates `signing-key.json` using OS randomness. Subsequent startups reuse it; corrupt or unsupported key files stop startup. Back up this identity together with `social.json`, `accounts/`, and `characters/`. The public verification key is available at `/api/signing-key`. Do not delete the key as a routine reset: replacing it changes the issuer identity of future exports. JSON readability does not make the private seed safe to publish. Existing key files should retain mode 0600; the data root is restricted to 0700 on Unix.

Keep the host's wall clock synchronized through the host operating system. Game days are exactly 24 UTC hours, with sunrise around 06:00 UTC and sunset around 18:00 UTC. The HUD displays server UTC time for online players. Auction expiry, session deadlines, export timestamps, and once-daily lineage supplies use the server's real clock. No accelerated day/night setting is applied.

Ctrl-C, or SIGTERM on Unix, begins graceful shutdown and waits for final character writes. A failed disk write is retried while retaining the character lease, so shutdown can wait until storage recovers. Monitor disk errors and queue pressure; do not replace a stalled writer with another process against the same directory. Forced termination can lose progress since the most recent checkpoint. Back up only after clean shutdown, or use a consistent filesystem snapshot. Password hashes and user data are private even though their format is readable JSON.

For restoration, stop the service, restore the complete data directory from one consistent backup, preserve ownership and permissions, then restart. `social.json` contains character recovery records and auction escrow, so restoring only character files can duplicate or discard resources. Do not manually unlock an active process or edit a live character record: the in-memory character will overwrite it on the next save. Stale `.pending` files from an interrupted atomic write are never read as committed data; inspect them only with the service stopped. An unreferenced character file is not automatically attached to an account. If a rename succeeds but directory sync fails, writes and exports fail closed until the service is restarted after storage repair; the character writer retains its lease while retrying, so shutdown may require operator intervention in that case.

The version-2 service reads old unversioned account/character files as version 1 and writes their migrated form on subsequent saves. Preserve a full backup before upgrading. Unsupported versions fail instead of being silently downgraded. The content manifest must match the deployed client and server, and browsers using the old WebSocket version need to reload. Social archives, receipts, and pending deliveries are retained, including records associated with deleted characters; there is no automatic pruning job.

Community writes are limited to 30 per authenticated account per minute; reads to 180. HTTP JSON bodies are limited to 16 KiB and WebSocket frames to 4 KiB. Chat/DM bodies allow 1,000 characters; forum bodies 2,000 and titles 100. Histories use pages of 40. Guilds cap at 100 members, parties at eight, and active auctions at 20 per character. Auctions settle on startup, when community data is accessed, or within the 30-second background interval. The entire community file is cloned and rewritten on mutation; monitor its size, memory use and latency, and measure realistic social traffic before deployment at scale.

## First Signal signup reward

The First Signal Halo is limited to the first 1,000 account registrations in one database, shared across its world shards. Registration holds the database mutation lock while counting committed account JSON files and atomically saving the new account with its `founder_halo` serial. Duplicate usernames, failed writes before commit, and character deletion do not consume or release signup slots. A committed account keeps its edition even if its signup response is lost; signing in recovers it. No separate counter can fall out of sync after a restart. Preserve all account records when restoring the database; manually deleting accounts can recycle signup slots.

Legacy accounts count toward the 1,000-account limit, but are not automatically assigned a halo: the old account format recorded no signup timestamp or ordinal, so historical eligibility cannot be reconstructed reliably. Existing saves remain readable with no entitlement by default. New eligible accounts persist their serial, and character creation/loading derives the reward from that account. The character's `founderXpRemainder` preserves twentieths of bonus XP across checkpoints, reconnects, and signed exports. No claim endpoint or trading action can mint or transfer this reward. `/api/founder-offer` exposes only the item ID, limit, and remaining count; availability is informational until registration commits.

For online acceptance, race distinct signups against slot 1,000, retry a duplicate username, restart, and verify that only one account takes the final edition. Create and delete characters on an eligible account, reconnect, export, and check the halo from a second player's view. Check level-0, level-1, and level-10 reward boundaries and the game’s title screen when exhausted or disconnected.

## Verification commands

These source checks create no build or test output files:

```sh
rustfmt --edition 2024 --check server/src/main.rs
git diff --check
```

When compilation outputs are allowed, resolve dependencies and retain the root `Cargo.lock`, then run:

```sh
cargo test
cargo build --release
```

The Rust suites cover configuration, static HTTP delivery and security, content, authoritative gameplay, dungeons, Ghostline, founder rewards, community transactions, persistence, and signed exports. The HTTP tests call the real Axum routes in memory without opening listeners. Cargo creates its normal dependency cache and target directory; database tests use temporary fixtures. These commands were not run for this task because generated files were prohibited. Formatting and source checks do not establish Rust type correctness, linking, live HTTP/WebSocket behavior, or measured capacity. The device acceptance procedure is in [COMPATIBILITY.md](COMPATIBILITY.md).

## Online acceptance and capacity

Verify account registration/sign-in, session expiry/logout, eight-character limits, ownership isolation, duplicate connections, and character deletion on a real running server. Walk roads and lifts; verify that predicted movement reconciles with authoritative position and that health, cooldowns, and quest state survive reconnects. Attempt an out-of-range attack, unavailable talent, premature quest completion, duplicate reward, forged position, and another account's character ID. Reconnect after an ability and restart after a checkpoint to check cooldown and progression persistence.

Exercise community actions with at least three accounts and two lineages: invitation/role/leadership changes, tabards visible to another player, revoked guild/party channel access, inaccessible other-lineage forums, private DM isolation, offline delivery, blocking and read cursors, and multiple pages of chat/forum history across restart. For auctions, test simultaneous buyouts, outbid refunds, expiry while the service is stopped, partial pack claims, repeated request IDs, rejected reused IDs with changed content, and storage failure before and after atomic rename. Verify that disconnecting immediately after a trade cannot restore spent credits or listed items. Export connected and disconnected server characters, verify with a separately obtained public key, modify the payload to confirm signature rejection, and confirm key reuse across restart. Confirm midnight UTC rolls the supply reward once and that changing browser timezone does not change online world lighting.

Capacity must be measured on the intended machine and storage. Increase simultaneous clients gradually, exercising movement, targeting, combat, quest turn-ins, and reconnects. Include a crowded Commons case and players distributed across the basin. Record p50/p95/p99 simulation and snapshot delays, CPU by core, resident memory, bytes per second, socket failures, save latency, and input queue pressure. Test slow clients and temporary disk failure. “Thousands per instance” is a goal of the shard/interest architecture; no throughput or latency figures have been measured in this repository's current validation environment.

The world has fixed enemy spawns and basic spatial AI. The dungeon finder transfers queued characters into one additional expedition shard, with private encounter IDs and a shared 256-player ceiling. `SLOPERBERPUNK_SHARDS` controls ordinary world shards; it does not multiply dungeon capacity. Characters stay in the expedition shard's city after leaving the queue or a dungeon until they disconnect. A full expedition shard rejects new transfers without losing the source character. Include queue saturation, simultaneous ready checks, cross-shard transfers, disconnects during combat, and party-wide wipe/reset in capacity and release tests. Queues and unfinished runs do not survive restart; persisted arena return markers recover characters to the Commons. Completed rewards retain the normal character-checkpoint durability window. At high population, player admission, encounter density, snapshot bandwidth, and the single persistence writer require measurement and likely tuning. A production release also needs a resolved dependency lock and its license inventory. The current alpha is not represented as a load-certified MMO service.
