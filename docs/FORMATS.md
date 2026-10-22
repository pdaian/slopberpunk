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

World death adds optional `death: { corpse: [x,y,z], graveyard: "commons-rest", released: false, releaseAt: 0, creditsLost: 0 }` and `resurrectionSickness` (remaining seconds of living play). `releaseAt` is an absolute Unix timestamp in seconds. Both fields are server-owned and included in snapshots, checkpoints, and signed exports. Missing fields default to no death and no sickness; an older dead save receives a corpse at its saved position without a retroactive fee. Commands `releaseSpirit`, `reclaimCorpse`, `spiritHealer`, and `returnToGraveyard` carry no client-supplied coordinates, costs, or health. Legacy `respawn` only releases a spirit. Recovery requires release, the assigned graveyard or corpse proximity, and line of sight; dungeon recovery stays separate. Nearby player snapshots expose `ghost` for released spirits. The existing checkpoint/crash-window guarantee applies.

The server identity record contains a schema version, algorithm name, and a 32-byte secret seed; it is generated from OS randomness on first startup and reused.

Guild tabards store `base` and `trim` as `#RRGGBB`, `pattern` as `stripe`, `cross`, or `split`, and `emblem` as `signal`, `star`, or `tower`. The same small pixel recipe renders the editor preview and both sides of the character's tabard. These are editable vector/mesh recipes without a raster asset dependency.

## World map

`client/data/world.json` declares `format: "sloperberpunk-map"` and `version: 1`. It contains the city radius, basin bounds, spawn, generation seed, building grid, palettes, named districts, elevated platforms, lift stops, landmarks, and enemy spawns.

`graveyards` declares stable IDs, display names, and ground-level positions. Server content validation rejects duplicate IDs, blocked positions, and positions within enemy-spawn aggro range plus interaction range. `rules.json.death` supplies credit-loss fractions/caps, corpse recovery radius, resurrection health/energy fractions, spirit speed, and sickness duration and multipliers. Resurrection never deletes XP, equipment, or quest progress.

The building recipe is itself the parseable city map; generated vertices do not need to be exported. Iterate X then Z from `buildingGrid.min` through `max`, inclusive. Centers are `index * spacing + spacing / 2`. Skip centers inside `excludeCenter`. For each remaining cell, advance an unsigned 32-bit LCG:

```text
seed = (seed * 1664525 + 1013904223) modulo 2^32
random = seed / 2^32
```

Consume six numbers, in order: width, depth, height, concrete palette index, neon palette index, and decoration seed. Width/depth interpolate `widthMin..widthMax`; height interpolates `heightMin..heightMax`. The server consumes the three decoration numbers too, preserving the same later geometry. For seed 87421, the first output integer is 499456184. The current map produces 725 buildings.

Building geometry and collision share the same recipe. The optional `interiors` object supplies `height`, `wall`, `doorWidth`, `doorHeight`, `rooms`, and two `upperRooms`. Each ground room has a display `name`, hex `color`, and `furniture` entries with `kind`, local `center`, and `size`. The decoration seed is `floor(sixthRandom * 999999)`. A building has an interior when that seed modulo five is nonzero; its room index is the seed modulo the room count. The shipped seed produces 577 public buildings in 725 footprints. Each public building has floors at 0, 6.4, and 12.8 m. Upper rooms use separate furniture recipes. No extra world RNG values are consumed; building centers, dimensions, and heights remain stable. Upper tower sections step back according to the decoration seed. On reconnect, the server moves a saved character or corpse out of newly blocking furniture or terrain, preferring a nearby aisle or the surface directly above.

Interior shells have ground-level openings centered in both Z walls, closed upper windows, and a clear central aisle. The first stair flight rises along the east wall, the second along the west; slabs leave openings above the incoming flights and clear end landings. Each flight has 32 steps across the building depth minus eight meters. The tower above the three usable floors remains solid. Furniture boxes, walls, lintels, and ceilings are identical in client prediction and authoritative collision. Downward movement can land on furniture and rooftops; upward movement stops below lintels and ceilings. Visibility uses exact segment/box intersections at torso height. Room validation rejects furniture in the aisle or outside the smallest building, and doors too small for the player. Interior lighting, signs, trim, and loose surface details are decorative. Their buffers are created near the camera and released after it leaves the neighborhood.

Rooftops and platform top surfaces are valid floors during downward movement. A platform's `position[1]` is its top surface, and `size` describes its horizontal extent and mesh thickness. Lifts require proximity to a declared stop and cycle through `stops`. Landmarks identify interact/explore destinations. District circles provide labels and suggested levels; enemies have explicit spawn levels.

The optional `routes` array defines axis-aligned outdoor `stairs`, `ramp`, and `hill` sections. Each has an `id`, display `name`, feet-height `start` and `end`, and `width`; stairs also require an integer `steps`. Routes must stay within map bounds, have exactly one horizontal axis, a slope no steeper than 1:2, and stair rises no greater than 0.4 m. Ramps use continuous linear heights; stairs use discrete treads. Hills fill down to ground, while stairs and ramps have a 0.35 m underside. Platform openings are cut where an arriving route needs the last 3.5 m of headroom. Grounded movement can step up 0.42 m and follow a descent of up to 0.55 m per substep; airborne movement retains gravity and ceiling checks. Route bounds are indexed in the same spatial cells as buildings. Ray tests include slopes and stair undersides. Handrails and edge paint are decorative.

