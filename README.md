# SLOPERBERPUNK

**The city lives on what it loses.**

An original GPL-3.0-or-later cyberpunk browser RPG, set in the terraced city of Vesper and the surrounding Pale Basin. This repository contains a buildless WebGL client, an authoritative Rust service, original editable art and audio recipes, and complete written faction and lineage campaigns. The current release is a playable alpha; browser/device acceptance and server load certification are still outstanding.

Human need, nature, and capitalism run through the opening, all eight campaigns, and the six dungeon casebooks. Vesper draws its survival from ecosystems its concessions treat as collateral. Public access, shared ownership, truthful accounting, and refusal can end particular cruelties; none replenishes an exhausted source. The tone is brooding and near-nihilistic, with materially different losses attached to each partial resolution.

Four procedural nature biomes surround the city, each with two landmarks, a local contact, enemy patrols, and a three-contract story available to every faction and lineage:

| Biome | Direction | Contact / contract level | Conflict |
| --- | --- | --- | --- |
| Mourning Fen | East | Mara Venn / 8 | Pump wages and private water dividends drain the wetland keeping the workers alive. |
| Cinderwood | West | Tovin Ash / 18 | Restoration credits reward felling; common care saves a canopy while destroying a pension reserve. |
| Glassroot Steppe | North | Ada Silt / 32 | Replacement bodies need minerals beneath a settlement's root mat; retreat preserves ground at the cost of a home. |
| Brine Bloom | South | Ilex Marr / 46 | Freedom from a culture patent releases growth that humans cannot safely inhabit; containment and withdrawal leave no final equilibrium. |

Use **M → map** to locate contacts and **J → Basin** to read their chains. The original 176 campaign IDs, level gates, prerequisites, and rewards remain in place; twelve optional basin contracts bring the total to 188. Outcomes are authored quest and dungeon epilogues saved through existing completion records, rather than a new simulation of ecological depletion. Biome scenery is decorative over the existing walkable basin floor, with open crossing paths to contacts and terminals.

## Ghostline — your past is someone else’s opening

**Leave your last six seconds running through the city. Let someone collide with your past.**

Ghostline turns movement into a shared combat tool. Sprint through a fight, release a luminous cyan version of the route you just took, and cut back through your moving afterimage to **braid** the two timelines into a shockwave. Another runner can cross your echo instead, creating a stronger **double braid** and restoring both players’ dash. A retreat can become a setup for a friend; a solo runner can cooperate with their own past.

It is playable from **level 0**, in local play and within an online world shard:

1. **Lay a route.** Move at least **12 m over two seconds**. The HUD shows your progress; the game remembers up to six seconds of recent movement.
2. **Release it.** Press **R**, press the controller’s **right stick (R3)**, or tap the **R hotbar slot**. Costs **30 energy**, with an **18-second cooldown**; no selected enemy is needed. A glowing runner replays the recorded route, with a dotted trail and minimap trace.
3. **Cross the runner.** After a **0.6-second arming delay**, passing within **2.5 m** triggers one **10 m shockwave** against visible enemies. You recover **20 energy**, capped at your maximum, and your dash becomes ready immediately.
4. **Share the opening.** If another living player makes contact first, the blast has **50% more power**, and both runners receive the energy and dash recovery. No party or guild membership is needed. The creator receives ordinary kill XP, credits, and quest progress; crossing an echo does not duplicate those rewards.

**Try it:** run past an enemy for three seconds, press R, turn, and dash back through the cyan runner. With a friend, lay your route through their fight and let them trigger the double braid while you keep moving.

Each echo can braid once and expires at the end of its recorded route. Damage uses the existing percentile rolls, armor, level scaling, and weapon/talent bonuses. Walls and elevation matter; players are not damaged. Death, lifts, and disconnects clear the owner’s echo. Movement recordings are transient, and online cast cooldowns survive reconnects through the existing server save system. This is an original feature design for this project, without a claim of verified worldwide exclusivity.

