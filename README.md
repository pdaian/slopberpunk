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

Use **M → Pale Basin** to locate contacts and **J → Basin** to read their chains. The original 176 campaign IDs, level gates, prerequisites, and rewards remain in place; twelve optional basin contracts and fifteen neighborhood contracts bring the total to 203. Basin outcomes are authored quest epilogues saved through existing completion records, rather than a simulation of ecological depletion. Biome scenery is decorative over the existing walkable basin floor, with open crossing paths to contacts and terminals.

## Life on the block

Vesper's residents carry deliveries, repair equipment, serve and eat meals, tend planters, compare records, and wait for connections. Shops have attendants and visiting customers. Residents walk between purposeful stops, change work during the UTC night shift, face nearby conversation partners, and take cover from visible nearby hostile machines before retracing their escape route. Press **E** near a resident to ask about their work and neighborhood; passing conversations also appear briefly in the street.

Five neighborhoods have their own workspaces, 36 named regulars, rotating street scenes, and three-contract stories:

| Neighborhood | Steward / level | Local conflict |
| --- | --- | --- |
| Lantern Market / Commons | Nella Rook / 0 | A free kitchen's donated water is billed back to its donors. |
| Glass Steps / Glass Archive | Elin Voss / 10 | Cooling priority protects profitable memories before consent. |
| Copper Walk / Cinder Works | Merek Tan / 20 | Empty offices stay warm while occupied flats are erased from the register. |
| Listening Courts / Quiet Quarter | Sable Ren / 30 | Disconnecting advertisements also disconnected the flood warning. |
| Last Connection / Upper Transit | Ivo Pell / 40 | Night workers disappear from passenger counts because they use service passes. |

Start with **Nella, just west of the Commons**, or open **J → Neighborhoods**. **M → City / Neighborhoods** marks every steward; Last Connection is on the 24 m skyway, reached by the Transit lift. Inspect the neighborhood terminals for evidence and accept/turn in contracts with the steward. Completed chapters change local dialogue, civilian activities, and service indicators when that character returns, including after reconnecting. These changes reflect that character's saved progress; they do not rewrite the shared city's economy or other players' stories.

Civilian routines use the synchronized clock and stream around the viewer, capped at 64 residents (30 on low quality), with simpler meshes at distance. Local crowd reactions are presentation, not damageable or reward-bearing server actors. Contracts, prerequisites, proximity checks, completion, and one-time rewards use the existing authoritative server and character saves. Live device performance and multiplayer visual acceptance still require playtesting.

The **eight opening contracts and all fifteen neighborhood contracts now have ordered objectives**: compare evidence, respond to a live emergency, monitor a service, and confirm its handover. The journal lists the steps, and the tracker and map follow the current destination. Each step is saved on the server. Contracts accepted before this update retain their original objective and any earned turn-in progress; IDs, prerequisites, level gates, and rewards are unchanged.

The opening now follows **A place at the table**: meet your faction contact, collect Oru’s welcome record, investigate the kitchen shutoff, restore the water, and bring each record home. The guide then leads into Nella’s three-part story about missing meals and double billing. It shows one next action, direction, distance, and keyboard/controller/touch instructions, including what to do during incident retries. Guidance resumes from saved quest progress. Iri, Sera, Bram, Ves, Oru, and Nella have authored dialogue and distinct local speech profiles, with narrated introductions, briefings, objective transitions, and endings. **VOICES** mutes speech; captions, replay controls, and written dialogue remain available. Playback requires an installed local English voice; pitch and pacing still distinguish characters when only one voice is available.

Outside expeditions, **death costs 5% of carried credits, rounded up and capped at 50**. After five seconds, release your spirit at the nearest of nine Remembrance graveyards. Follow the body marker, use lifts if needed, and recover within 12 m with a clear view to return at **50% health and energy**. Spirits move 25% faster than base movement, cannot fight or advance quests, and cannot be damaged. A nearby Remembrance keeper offers a confirmed shortcut: another **10% of remaining credits, capped at 100**, resurrection at **25% health and energy**, and **60 seconds of resurrection sickness** with half damage and 25% slower movement. A character with no credits can still recover. **ESC / controller Menu** opens recovery options, including a return to your assigned graveyard if stranded. Death state and sickness survive reconnects through character saves; sickness counts down during living play. Dungeon ally revives and crew wipes retain their encounter rules.