`architecture` supplies each district’s streets, materials, trim, business descriptions, histories, roles, detail motifs, and upper-floor uses. These do not consume world RNG or change collision. The decoration seed selects the business, window rhythm, repairs, and household details; grid coordinates provide a unique address. District labels use horizontal distance so climbing does not rename the neighborhood.

Exploration reveals nearby `cellSize` map cells as the player moves. The revealed set belongs to the character for the current browser session, survives in-session reconnects, and is not part of server saves. Active quest destinations remain visible through map fog. Green doorway marks on the minimap identify discovered interiors. Atmospheric distance/height fog is separate from map discovery.

The optional `biomes` array adds circular regions outside the city. Each record has a stable `id`, `name`, `subtitle`, `description`, finite `center`, positive `radius`, suggested `minLevel`, hex `color` and `ground`, generation `seed`, and a `kind` of `wetland`, `forest`, `grassland`, or `fungal`. `World.biomeAt` uses horizontal distance; a matching biome takes precedence over the generic basin district in the HUD. The renderer generates deterministic scenery with clear axial paths, skips ordinary basin rocks inside these regions, and uploads one distance-culled chunk per biome. Plant scenery adds no collision, water hazards, or ecological simulation. Walkable levees are separate `routes` with matching client/server height and collision. Contacts and landmarks occupy the crossing paths. The full map fits the basin bounds and labels the biome contacts; the minimap shows the same region footprints.

## Characters and meshes

`client/assets/models.json` declares `sloperberpunk-box-mesh`, version 1. Each named model is a list of parts with `center`, `size`, `color`, and optional `emissive` in the range 0–1. `color: "accent"` takes the actor's lineage/NPC/enemy color; `"skin"` takes the lineage material. Optional `shape: "bevel"` or `"round"` adds chamfered or smooth geometry, and `taper` narrows the lower part of a beveled mesh. Distant actors and low quality use boxes. A `joint` makes the part's center local to the named bone. The optional `lineages` map adds lineage-specific parts to the humanoid. Legacy unjointed parts remain in model space. `client/assets/mark.svg` and `client/src/icons.js` contain the original vector symbols.

Mesh primitives live in `client/src/geometry.js`, architecture in `client/src/scenery.js`, and the articulated runner rig in `client/src/character.js`. Movement blends between idle, walking, running, and airborne poses, with two-bone legs, planted stance feet, opposing arm swings, and coat movement. Locomotion uses actual velocity; remote player snapshots include transient `velocity` and `grounded` fields. Founder halos and guild tabards follow their attachment bones. Mesh templates are reused, and absent actors' animation state expires.

The renderer shades asphalt, paving seams, wear, road markings, wet patches, and ripples procedurally. No texture files or binary meshes are required. Nearby cosmetic pedestrians, cargo traffic, rain, steam, wind-driven vegetation, moving clouds, and contact shadows add motion without changing authoritative gameplay. Reduced-motion mode freezes decorative travel/weather and idle breathing; player locomotion remains readable. Quality controls reduce resolution, actor detail, draw distance, rain count, and lamp shafts. Static chunks are culled by camera frustum and distance.

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

Contracts may additionally declare `steps`, an ordered array of 2–8 objectives with `type`, `target`, `count`, and a player-facing `text`. Alongside `interact`, `explore`, and `kill`, steps support `event` (a successful response to an `events.json` ID) and `hold` (seconds spent alive within interaction range and sight of a landmark). Counts are 1–60; interact/explore/event steps require one action. Only the current step advances. One terminal interaction cannot consume successive steps; kills can advance matching current steps across multiple contracts. Hold seconds accumulate while present and pause when away or dead.

Newly accepted staged contracts store `questStages[id]: { "index": 0, "progress": 0 }` on the version-2 character. The cursor also retains `holdTicks` (0–19) so hold progress measures actual 50 ms simulation ticks rather than periodically sampling player position. This optional map defaults to empty on older saves. `activeQuests[id]` remains zero until every step finishes, then reaches the original objective count; turn-in and one-time rewards retain their existing rules. Active contracts without a cursor continue using their original objective, preserving existing ready-to-turn-in saves. Completion removes the cursor. Saves and signed exports include the cursor; stage progress uses the ordinary checkpoint guarantee. Keep authored step order stable after release. The eight openings and fifteen neighborhood contracts currently use stages.

### Shared street incidents

`events.json` declares `sloperberpunk-world-events`, version 1, and is registered as `events: 1` in the content manifest. Its `rules` bound warning, response, recovery, retry, and hold durations; activation/hold radii; and hazard timing, footprint, and damage fraction. Each entry has a stable ID, neighborhood, landmark `anchor`, two unique landmark `controls`, level, color, warning/success/failure dialogue, and recovery activity. An `enemy` template and two validated `spawns` select enforcement; `enemy: null` and no spawns select alternating hazards. Positions must be clear, on a walkable floor at the anchor's elevation, and within 120 m.