## Dungeons — the Afterlight casebooks

Press **G**, choose **Dungeons** on the HUD, or open **Settings → Dungeons / Group Finder**. Six expeditions have exact crew sizes and accept any combination of lineages, factions, and talent builds, including duplicate builds. The shared online queue matches runners from different home shards; an assembled crew has 30 seconds to accept. The solo expedition also works locally.

| Dungeon | Runners | Minimum level | Opening mystery |
| --- | ---: | ---: | --- |
| The Ninth Bell | 1 | 0 | A ninth shift bell rings for a worker named REST. |
| The Ferry of Borrowed Names | 2 | 8 | Two passengers share one missing woman's past; neither wants her old life. |
| A Trial for the Rain | 3 | 18 | Three truthful witnesses contradict each other, and a forecast stands accused. |
| The Orchard of Unlived Hours | 4 | 28 | A harvest invoice claims the labor of a child who has not been conceived. |
| The Theatre That Applauded First | 6 | 40 | A real warning arrives with fabricated consent and a supposedly inevitable murderer. |
| The Harbor at the End of Tomorrow | 8 | 50 | An evacuation ship cannot depart until eight nameless passengers arrive. |

Each dungeon has three authored chapters, two evidence stations per chapter, named enforcement machines, an explained twist, and two consequential choices plus a provisional ending for tied or abstaining ballots. Chapter breaks wait for every runner's explicit readiness. During encounters, use the common abilities, walk clear of three-second marked hazards, and press **E** within four meters of evidence, the free recovery station, or a fallen ally. Everyone must witness at least one station per chapter; no class or voice-chat role is required. Recovery restores 45% maximum health every 12 seconds per runner, and each runner can revive allies twice per encounter. A full wipe resets the current chapter after five seconds, retaining earlier chapter progress.

The final 90-second ballot resolves early when everyone votes. Every ending gives the same personal XP/credit reward once per run; character saves retain clear counts and the last ending. Dungeon enemies grant no repeatable kill rewards or unrelated quest progress. Leaving or disconnecting before completion ends the expedition for the crew and returns them to the Commons; there is no mid-run backfill. Runs and queues are transient, and completed rewards use the existing checkpoint persistence guarantee. Runs expire after 90 minutes.

The readable source is [dungeons.json](client/data/dungeons.json). Every entry includes its literary/cinematic and philosophical reference points, clue/reveal logic, the relationship between mechanics and story, composition assumptions, art/audio direction, and acceptance criteria. The shipped environments use distinct procedural motifs and existing models/sounds; any bespoke art/audio directions are identified as future production work. Initial tuning has automated coverage, but human group balance and live multiplayer acceptance remain unverified.

## Run the game

The first **1,000 account signups per server** receive the **First Signal Halo**, a numbered, permanent black-chrome crown with magenta light fins and a rotating cyan orbit. It is worn automatically by every character on the eligible account, appears to nearby players, and cannot be traded. The game’s title screen links directly to signup and checks the server for remaining editions; local play does not reserve one.

The halo grants **+5% combat and quest XP from level 1 until reaching level 10**. The level-0 prologue is unboosted; large rewards are split at both boundaries, small rewards retain fractional bonus credit, and no bonus spills into progression beyond level 10. The cosmetic remains permanently. Gear shows the edition and boost status, and reward messages include the XP actually granted. Existing-account upgrade behavior is documented in [operations](docs/OPERATIONS.md).

The client needs Node.js 22 or later and has **no npm dependencies or build step**:

```sh
node tools/serve.mjs
```

Open **http://localhost:3000** for the minimal landing page, then choose **Enter Vesper** to open the game at **/play.html**. The landing page needs no JavaScript or WebGL. The game’s title screen lets you create or resume a character. Local progress is saved in that browser; **Settings → Export signed character** downloads a versioned JSON envelope. Local signing uses a browser identity created and saved on startup, where Web Crypto Ed25519 is available. An unavailable realm server does not prevent local play.

