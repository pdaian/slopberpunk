# Editable source formats

All game-specific assets and rules are plaintext. JSON is UTF-8 with no comments. Distances are meters, positions are `[x, y, z]`, `y` is up, and the origin is Afterlight Commons. Names and dialogue may contain Unicode. IDs are stable lowercase machine identifiers and are referenced by other data files.

`client/data/manifest.json` is the version-2 content catalog. Its `files` map declares the schema version for every content document, including legacy documents whose JSON root is an array. Existing content schemas remain version 1. The client and server check the catalog before loading content and reject unsupported versions. Runtime records, social envelopes, WebSocket messages, and character exports use schema version 2; `Character.revision` and community `revision` describe successive states, independently of schema version.

## Runtime saves and signed exports

Account, stored-character, and nested character objects carry `version: 2`. Missing versions on legacy account/character files mean version 1; migrations add the schema and revision without discarding gameplay fields. Unsupported future versions cannot be overwritten by the current client/server. Community profiles, groups, messages, threads, auction listings, deliveries, and contacts are versioned records inside `sloperberpunk-social`, version 2. Blocks, cursors, reward claims, and request receipts inherit the enclosing schema.

A downloaded export has this envelope:

```json
{
  "format": "sloperberpunk-character-export",
  "version": 2,
  "algorithm": "Ed25519",
  "encoding": "hex",
  "publicKey": "<32-byte public key, 64 hexadecimal characters>",
  "signature": "<64-byte signature, 128 hexadecimal characters>",
  "payload": "<exact UTF-8 JSON string signed by the issuer>"
}
```

Verify the signature over the exact UTF-8 bytes of the `payload` string **before parsing or reserializing that string**. This avoids ambiguous canonicalization across runtimes. `client/src/persistence.js` exports `verifyExport(envelope, trustedPublicKey)` for future consumers and automated checks. An embedded public key alone establishes integrity, not trust: an importer must obtain/pin the issuer's public key independently, then require a matching envelope key, supported schema, and acceptable authority. The server publishes its key at `/api/signing-key`; private keys are never included in exports. A valid signature is not a one-time transfer receipt; a future importer must define replay prevention, ownership proof, and character-ID collision policy before granting any resources.

The signed payload declares `format: "sloperberpunk-character"`, `version: 2`, `authority: "server"`, and `exportedAt` in Unix seconds. It includes every persisted gameplay field and absolute ability/global/dash cooldown deadlines. Exports also include the character's memberships/invitations, authored posts and received DMs, authored threads, contact relationships, blocks, read cursors, lineage reward day, auctions as seller/current bidder, deliveries, and action receipts. Account passwords, session tokens, and unrelated private conversations are excluded. Transient movement velocity, active particle effects, and other players' world state are not character save data.

The server identity record contains a schema version, algorithm name, and a 32-byte secret seed; it is generated from OS randomness on first startup and reused.

Guild tabards store `base` and `trim` as `#RRGGBB`, `pattern` as `stripe`, `cross`, or `split`, and `emblem` as `signal`, `star`, or `tower`. The same small pixel recipe renders the editor preview and both sides of the character's tabard. These are editable vector/mesh recipes without a raster asset dependency.

## World map

`client/data/world.json` declares `format: "sloperberpunk-map"` and `version: 1`. It contains the city radius, basin bounds, spawn, generation seed, building grid, palettes, named districts, elevated platforms, lift stops, landmarks, and enemy spawns.

The building recipe is itself the parseable city map; generated vertices do not need to be exported. Iterate X then Z from `buildingGrid.min` through `max`, inclusive. Centers are `index * spacing + spacing / 2`. Skip centers inside `excludeCenter`. For each remaining cell, advance an unsigned 32-bit LCG:

```text
seed = (seed * 1664525 + 1013904223) modulo 2^32
random = seed / 2^32
```

Consume six numbers, in order: width, depth, height, concrete palette index, neon palette index, and decoration seed. Width/depth interpolate `widthMin..widthMax`; height interpolates `heightMin..heightMax`. The server consumes the three decoration numbers too, preserving the same later geometry. For seed 87421, the first output integer is 499456184. The current map produces 725 buildings.

Building geometry and horizontal collision share the same recipe. Rooftops and platform top surfaces are valid floors during downward movement. A platform's `position[1]` is its top surface, and `size` describes its horizontal extent and mesh thickness. Lifts require proximity to a declared stop and cycle through `stops`. Landmarks identify interact/explore destinations. District circles provide labels and suggested levels; enemies have explicit spawn levels.