**Street incidents happen even without an accepted quest.** Approaching a neighborhood starts a 12-second warning followed by a 150-second response window. Lantern Market faces a water shutoff, Glass Steps a cooling failure, Copper Walk a heat seizure, Listening Courts electrical flood surges, and Last Connection a service-pass lockdown. Press **E** at both marked controls, then keep a living runner within the **14 m beacon ring for 12 seconds**. Enforcement incidents require clearing the machines and gain a reinforcement halfway through the deadline. Pressure/electrical incidents mark a damaging circle three seconds before each pulse; move out of the striped area. Leaving the ring or leaving enforcement alive drains the hold meter. Any nearby runner can help, regardless of faction or party.

Success restores service for 75 seconds, changes local work and conversation, and advances matching current objectives for living contributors still nearby. Failure interrupts service and resets the response after 25 seconds; it does not erase completed quest steps. Signals, countdowns, control markers, hazards, and incident machines are shared within the shard, including on reconnect. Incidents restart after a server restart; saved quest steps retain the usual checkpoint guarantee. Incident machines grant no farmable kill XP, credits, or unrelated kill objectives. To try the opening response, accept work from your contact and Oru, check the Commons exchange, and follow the **Water under lock** markers.

## Ghostline — your past is someone else’s opening

**Leave your last six seconds running through the city. Let someone collide with your past.**

Ghostline turns movement into a shared combat tool. Sprint through a fight, release a luminous cyan version of the route you just took, and cut back through your moving afterimage to **braid** the two timelines into a shockwave. Another runner can cross your echo instead, creating a stronger **double braid** and restoring both players’ dash. A retreat can become a setup for a friend; a solo runner can cooperate with their own past.

It is playable from **level 0**, within an authoritative world shard:

1. **Lay a route.** Move at least **12 m over two seconds**. The HUD shows your progress; the game remembers up to six seconds of recent movement.
2. **Release it.** Press **R**, press the controller’s **right stick (R3)**, or tap the **R hotbar slot**. Costs **30 energy**, with an **18-second cooldown**; no selected enemy is needed. A glowing runner replays the recorded route, with a dotted trail and minimap trace.
3. **Cross the runner.** After a **0.6-second arming delay**, passing within **2.5 m** triggers one **10 m shockwave** against visible enemies. You recover **20 energy**, capped at your maximum, and your dash becomes ready immediately.
4. **Share the opening.** If another living player makes contact first, the blast has **50% more power**, and both runners receive the energy and dash recovery. No party or guild membership is needed. The creator receives ordinary kill XP, credits, and quest progress; crossing an echo does not duplicate those rewards.

**Try it:** run past an enemy for three seconds, press R, turn, and dash back through the cyan runner. With a friend, lay your route through their fight and let them trigger the double braid while you keep moving.

Each echo can braid once and expires at the end of its recorded route. Damage uses the existing percentile rolls, armor, level scaling, and weapon/talent bonuses. Walls and elevation matter; players are not damaged. Death, lifts, and disconnects clear the owner’s echo. Movement recordings are transient, and online cast cooldowns survive reconnects through the existing server save system. This is an original feature design for this project, without a claim of verified worldwide exclusivity.

## Dungeons — the Afterlight casebooks

Press **G**, choose **Dungeons** on the HUD, or open **Settings → Dungeons / Group Finder**. Six expeditions have exact crew sizes and accept any combination of lineages, factions, and talent builds, including duplicate builds. The shared online queue matches runners from different home shards; an assembled crew has 30 seconds to accept. The solo expedition uses the same server as group expeditions.

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

The first **1,000 account signups per server** receive the **First Signal Halo**, a numbered, permanent black-chrome crown with magenta light fins and a rotating cyan orbit. It is worn automatically by every character on the eligible account, appears to nearby players, and cannot be traded. The game’s title screen links directly to signup and checks the server for remaining editions.