The same built-in webserver serves the entire frontend and proxies account requests and multiplayer WebSockets. Its single realm connection setting is **`SLOPERBERPUNK_BACKEND`**, an HTTP or HTTPS origin (default: `http://127.0.0.1:8080`):

```sh
SLOPERBERPUNK_BACKEND=https://realm.example.com node tools/serve.mjs
```

No frontend configuration or build is needed when changing realms. `HOST` and `PORT` control the frontend listener (defaults: `127.0.0.1:3000`); `--port` overrides `PORT`. See [operations](docs/OPERATIONS.md) for public HTTPS hosting and the realm’s browser-origin allowlist.

For accounts and multiplayer, install Rust 1.89 or later, then run:

```sh
cargo run --release --manifest-path server/Cargo.toml
```

Keep the frontend at port 3000; its `/api` HTTP and WebSocket requests reach the configured realm. The Rust service can also serve the frontend directly at **http://localhost:8080**. Use **Account** on the game’s title screen to register, sign in, create, select, or delete a server character. Each account supports eight characters. The first Rust run resolves dependencies and compiles the service; starting the service creates its runtime database. These commands were not run during implementation because generated build/database files were excluded from the task.

Local and server characters have separate stores. A local save cannot be uploaded as an authoritative server character.

With a server character, press **C** or choose **Community** for chat, messages, guilds, parties, the auction house, forums, contacts, and deliveries. The server generates its private Ed25519 signing identity on first startup and reuses it thereafter. Back up the entire data directory, including `social.json` and `signing-key.json`. Server character exports are signed by that server identity; they include progression, cooldowns, social records, and economic records without including authentication secrets.

### Play on Steam Deck

Use the browser client through a non-Steam browser shortcut in Gaming Mode. The [Steam Deck guide](docs/STEAM_DECK.md) covers the game URL, browser launch options, Steam Input, local/offline play, and keeping browser saves and signed exports. Use the same browser profile and origin to retain local characters when switching between Desktop and Gaming Mode. Steam Deck hardware acceptance is still outstanding.

## What is implemented