The optional `biomes` array adds circular regions outside the city. Each record has a stable `id`, `name`, `subtitle`, `description`, finite `center`, positive `radius`, suggested `minLevel`, hex `color` and `ground`, generation `seed`, and a `kind` of `wetland`, `forest`, `grassland`, or `fungal`. `World.biomeAt` uses horizontal distance; a matching biome takes precedence over the generic basin district in the HUD. The renderer generates deterministic scenery with clear axial paths, skips ordinary basin rocks inside these regions, and uploads one distance-culled chunk per biome. The scenery adds no collision, floor elevation, water hazards, or ecological simulation; authoritative movement and client prediction retain the existing flat basin floor. Contacts and landmarks occupy the crossing paths. The full map fits the basin bounds and labels the biome contacts; the minimap shows the same region footprints.

## Characters and meshes

`client/assets/models.json` declares `sloperberpunk-box-mesh`, version 1. Each named model is a list of parts with `center`, `size`, `color`, and optional `emissive` in the range 0–1. `color: "accent"` takes the actor's lineage/NPC/enemy color. Each box expands to twelve outward-facing triangles with flat normals. `client/assets/mark.svg` and `client/src/icons.js` contain the original vector symbols.

Shaders and the building/decorative geometry recipes live in `client/src/renderer.js`; they are also editable source assets. No texture file or binary mesh is required. The current character body mesh is shared across lineages, with lineage colors and lore/passives; distinct full body rigs and skeletal animation are not included.

## Campaigns

`quests.json` is an array of records:

```json
{
  "id": "stable-quest-id",
  "title": "An original chapter title",
  "faction": "relay",
  "race": null,
  "level": 0,
  "requires": [],
  "giver": "iri",
  "briefing": "Visible and optionally narrated dialogue.",
  "completion": "Dialogue after a successful turn-in.",
  "objective": { "type": "interact", "target": "market", "count": 1 },
  "reward": { "xp": 220, "credits": 20 }
}
```

Exactly one of `faction` or `race` identifies a faction or lineage campaign. Shared basin contracts set both to `null` and add `biome`, referencing a map biome; their NPC also carries that `biome` ID. Each basin chain has three contracts gated by level and the preceding completion. The existing client and server eligibility rules allow these contracts for every lineage/faction combination. `requires` lists completed prerequisite IDs. `kill` targets enemy template IDs; `interact` and `explore` target landmark IDs. Accepting and completing require proximity to `giver`, including contacts outside the Commons. Kills advance all matching active contracts, and an interaction can advance matching interact/explore objectives. Explore credit is earned inside the target radius. Completed quest IDs are retained to reject duplicate rewards. Shared contracts use the same save fields; no migration or new protocol command is required.

The basin's economic and ecological consequences live in briefings, evidence, and completion prose. Campaigns and basin chains have authored conclusions; the existing dungeon ballots retain their two choices and deferred ending. Content does not imply a new resource meter, branching quest command, global terrain change, or permanent alteration to shared enemy spawns. Keep the distinction between a legal victory and physical recovery explicit when extending these stories.

`factions.json`, `races.json`, `lore.json`, and `npcs.json` supply identities, colors, history, passives, contacts, and dialogue. Race stat `crit` is measured in percentage points; `speed` is additive to a base multiplier of one. The Revenant passive is therefore `3`, and Sporebound speed is `0.08`.

## Rules, abilities, and talents

`rules.json` contains XP costs, player statistics, movement tuning, combat probabilities/timers, inventory prices, network limits, and interaction range. XP to advance a level is `base + level * perLevel`. Levels start at zero and stop at 60. Rust interprets gameplay rules; the browser uses movement rules for prediction and other values for presentation. The current protocol supports 20 Hz simulation and 10 Hz snapshots; changing that protocol requires corresponding code changes, not just a JSON edit.

An ability has a stable ID, name, unlock level, resource cost, cooldown, range, power, kind, color, and optional duration/radius. Supported kinds are `damage`, `stun`, `heal`, `shield`, `area`, and `ghostline`. Combat rolls a d100; misses occupy the low interval, criticals the high interval, and remaining rolls deal normal damage. Higher-level enemies increase miss chance. Level scaling, armor, weapon rank, and damage talents alter damage. Numeric constants not exposed as tuning parameters remain readable in the Rust simulation source.