The halo grants **+5% combat and quest XP from level 1 until reaching level 10**. The level-0 prologue is unboosted; large rewards are split at both boundaries, small rewards retain fractional bonus credit, and no bonus spills into progression beyond level 10. The cosmetic remains permanently. Gear shows the edition and boost status, and reward messages include the XP actually granted. Existing-account upgrade behavior is documented in [operations](docs/OPERATIONS.md).

Install Rust 1.89 or later, then start the complete application from the repository root:

```sh
cargo run --release
```

Open **http://localhost:8080** for the landing page and choose **Enter Vesper** for the game at **/play.html**. This one Rust process serves the frontend, accounts, multiplayer WebSockets, community, and persistence on the same listener. Browser JavaScript is served directly as ES modules; no frontend build or separate runtime is needed.

The default port is **8080**. To serve everything on **80** instead:

```sh
PORT=80 cargo run --release
```

`HOST` selects the bind IP (default `0.0.0.0`, all IPv4 interfaces); use `HOST=127.0.0.1` for local-only access. `SLOPERBERPUNK_BIND=IP:port` overrides both `HOST` and `PORT`. The default browser-origin allowlist follows the configured port, including the port-80 origin without a port suffix. When connecting through another hostname or LAN IP, set `SLOPERBERPUNK_ORIGINS` to the exact browser origin. See [operations](docs/OPERATIONS.md) for public HTTPS hosting, low-port permissions, storage, and thread configuration.

Use **Account** or **Enter Vesper** to register or sign in, then create or resume a server character. Each account supports eight characters. All play requires a connection to this server; characters and progress are stored there. **Settings → Export signed character** downloads a server-signed archive. The first Cargo run resolves dependencies and compiles the application; server startup creates the runtime database.

With a server character, press **C** or choose **Community** for chat, messages, guilds, parties, the auction house, forums, contacts, and deliveries. The server generates its private Ed25519 signing identity on first startup and reuses it thereafter. Back up the entire data directory, including `social.json` and `signing-key.json`. Server character exports are signed by that server identity; they include progression, cooldowns, social records, and economic records without including authentication secrets.

### Play on Steam Deck

Use the browser client through a non-Steam browser shortcut in Gaming Mode. The [Steam Deck guide](docs/STEAM_DECK.md) covers the game URL, browser launch options, Steam Input, account access, and signed exports. Sign in to the same server to resume your character across devices and browser profiles. Steam Deck hardware acceptance is still outstanding.

## What is implemented

- A custom WebGL2 renderer with a WebGL1 shader path, beveled architecture and character meshes, smooth lineage details, cyan/magenta lighting, height fog, procedural wet pavement, rain, vent steam, wind-driven vegetation, walking residents, cargo traffic, and a dark slate MMO interface. Articulated runners have speed-driven leg and arm motion, planted feet, airborne poses, and moving coat panels.
- A deterministic **725-building city**, approximately **2.24 km across**, inside a **6.4 km playable basin**. Streets, 24 m skyways, 48 m crowns, rooftop landings, lifts, terminals, NPCs, and enemy spawns come from readable map data.
- **577 walk-in ground floors** with clinics, repair shops, noodle counters, and transit lounges. Lit entrances open on both sides, with server-validated walls, furniture, and headroom. Map fog reveals nearby streets during the browser session; active objectives remain visible. Green minimap marks identify discovered entrances. Interior geometry streams near the camera, and distant actors use simpler meshes.
- Keyboard/mouse, touch movement and action controls, and standard-mapped browser gamepads. Movement includes acceleration, sprint, buffered jumping, coyote time, air control, a short dash, wall collision, and first/third-person cameras.
- Four factions: **The Relay, Glass Covenant, Ash Foundry, and Null Choir**. Four playable lineages: **Afterborn, Lattice, Revenant, and Sporebound**, each with its own lore, passive, and campaign.
- **203 distinct quests**: 31 per faction at levels 0, 2, …, 60, 13 per lineage at levels 0, 5, …, 60, twelve shared biome contracts, and fifteen neighborhood contracts. Prerequisites, NPC proximity, objectives, turn-ins, and one-time rewards are enforced. Each faction campaign provides enough XP to reach level 60 without required grinding; lineage, basin, and neighborhood quests supply additional progression.
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
  src/                       Renderer, movement prediction, input, audio, network, UI
  data/                      Map, rules, quests, lore, races, factions, abilities
  assets/                    Original SVG mark and articulated mesh recipes
  tests/                     Buildless world, movement, geometry, and renderer checks