- A custom WebGL2 renderer with a WebGL1 shader path, flat-shaded geometry, distance fog, emissive windows, animated cargo shuttles, an original signal monument, and a responsive dark-green MMO interface.
- A deterministic **725-building city**, approximately **2.24 km across**, inside a **6.4 km playable basin**. Streets, 24 m skyways, 48 m crowns, rooftop landings, lifts, terminals, NPCs, and enemy spawns come from readable map data.
- Keyboard/mouse, touch movement and action controls, and standard-mapped browser gamepads. Movement includes acceleration, sprint, buffered jumping, coyote time, air control, a short dash, wall collision, and first/third-person cameras.
- Four factions: **The Relay, Glass Covenant, Ash Foundry, and Null Choir**. Four playable lineages: **Afterborn, Lattice, Revenant, and Sporebound**, each with its own lore, passive, and campaign.
- **188 distinct quests**: 31 per faction at levels 0, 2, …, 60, 13 per lineage at levels 0, 5, …, 60, and twelve shared biome contracts. Prerequisites, NPC proximity, objectives, turn-ins, and one-time rewards are enforced. Each faction campaign provides enough XP to reach level 60 without required grinding; lineage and basin quests supply additional progression.
- Percentile-roll combat, target selection, misses and criticals, level scaling, cooldowns, energy, enemy aggression, stuns, respawns, medkits, credits, and ten weapon upgrades. Seven abilities support ranged damage, disruption, healing, shielding, area damage, and **Ghostline movement combos**. Eight talent nodes let players mix Anchor, Sustainer, Disruptor, and Runner roles. Online healing affects nearby allies, and shielding draws nearby enemy attention.
- A **38-second opening cinematic** with four camera shots, captions, optional narration, replay/skip controls, and an original synthesized score. Its asset is an editable timeline rendered by the game, not a pre-encoded video file.
- Local narration using explicitly selected installed device voices. No cloud voice API, microphone permission, downloaded recording, or neural voice model is bundled. Text remains available when the device has no local voice.
- Browser accounts, Argon2id password hashes, random session cookies, ownership checks, character deletion confirmation, per-IP authentication limits, bounded WebSocket queues, server-validated gameplay, atomic JSON saves, persisted cooldowns, and a database process lock.
- Persistent guilds with invitations, member/officer/leader roles, leadership transfer, and tabards with editable cloth/trim colors, three patterns, and three emblems. Tabards appear on both sides of player models and guild names appear above nearby players. Parties, contacts, offline direct messages, read cursors, and blocking are included.
- Persistent world/trade/lineage/guild/party chats with older-history browsing; in-game forum sections with threads and replies; shared community state across world shards. Lineage halls are private to their own race. Completing a lineage chapter unlocks daily supplies, doubled for members of a guild reserved for that lineage.
- A credit economy with gifts, medkit auctions, bids, buyout, cancellation before bidding, real-time expiry, escrow, refunds, a 5% market fee, and durable deliveries. Retried requests retain their ID, and stored receipts prevent duplicate monetary actions.
- Schema-versioned flatfile persistence and signed exports, with legacy character/account migration and rejection of unsupported future versions. No database service is required.
- A **24-hour UTC day/night cycle** driven by real server time, an always-visible in-game UTC clock, changing sun/moon, sky and surface lighting, height fog, and inexpensive atmospheric sunlight and lamp shafts. Settings can disable volumetric light; low render quality skips the lamp shafts.

## Repository layout

```text
client/
  index.html, landing.css     Lightweight landing page
  play.html, style.css        Game title, creation, cinematic, HUD, menus
  src/                       Renderer, simulation, input, audio, network, UI
  data/                      Map, rules, quests, lore, races, factions, abilities
  assets/                    Original SVG mark and box-mesh source models
server/
  Cargo.toml                 Seven direct Rust dependencies, pinned versions
  src/main.rs                Service, simulation, character storage, and tests
  src/ghostline.rs           Authoritative route replay, cooperative braids, tests
  src/dungeons.rs            Cross-shard finder, private encounters, ballots, tests
  src/social.rs              Community, auction escrow, signing, and tests
tools/
  serve.mjs                  Built-in frontend server and HTTP(S)/WebSocket proxy
  check.mjs                  JavaScript syntax and JSON validation
tests/
  game.test.mjs              In-memory gameplay and content regression suite
  dungeons.test.mjs          Solo completions, recovery, content, geometry, casebook
  community.test.mjs         Clock, export, migration, UI safety, and retry tests
  ghostline.test.mjs         Route, contact, combat, prediction, mesh, and input tests
  frontend.test.mjs          Static delivery, realm proxy, and transport regressions
docs/
  ARCHITECTURE.md             Transport, authority, sharding, persistence limits
  FORMATS.md                 Editable content and deterministic map contracts
  OPERATIONS.md              Configuration, deployment, recovery, validation
  COMPATIBILITY.md           Browser, Android, gamepad, and voice conditions
  STEAM_DECK.md              Browser shortcut, controls, saves, and local play
  PROVENANCE.md              Originality assessment and IP limits
  THIRD_PARTY.md             Dependency and system-component notices
LICENSE                      Complete GNU GPL version 3 text
```

## Controls