`rules.ghostline` sets the movement-history duration and sampling interval, minimum recording duration and traveled distance, arming delay, contact radius, cooperative power multiplier, energy return, and maximum visible echoes. The `ghostline` ability sets cost, cooldown, power, and blast radius. Server validation bounds history to six seconds, sampling to at least 50 ms, and visible echoes to eight; the ability cooldown must exceed history length. Snapshot routes contain `{ owner, name, started, path: [{ time, position }] }`, with `started` in shard seconds and each point’s `time` relative to the start of the recorded route. `ghostCharge` is `{ seconds, meters, ready }`. All of this is transient world state; the cast’s cooldown uses the existing saved cooldown map.

A talent has `stat`, `amount`, `level`, and `maxRank`. Supported stats are `health`, `energy`, `speed`, `crit`, `damage`, `shield`, `healing`, and `regen`. Talents draw from a shared point budget, with one point per five character levels. `enemies.json` defines base health, damage, movement speed, model, and color; the map assigns levels and home positions.

## Dungeon casebooks

`dungeons.json` is schema version 1, registered as `dungeons: 1` in the manifest. Its root contains `rules`, shared `production` annotations, and an `entries` array. Client startup and server content loading validate IDs, counts, level gates, finite arena coordinates, an unobstructed arena, supported motifs/patterns, enemy references, evidence locations, bounded rewards, and decision options. Edits require restarting the server and reloading clients together.

Each entry declares a stable `id`, `name`, exact `players` (1–8), minimum `level`, `venue`, hex `color`, procedural `motif`, spoiler-free `premise`, and ordered `chapters`. Chapters specify the enemy template, authored boss name, health multiplier, hazard pattern (`lanes`, `ring`, or `cross`), visible warning, briefing, two evidence records with arena-relative positions, and a reveal. `decision` contains a question, two choices with stable IDs, costs and epilogues, and a `deferred` epilogue. `reward` is shared by all outcomes. An entry's `production` object records narrative intent, thematic inspirations, twist fairness, mechanic meaning, composition assumptions, art/audio direction, and acceptance criteria. These annotations are production guidance and stay outside the player-facing casebook.

The common rule block controls ready/ballot/run deadlines, the arena origin and boundary, aid location, personal recovery/revive limits, hazard warning and pulse timing, and encounter budgets. Evidence offsets translate by the arena origin; `recoveryPosition` is an absolute world coordinate. The ring pattern charges the area outside a central 16 m square; cross charges two 8 m strips; lanes alternates the two halves. Hazards use horizontal footprints at every jump height. Rendered stripes and server damage share these dimensions. Encounters spawn `ceil(players/2)` enemies with total health `players * (enemyHealthPerPlayer + level * enemyHealthPerLevel) * chapter.healthMultiplier`, rounded up per enemy. Enemy contact damage is a fraction of the target's maximum health.

Version-2 WebSocket commands add `{ "type": "dungeon", "operation": "queue", "dungeon": "ninth-bell", "version": 2 }`. Other operations are `leave`, `ready`, `begin`, `interact`, `recover`, `revive`, and `vote`. Matched/active operations include numeric `run`, `chapter`, and `attempt` from the last snapshot; leaving a matched run requires its `run`, while cancelling an unmatched ticket requires no run token. `interact` carries an evidence `target`, `revive` a character `target`, and `vote` a `choice` ID or `defer`. The actor ID always comes from the authenticated socket. Online run state appears under snapshot `dungeon.run`; unmatched status is `dungeon.queue`, otherwise `null`.

Character version 2 adds optional `dungeonHistory`, mapping dungeon IDs to `{ "clears": 1, "ending": "repair" }`, and transient recovery marker `dungeonReturn: [0,0,32]`. Missing history defaults to empty on the server; legacy server saves remain readable. Active run state is never imported from a save. The return marker is cleared on recovery/exit and checked again when reconnecting. Run IDs, evidence, ballots, and timers never become persistent progression. Signed exports include history and any recovery marker through the existing character envelope. Run `cargo test dungeons` after editing these files when build outputs are permitted.

## Movie and sound source

`intro.json` declares `sloperberpunk-cinematic`, version 1. It has a duration and contiguous shots. Each shot defines start/end seconds, camera eye `from`/`to`, `lookFrom`/`lookTo`, a subtitle, and a location label. The player renders this asset after creation; Settings can replay it. Smoothstep interpolation drives each camera shot. The sequence is entirely original and contains no externally sourced video.

`audio.json` contains the score's tempo, chord frequencies, bass progression, melody frequencies, and synthesized effect envelopes. Web Audio creates the oscillators at runtime. This is the editable source of the music, not a sampled recording. Local speech voices are supplied by the user's device and are not game assets.

Run `cargo test` after editing content when build outputs are permitted. Server startup and Rust tests validate the gameplay content and deterministic map; also check the rendered world and cinematic in a browser.
