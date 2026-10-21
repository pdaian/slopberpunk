# Running and verifying Sloperberpunk

The client is buildless. `node tools/serve.mjs` starts one frontend webserver using only Node.js built-ins. It serves the landing page at `/`, the game at `/play.html`, all client sources/assets, and `/LICENSE`. It proxies `/api` requests and `/api/world` WebSocket upgrades to the configured Rust realm. Both HTTP and HTTPS realms are supported, with normal certificate verification for HTTPS and secure WebSockets. The browser always uses the frontend origin; no browser-side realm URL or build step is needed. The Rust service retains its direct frontend-serving option.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SLOPERBERPUNK_BIND` | `127.0.0.1:8080` | Rust HTTP/WebSocket bind address |
| `SLOPERBERPUNK_CLIENT` | `../client` relative to Cargo manifest | Public source/assets directory |
| `SLOPERBERPUNK_DATA` | `server/data` | Private plaintext runtime database |
| `SLOPERBERPUNK_ORIGINS` | localhost and 127.0.0.1 on ports 3000/8080 | Exact comma-separated browser origins |
| `SLOPERBERPUNK_SECURE` | disabled | Set `1` to add Secure to session cookies |
| `SLOPERBERPUNK_SHARDS` | available CPU parallelism, 1–64 | Independent world task count |
| `SLOPERBERPUNK_BACKEND` | `http://127.0.0.1:8080` | Single frontend setting for the HTTP(S) realm origin; no credentials, path, query, or fragment |
| `PORT`, `HOST` | `3000`, `127.0.0.1` | Frontend server binding; `--port` overrides `PORT` |

For public hosting, terminate browser HTTPS at a reverse proxy in front of the Node listener and forward WebSocket upgrades. Configure `SLOPERBERPUNK_BACKEND` on the frontend to reach the realm’s HTTP(S) origin. On the realm, set `SLOPERBERPUNK_ORIGINS` to the exact public browser origin and `SLOPERBERPUNK_SECURE=1`. The frontend preserves the original `Origin`, cookies, and account request marker; it does not bypass the realm’s allowlist. Supply connection/header limits and per-client rate limits at the public proxy, since the realm sees the frontend’s upstream IP. For direct Rust hosting, route the public proxy to Rust instead. Keep the data directory outside every public document root. Binding the Rust service beyond loopback requires `SLOPERBERPUNK_SECURE=1`; this flag enables secure cookies, not a TLS listener.

The frontend bounds realm connection and HTTP inactivity waits to 15 seconds, leaves established world sockets open, and closes active HTTP and world connections on SIGINT/SIGTERM. An unavailable realm returns a JSON 503 for API requests; the landing page, game assets, and local play remain available. No frontend runtime files or caches are created.

Use a writable persistent data volume with enough space for character records. A process-level lock protects the directory against a second server writer. Unix account/character directories are mode 0700 and new records mode 0600. Session state is intentionally in memory, so a restart requires users to sign in again. Do not expose the data directory or source-control real player records.

On first startup the service generates `signing-key.json` using OS randomness. Subsequent startups reuse it; corrupt or unsupported key files stop startup. Back up this identity together with `social.json`, `accounts/`, and `characters/`. The public verification key is available at `/api/signing-key`. Do not delete the key as a routine reset: replacing it changes the issuer identity of future exports. JSON readability does not make the private seed safe to publish. Existing key files should retain mode 0600; the data root is restricted to 0700 on Unix.

Keep the host's wall clock synchronized through the host operating system. Game days are exactly 24 UTC hours, with sunrise around 06:00 UTC and sunset around 18:00 UTC. The HUD displays server UTC time for online players. Auction expiry, session deadlines, export timestamps, and once-daily lineage supplies use the server's real clock; local characters use their device's clock. No accelerated day/night setting is applied.

Ctrl-C, or SIGTERM on Unix, begins graceful shutdown and waits for final character writes. A failed disk write is retried while retaining the character lease, so shutdown can wait until storage recovers. Monitor disk errors and queue pressure; do not replace a stalled writer with another process against the same directory. Forced termination can lose progress since the most recent checkpoint. Back up only after clean shutdown, or use a consistent filesystem snapshot. Password hashes and user data are private even though their format is readable JSON.

For restoration, stop the service, restore the complete data directory from one consistent backup, preserve ownership and permissions, then restart. `social.json` contains character recovery records and auction escrow, so restoring only character files can duplicate or discard resources. Do not manually unlock an active process or edit a live character record: the in-memory character will overwrite it on the next save. Stale `.pending` files from an interrupted atomic write are never read as committed data; inspect them only with the service stopped. An unreferenced character file is not automatically attached to an account. If a rename succeeds but directory sync fails, writes and exports fail closed until the service is restarted after storage repair; the character writer retains its lease while retrying, so shutdown may require operator intervention in that case.

The version-2 service reads old unversioned account/character files as version 1 and writes their migrated form on subsequent saves. Preserve a full backup before upgrading. Unsupported versions fail instead of being silently downgraded. The content manifest must match the deployed client and server, and browsers using the old WebSocket version need to reload. Social archives, receipts, and pending deliveries are retained, including records associated with deleted characters; there is no automatic pruning job.

Community writes are limited to 30 per authenticated account per minute; reads to 180. HTTP JSON bodies are limited to 16 KiB and WebSocket frames to 4 KiB. Chat/DM bodies allow 1,000 characters; forum bodies 2,000 and titles 100. Histories use pages of 40. Guilds cap at 100 members, parties at eight, and active auctions at 20 per character. Auctions settle on startup, when community data is accessed, or within the 30-second background interval. The entire community file is cloned and rewritten on mutation; monitor its size, memory use and latency, and measure realistic social traffic before deployment at scale.