server/
  Cargo.toml                 Seven runtime Rust dependencies, pinned versions
  src/main.rs                Service, simulation threads, character storage, tests
  src/config.rs              Listener, origin, and thread configuration with tests
  src/web.rs                 Frontend delivery, security headers, HTTP tests
  src/ghostline.rs           Authoritative route replay, cooperative braids, tests
  src/quests.rs              Saved ordered objectives and legacy contract compatibility
  src/world_events.rs        Shared street incidents, hazards, defense, and tests
  src/dungeons.rs            Cross-shard finder, private encounters, ballots, tests
  src/social.rs              Community, auction escrow, signing, and tests
docs/
  ARCHITECTURE.md             Transport, authority, sharding, persistence limits
  FORMATS.md                 Editable content and deterministic map contracts
  OPERATIONS.md              Configuration, deployment, recovery, validation
  COMPATIBILITY.md           Browser, Android, gamepad, and voice conditions
  STEAM_DECK.md              Browser shortcut, controls, accounts, and hosting
  PROVENANCE.md              Originality assessment and IP limits
  THIRD_PARTY.md             Dependency and system-component notices
Cargo.toml                   Single-server workspace and release profile
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

Read-only source checks:

```sh
rustfmt --edition 2024 --check server/src/main.rs
node --experimental-default-type=module client/tests/world.test.mjs
node --experimental-default-type=module client/tests/citylife.test.mjs
node --experimental-default-type=module client/tests/quests.test.mjs
git diff --check
```

When build outputs are permitted, run `cargo test` for the Rust configuration, frontend HTTP, content, gameplay, dungeon, Ghostline, founder reward, community, persistence, and export tests. The frontend tests cover page/asset delivery, content types, security headers, HEAD requests, method restrictions, and private paths. Configuration tests cover ports 80/8080, IPv6, bind precedence, exact origins, and thread-count validation.

This change was checked without generating build outputs. Rust formatting/parsing, JavaScript syntax and in-memory behavior, JSON/content references, and the diff were validated. **The Rust service has not been compiled or integration-tested in this environment.** Browser/device and player-capacity certification remain outstanding. A Cargo lockfile has not been generated; resolve and retain the workspace's `Cargo.lock` before a reproducible binary release.

The server uses dedicated OS threads for independently owned world shards, a separate multithreaded HTTP/WebSocket scheduler, 20 Hz simulation, 10 Hz nearby snapshots, and bounded queues. The default cap is 256 players per shard with at most 64 nearby player representations sent to a client. An additional expedition shard has its own 256-player ceiling, shared by queued runners, active runs, and runners who remain in its city after leaving a dungeon. These are design limits, **not measured capacity**. Ordinary party membership does not migrate characters; joining the dungeon finder moves a character to the expedition shard until disconnect. PvP, account recovery, and raid systems beyond these eight-player expeditions are not implemented. The community flatfile is retained in memory and rewritten atomically for each mutation; its growth and disk latency limit capacity. See [architecture](docs/ARCHITECTURE.md) for persistence and scaling tradeoffs.

## License and originality

Sloperberpunk's original source and content are released under **GNU GPL version 3 or, at your option, any later version**, to the extent licensable rights exist. This includes editable art, map data, dialogue, sound recipes, and cinematic source. The software is provided **without warranty**, including merchantability or fitness for a particular purpose. See [LICENSE](LICENSE).

No commercial game meshes, textures, music, film clips, logos, or quest text were imported. Generic genre and combat concepts are implemented in original code and content. The [provenance analysis](docs/PROVENANCE.md) explains this construction and the limits of AI-assisted authorship, dependency licensing, and trademark clearance. It does not certify the user-supplied name or all assets as legally unencumbered.