Every shard owns a bounded incident state per entry. Nearby living players at the correct elevation start `idle → warning → active`; activation requires no quest. Both controls must be restored, all incident machines disabled, and at least one living runner must hold the visible anchor area. Hold progress drains while unattended or contested. Enforcement has two initial machines after the first repair and one reinforcement halfway through the response window. Hazards alternate between controls, with a three-second warning and a matching 4.5 m circular footprint. Damage respects shields, walls, elevation, death, and dungeon isolation. Incident machines use ordinary combat and Ghostline, stay on their floor, never respawn, and grant no kill rewards or unrelated quest progress.

The version-2 command is `{ "type": "worldEvent", "id": "water-lockout", "cycle": 1, "site": "commons-water", "version": 2 }`. The server validates the phase, cycle token, deadline, site, proximity, sightline, living state, and instance, and applies the shared interaction throttle. Restoring a control also counts as reading that landmark for the current quest step. No client can submit progress, success, or rewards. A successful incident advances matching current `event` steps for living contributors within 120 m at the same elevation. Restoring a control or holding the cleared site counts as contribution; dungeon and disconnected characters receive no credit. Normal contract rewards still require the giver.

Snapshots include `worldEvents: [{ id, state }]`, with phase, cycle, deadline in shard seconds, repaired control IDs, hold seconds, and optional `{ position, radius, hitsAt }` hazard. All clients in that shard see the same incident. Recovery lasts 75 seconds; failure lasts 25 seconds before another warning can begin. Both clear incident machines and hazards. The transient incident state does not survive a server restart or transfer to another shard. Completed quest steps do survive through character saves. Live incidents alter civilian work, dialogue, and service lights without overwriting each character's permanent neighborhood story. The journal, map, HUD, and world markers render current snapshots; timers never award client-side progress.

`factions.json`, `races.json`, `lore.json`, and `npcs.json` supply identities, colors, history, passives, contacts, and dialogue. Race stat `crit` is measured in percentage points; `speed` is additive to a base multiplier of one. The Revenant passive is therefore `3`, and Sporebound speed is `0.08`.

### Neighborhood life

`citylife.json` declares `format: "sloperberpunk-city-life"`, version 1, and is registered as `citylife: 1` in the manifest. It is client presentation content, validated at startup against the map, NPCs, and quest catalog. `roles` define titles, daytime and optional nighttime activities, shift descriptions, and personal conversation. `names` supplies deterministic names for generated block residents. `neighborhoods` reference map district IDs and contain a fixed `contact`, three landmark `sites`, named `residents`, rotating `events`, a geometric `motif`, and four ordered `stages`. The first stage has no prerequisite; the following three reference completed quest IDs and specify the resulting street status, resident `line`, steward `contactLine`, and activity. Supported activities are listed in `CITY_ACTIVITIES` in `citylife.js`.

Neighborhood quests set `faction` and `race` to `null`, add `neighborhood`, and retain the ordinary authority checks. Their fixed NPCs and evidence landmarks also carry `neighborhood`. Landmark `evidence` is readable with the existing interaction control; it does not itself grant completion. The first contract compares records, the second ties evidence to a shared incident, and the third publishes and monitors a service handover. All return to the steward for completion. Saved completion IDs determine the lasting personal story; transient incident state temporarily overrides local work, dialogue, and service lights. The city map and neighborhood journal expose contacts, current steps, and incidents; the separate basin map retains the outer biome view.

Keep civilian routes inside the existing collision and floor geometry. `citylife.test.mjs` samples all authored and generated routes, checks content references and progression, and exercises threats, conversation pauses, streaming, animation, and restored story states. `world.test.mjs` covers the combined renderer using an in-memory WebGL test double; these are not browser or device acceptance tests.

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

`audio.json` contains the score's tempo, chord frequencies, bass progression, melody frequencies, and synthesized effect envelopes. Web Audio creates the oscillators at runtime. Its `voices` map keys speaker profiles by NPC ID (plus `narrator` and `keeper`), with `name`, editorial `style`, stable voice `slot`, `rate`, and `pitch`. Local English device voices are sorted by identity before slot selection; rate and pitch distinguish characters when only one voice exists. These are synthesis directions, not recorded or bundled voices. Missing English voices fall back to captions; delayed voice discovery can play only the current, undisposed line.

Opening quests add optional `story: { chapter, speaker, invitation }` and `steps[].voice`. These presentation fields do not alter IDs, prerequisites, objective cursors, or rewards. The guide derives its route from the saved faction/lineage opening contracts followed by the Lantern Market chain, including old single-objective saves. Written briefings and endings remain available in the journal.

Run `cargo test` after editing content when build outputs are permitted. Server startup and Rust tests validate the gameplay content and deterministic map; also check the rendered world and cinematic in a browser.