## First Signal signup reward

The First Signal Halo is limited to the first 1,000 account registrations in one database, shared across its world shards. Registration holds the database mutation lock while counting committed account JSON files and atomically saving the new account with its `founder_halo` serial. Duplicate usernames, failed writes before commit, local characters, and character deletion do not consume or release signup slots. A committed account keeps its edition even if its signup response is lost; signing in recovers it. No separate counter can fall out of sync after a restart. Preserve all account records when restoring the database; manually deleting accounts can recycle signup slots.

Legacy accounts count toward the 1,000-account limit, but are not automatically assigned a halo: the old account format recorded no signup timestamp or ordinal, so historical eligibility cannot be reconstructed reliably. Existing saves remain readable with no entitlement by default. New eligible accounts persist their serial, and character creation/loading derives the reward from that account. The character's `founderXpRemainder` preserves twentieths of bonus XP across checkpoints, reconnects, and signed exports. No claim endpoint or trading action can mint or transfer this reward. `/api/founder-offer` exposes only the item ID, limit, and remaining count; availability is informational until registration commits.

For online acceptance, race distinct signups against slot 1,000, retry a duplicate username, restart, and verify that only one account takes the final edition. Create and delete characters on an eligible account, reconnect, export, and check the halo from a second player's view. Check level-0, level-1, and level-10 reward boundaries and the game’s title screen when exhausted or disconnected.

## Verification commands

These commands perform the checks used during implementation and do not create test output files. The frontend suite exercises Node’s HTTP parsers, WebSocket byte forwarding, and TLS verification over in-memory streams, without opening network listeners. It does not replace live browser/realm acceptance:

```sh
node tests/game.test.mjs
node tests/community.test.mjs
node tests/ghostline.test.mjs
node tests/founders.test.mjs
node tests/frontend.test.mjs
node tools/check.mjs
rustfmt --edition 2024 --check server/src/main.rs
git diff --check
```

When compilation outputs are allowed, resolve dependencies and retain `server/Cargo.lock`, then run:

```sh
cargo test --manifest-path server/Cargo.toml
cargo build --release --manifest-path server/Cargo.toml
```

Cargo creates its normal lockfile, dependency cache, and target directory. These compilation commands were not run for the implementation task because it explicitly prohibited those generated files. Rust source parsing/formatting does not establish type correctness, linking, successful HTTP integration, or production readiness.

The scene and sky shaders were compiled and linked in memory against software EGL/GLES in both GLSL paths, with shader caches disabled. This checks shader syntax and linkage, not browser rendering quality or GPU performance. No browser account HTTP/WebSocket flow or physical-controller run was completed here. The device acceptance procedure is in [COMPATIBILITY.md](COMPATIBILITY.md).

## Online acceptance and capacity

Verify account registration/sign-in, session expiry/logout, eight-character limits, ownership isolation, duplicate connections, and character deletion on a real running server. Walk the same road and lift path in local and online mode; compare authoritative position, health, cooldowns, and quest state. Attempt an out-of-range attack, unavailable talent, premature quest completion, duplicate reward, forged position, and another account's character ID. Reconnect after an ability and restart after a checkpoint to check cooldown and progression persistence.

Exercise community actions with at least three accounts and two lineages: invitation/role/leadership changes, tabards visible to another player, revoked guild/party channel access, inaccessible other-lineage forums, private DM isolation, offline delivery, blocking and read cursors, and multiple pages of chat/forum history across restart. For auctions, test simultaneous buyouts, outbid refunds, expiry while the service is stopped, partial pack claims, repeated request IDs, rejected reused IDs with changed content, and storage failure before and after atomic rename. Verify that disconnecting immediately after a trade cannot restore spent credits or listed items. Export both online and offline characters, verify with a separately obtained public key, modify the payload to confirm signature rejection, and confirm key reuse across restart. Confirm midnight UTC rolls the supply reward once and that changing browser timezone does not change online world lighting.

Capacity must be measured on the intended machine and storage. Increase simultaneous clients gradually, exercising movement, targeting, combat, quest turn-ins, and reconnects. Include a crowded Commons case and players distributed across the basin. Record p50/p95/p99 simulation and snapshot delays, CPU by core, resident memory, bytes per second, socket failures, save latency, and input queue pressure. Test slow clients and temporary disk failure. “Thousands per instance” is a goal of the shard/interest architecture; no throughput or latency figures have been measured in this repository's current validation environment.

The world has fixed enemy spawns and basic spatial AI. The dungeon finder transfers queued characters into one additional expedition shard, with private encounter IDs and a shared 256-player ceiling. `SLOPERBERPUNK_SHARDS` controls ordinary world shards; it does not multiply dungeon capacity. Characters stay in the expedition shard's city after leaving the queue or a dungeon until they disconnect. A full expedition shard rejects new transfers without losing the source character. Include queue saturation, simultaneous ready checks, cross-shard transfers, disconnects during combat, and party-wide wipe/reset in capacity and release tests. Queues and unfinished runs do not survive restart; persisted arena return markers recover characters to the Commons. Completed rewards retain the normal character-checkpoint durability window. At high population, player admission, encounter density, snapshot bandwidth, and the single persistence writer require measurement and likely tuning. A production release also needs a resolved dependency lock and its license inventory. The current alpha is not represented as a load-certified MMO service.