| Action | Keyboard / mouse | Standard controller |
| --- | --- | --- |
| Move / look | WASD / hold right mouse; double-click to capture | Left / right stick |
| Jump / dash / sprint | Space / Q / Shift | A / B / left-stick press |
| Talk, activate, or ride lift | E | X |
| Cycle enemies | Tab | Y |
| Arc / surge / heal / shield | 1 / 2 / 3 / 4 | RT / LB / RB / LT |
| Rail lance / echo collapse | 5 / 6 | D-pad left / right |
| Ghostline: release your recent route | R | Right-stick press (R3) |
| Medkit | H | D-pad up |
| Journal / talents / gear / map | J / T / I / M | View opens journal; Menu exposes controls; D-pad down opens map |
| Community / guilds / chat / auction house | C | Select Community from Settings |
| Dungeons / group finder / casebook | G | Select Dungeons / Group Finder from Settings |
| Camera / settings | V / Escape | Menu opens settings |

On touch devices, use the left stick, drag the world to look, and tap the action buttons. In controller menus, navigate with the D-pad and activate with A. Text entry uses the browser/OS keyboard. Browser, OS, USB adapter, and standard controller mapping determine Android controller availability; see [compatibility](docs/COMPATIBILITY.md).

## Validation and present limits

The no-output checks are:

```sh
node tests/game.test.mjs
node tests/dungeons.test.mjs
node tests/community.test.mjs
node tests/ghostline.test.mjs
node tests/founders.test.mjs
node tests/frontend.test.mjs
node tools/check.mjs
rustfmt --edition 2024 --check server/src/main.rs
git diff --check
```

They write no test reports, caches, coverage data, or build products. The JavaScript tests exercise gameplay/content, UTC time, migration, startup signing identity reuse, tamper detection, UI escaping, tabard geometry, retries, Ghostline, and the First Signal Halo. The Ghostline suite covers bounded history, timing, swept crossings, arming/expiry boundaries, walls, elevation, resource validation, one-time kill credit, cleanup, prediction isolation, finite emissive geometry, and keyboard/controller input. Rust unit tests also cover cooperative and solo braids, forged route rejection, cooldown serialization, and cleanup, alongside membership/privacy rules, history pagination, escrow conservation, expiry after serialization/reload, duplicate claims, transaction recovery/retries, and lineage rewards; `cargo test --manifest-path server/Cargo.toml` runs them when build outputs are permitted.

During implementation, the JavaScript tests and JavaScript/JSON checks passed, and Rust parsing/formatting passed. Both scene and sky shaders compiled and linked in memory against software EGL/GLES for the GLSL ES 1.00 and 3.00 paths with shader caches disabled. **The Rust service has not been compiled or integration-tested in this environment, and browser/device or player-capacity certification is not claimed.** A Cargo lockfile has not been generated; resolve and retain it before a reproducible binary release.

The server uses parallel, independently owned world shards, 20 Hz simulation, 10 Hz nearby snapshots, and bounded queues. The default cap is 256 players per shard with at most 64 nearby player representations sent to a client. An additional expedition shard has its own 256-player ceiling, shared by queued runners, active runs, and runners who remain in its city after leaving a dungeon. These are design limits, **not measured capacity**. Ordinary party membership does not migrate characters; joining the dungeon finder moves a character to the expedition shard until disconnect. PvP, account recovery, and raid systems beyond these eight-player expeditions are not implemented. The community flatfile is retained in memory and rewritten atomically for each mutation; its growth and disk latency limit capacity. See [architecture](docs/ARCHITECTURE.md) for persistence and scaling tradeoffs.

## License and originality

Sloperberpunk's original source and content are released under **GNU GPL version 3 or, at your option, any later version**, to the extent licensable rights exist. This includes editable art, map data, dialogue, sound recipes, and cinematic source. The software is provided **without warranty**, including merchantability or fitness for a particular purpose. See [LICENSE](LICENSE).

No commercial game meshes, textures, music, film clips, logos, or quest text were imported. Generic genre and combat concepts are implemented in original code and content. The [provenance analysis](docs/PROVENANCE.md) explains this construction and the limits of AI-assisted authorship, dependency licensing, and trademark clearance. It does not certify the user-supplied name or all assets as legally unencumbered.
