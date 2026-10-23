# SLOPERBERPUNK

**Fourteen empty bowls. A city that says everyone is fed. Find the people its records leave behind.**

An original GPL-3.0-or-later cyberpunk browser RPG, set in the terraced city of Vesper and the surrounding Pale Basin. This repository contains a buildless WebGL client, an authoritative Rust service, original editable art and audio recipes, and complete written faction and lineage campaigns. The current release is a playable alpha; browser/device acceptance and server load certification are still outstanding.

New characters begin in the **First Steps Courtyard**, just north of the Commons. Follow the tutorial markers to walk onto a pad, use a terminal, and shoot a harmless practice target. Keyboard, controller, and touch instructions appear in the HUD and journal. The green Commons gate starts the existing opening story and can also be used to skip training. Tutorial progress is saved by the server and resumes after reconnecting; existing characters keep their current progress. The courtyard prevents hostile combat, and practice shots grant no XP, gold, or items.

Your **callsign is your character’s name**, visible to other players. Choose 2–24 letters, numbers, spaces, hyphens, or underscores. New names must be unique across all accounts on the server; capitalization and leading or trailing whitespace cannot claim an existing name.

The overarching campaign, **The Living Record**, begins with fourteen missing diners at Nella’s kitchen. With Oru and your faction contact, follow the difference between what Vesper’s accounts promise and what its people receive. Five chapters connect the opening, public charters, basin supply limits, enforcement orders, and a final account brought back to the kitchen. Your faction investigates control of services; your lineage follows the lives those systems claim or exclude. Residents give specific jobs, explain the evidence, and report what changed afterward. Resource shortages and the costs of each decision carry the themes; instructions and dialogue use direct language.

Open **J → Story** for your current chapter, next reachable lead, filed discoveries, local cases, and saved expedition decisions. The HUD keeps the next lead after the opening guide ends, and its marker follows the current objective or turn-in contact. All 203 contracts have a Living Record connection in their journal cards. Contacts acknowledge completed work; field evidence, neighborhood conversation, equipment, Ghostline, recovery, and expedition testimony carry the same story. Later chapter findings and the closing scene appear as the required records are completed.

The account follows the existing 31 faction contracts, 13 lineage contracts, and three opening kitchen contracts. Other neighborhood and basin cases add optional findings, and none of the six expeditions gates the main story. Progress is derived from saved completion IDs and `dungeonHistory`, including older characters; the campaign keeps its prerequisites and level gates. Moral decisions add saved consequences and adjust the gold settlement while retaining full quest XP. These are that character’s recorded outcomes, while shared street incidents can recur. The editable chapter structure and route connections live in `lore.json`; `story.js` validates and presents them.

Four procedural nature biomes surround the city, each with two landmarks, a local contact, enemy patrols, and a three-contract story available to every faction and lineage:

| Biome | Direction | Contact / contract level | Conflict |
| --- | --- | --- | --- |
| Mourning Fen | East | Mara Venn / 8 | Pump wages and private water dividends drain the wetland keeping the workers alive. |
| Cinderwood | West | Tovin Ash / 18 | Restoration credits reward felling; common care saves a canopy while destroying a pension reserve. |
| Glassroot Steppe | North | Ada Silt / 32 | Replacement bodies need minerals beneath a settlement's root mat; retreat preserves ground at the cost of a home. |
| Brine Bloom | South | Ilex Marr / 46 | Freedom from a culture patent releases growth that humans cannot safely inhabit; containment and withdrawal leave no final equilibrium. |

Use **M → Pale Basin** to locate contacts and **J → Basin** to read their chains. The original 176 campaign IDs, level gates, prerequisites, and base rewards remain in place; twelve optional basin contracts and fifteen neighborhood contracts bring the total to 203. Basin outcomes are authored quest epilogues selected through saved moral decisions and completion records; ecological depletion is not simulated. Biome plants are decorative, with clear crossing paths to contacts and terminals. The Fen levee adds a walkable embankment and lookout.

## Decisions the city remembers

Every one of the **203 contracts across all 17 questlines** now ends with an explicit choice at its contact. Read **Decision & Consequences** before committing: each contract has its original proposed settlement and an authored alternative, with different benefits and costs. **J → Standing & Choices** records your decisions, relationships, and outstanding commitments. Objectives and full XP remain available on either path; the settlement pays 75–140% of base gold, rounded down, or zero gold when you choose restitution.

There is no single good/evil score. **Care, autonomy, and candor** can conflict. Decisions separately change standing with the four playable factions and the basin concessions, trust in five neighborhoods and four biomes, and your bond with the contact. Values and relationships stay within −100 to +100. Welcome/distrust begins at ±8 and trust/resentment at ±20. A resident's work also matters: records clerks care about candor, patients about autonomy, and service workers about care. Welcoming residents acknowledge you; distrustful residents turn away and withhold private conversation while still giving public directions. Contacts remember your selected settlement, and the final return to the kitchen reflects local trust and unresolved breaches.

Choices establish a continuing commitment for their questline. Reversing it adds **one unresolved breach**, costs another **3 local trust and 2 contact bond**, and records the reversal permanently. A later contract on that route offers **restitution**: give up its entire gold payment, acknowledge the cost, restore some trust, and clear one breach. It keeps the current commitment and never removes the earlier decision. Breaches left at the end of a route remain part of the final account.

**I → Conviction gear** offers six bound modifications alongside normal equipment: a Streetweave guard, Freehand interface, Witness optic, Warden brace, Concession finder, and Restitution circuit. Decisions earn their associated imprint; **1, 5, and 12 imprints** unlock three ranks. Fit one at a time. They improve actual combat, recovery, movement, or patrol-gold stats under the normal caps. Some require matching values and become dormant if those values fall; earned imprints remain. These modifications cannot be sold or traded. Patch charges **85%, 95%, 100%, 110%, or 120%** of base medkit and coil-upgrade prices according to Commons trust, rounded up. Quest access and essential services remain available at every standing.

The six expeditions also record your **first completed personal ballot**, separately from the crew's ending. Its standing and gear effects occur once; later runs keep normal expedition rewards without farming reputation. Abstention is recorded with no standing or imprint award. Existing completed contracts and older expedition histories keep their progress and are not assigned invented choices. An older active contract retains its earned objective progress and offers a choice when turned in.

Decisions, scores, commitments, and gear survive reconnects and signed exports through the existing server checkpoint system. Their neighborhood presentation belongs to that character; it does not rewrite another player's story or the shared incident simulation. Editable choices, consequences, and gear live in `client/data/morality.json`.

## Life on the block

Press **Enter** or tap **CHAT** for live conversation while playing. **Nearby** reaches runners within **35 m** and shows eight-second speech bubbles; **Zone** reaches your current district or biome in the same shard. Inside an expedition, Zone reaches only that crew. Press **B** for animated **Wave, Nod, Cheer, and Point**, or type `/wave`, `/nod`, `/cheer`, or `/point`. `/say` and `/zone` choose a message's audience. Message starters let you introduce yourself, invite help with the kitchen, or thank someone; they fill a draft for you to review and send. On a controller, use **Menu → Nearby & Zone Chat / Gestures**, then the D-pad and A; B returns to play.

The opening guide and journal offer three optional exercises: greet the block, introduce yourself nearby, and invite neighbors through zone chat. Completion is saved on your character after the server accepts each action; no reply, party, or other online player is required. **C → Community** retains persistent world chat, private messages, guilds, parties, and **People → Block**. Existing player blocks also apply to live messages and gestures. Live chat is limited to 280 characters and one message or gesture every two seconds, with bounded session history; it is not saved or replayed on reconnect. Drafts stay in memory while you play and clear when you change character.

Every building has a stable street address, a named business or stockroom, a purpose, and a local history available through its residents. Five district palettes and facade styles distinguish market awnings, archive ribs, workshop pipes, planted balconies, and transit frames. Eight ground-floor layouts include clinics, repair counters, kitchens, waiting rooms, libraries, laundries, nurseries, and parcel offices. Signs, patched panels, drying lines, table contents, and upper-floor rooms vary by use and building seed.

The 577 public buildings each have **three usable floors**, linked by two stair flights. Couriers use those stairs and tenants work upstairs. **Fourteen outdoor route sections** connect streets, garden terraces, embankments, the 24 m skyways, and the 48 m crown landings. Walk onto stairs, ramps, or hills to climb; sprint, dash, jump, and descent use matching client/server geometry. Amber map lines and nearby signs identify these routes, and the HUD shows the actual elevation and floor. The Commons freight ramp starts north of the plaza at **[8, 0, -176]**; the Night crew ramp starts at **[328, 0, 176]**.


Vesper's residents carry deliveries, repair equipment, serve and eat meals, tend planters, compare records, and wait for connections. Shops have attendants and visiting customers. Residents walk between purposeful stops on different floors, change work during the UTC night shift, face nearby conversation partners, and take cover from visible nearby hostile machines before retracing their escape route. Small groups gather for three-minute neighborhood scenes: meals and water deliveries, archive checks, coupling repairs and breaks, garden work and warning tests, and night-shift deliveries. Matching props and effects appear at each scene, respect reduced motion and render quality, and pause during active incidents. Select a resident and press **E** to ask about their work and neighborhood; passing conversations also appear briefly in the street.

Five neighborhoods have their own workspaces, 36 named regulars, rotating street scenes, and three-contract stories:

| Neighborhood | Steward / level | Local conflict |
| --- | --- | --- |
| Lantern Market / Commons | Nella Rook / 0 | A free kitchen's donated water is billed back to its donors. |
| Glass Steps / Glass Archive | Elin Voss / 10 | Cooling priority protects profitable memories before consent. |
| Copper Walk / Cinder Works | Merek Tan / 20 | Empty offices stay warm while occupied flats are erased from the register. |
| Listening Courts / Quiet Quarter | Sable Ren / 30 | Disconnecting advertisements also disconnected the flood warning. |
| Last Connection / Upper Transit | Ivo Pell / 40 | Night workers disappear from passenger counts because they use service passes. |

Start with **Nella, just west of the Commons**, or open **J → Neighborhoods**. **M → City / Neighborhoods** marks every steward; Last Connection is on the 24 m skyway, reached by the Night crew ramp or Transit lift. Inspect the neighborhood terminals for evidence and accept/turn in contracts with the steward. Completed chapters change local dialogue, civilian activities, and service indicators when that character returns, including after reconnecting. These changes reflect that character's saved progress; they do not rewrite the shared city's economy or other players' stories.

Civilian routines use the synchronized clock and stream around the viewer, capped at 64 residents (30 on low quality), with simpler meshes at distance. Local crowd reactions are presentation, not damageable or reward-bearing server actors. Contracts, prerequisites, proximity checks, completion, and one-time rewards use the existing authoritative server and character saves. Live device performance and multiplayer visual acceptance still require playtesting.

The **eight opening contracts and all fifteen neighborhood contracts now have ordered objectives**: compare evidence, respond to a live emergency, monitor a service, and confirm its handover. The journal lists the steps, and the tracker and map follow the current destination. Each step is saved on the server. Contracts accepted before this update retain their original objective and any earned turn-in progress; IDs, prerequisites, level gates, and objective progress are unchanged. Turn-in now also requires a moral settlement.

The opening now follows **A place at the table**: meet your faction contact, collect Oru’s welcome record, investigate the kitchen shutoff, restore the water, and bring each record home. The guide then leads into Nella’s three-part story about missing meals and double billing. It shows one next action, direction, distance, and keyboard/controller/touch instructions, including what to do during incident retries. Guidance resumes from saved quest progress. Iri, Sera, Bram, Ves, Oru, and Nella have authored dialogue and distinct speech profiles, with narrated introductions, briefings, objective transitions, and endings. **VOICES** mutes speech; captions, replay controls, and written dialogue remain available. Playback prefers local English voices, then other browser-provided English voices or the browser’s English default. Some browser voices use an online service. Click/tap the page to enable audio, and use **Settings → TEST VOICE** to check playback. Pitch and pacing still distinguish characters when only one voice is available; captions remain available if speech is unsupported or fails.

Outside expeditions, **death costs 5% of carried gold, rounded up and capped at 50**. After five seconds, release your spirit at the nearest of nine Remembrance graveyards. Follow the body marker, use lifts if needed, and recover within 12 m with a clear view to return at **50% health and energy**. Spirits move 25% faster than base movement, cannot fight or advance quests, and cannot be damaged. A nearby Remembrance keeper offers a confirmed shortcut: another **10% of remaining gold, capped at 100**, resurrection at **25% health and energy**, and **60 seconds of resurrection sickness** with half damage and 25% slower movement. A character with no gold can still recover. **ESC / controller Menu** opens recovery options, including a return to your assigned graveyard if stranded. Death state and sickness survive reconnects through character saves; sickness counts down during living play. Dungeon ally revives and crew wipes retain their encounter rules.

**Street incidents happen even without an accepted quest.** Approaching a neighborhood starts a 12-second warning followed by a 150-second response window. Lantern Market faces a water shutoff, Glass Steps a cooling failure, Copper Walk a heat seizure, Listening Courts electrical flood surges, and Last Connection a service-pass lockdown. Select each marked control and press **E**, then keep a living runner within the **14 m beacon ring for 12 seconds**. Enforcement incidents require clearing the machines and gain a reinforcement halfway through the deadline. Pressure/electrical incidents mark a damaging circle three seconds before each pulse; move out of the striped area. Leaving the ring or leaving enforcement alive drains the hold meter. Any nearby runner can help, regardless of faction or party.

Success restores service for 75 seconds, changes local work and conversation, and advances matching current objectives for living contributors still nearby. Failure interrupts service and resets the response after 25 seconds; it does not erase completed quest steps. Signals, countdowns, control markers, hazards, and incident machines are shared within the shard, including on reconnect. Incidents restart after a server restart; saved quest steps retain the usual checkpoint guarantee. Incident machines grant no farmable kill XP, gold, or unrelated kill objectives. To try the opening response, accept work from your contact and Oru, check the Commons exchange, and follow the **Water under lock** markers.

## Ghostline — your past is someone else’s opening

**Leave your last six seconds running through the city. Let someone collide with your past.**

Ghostline turns movement into a shared combat tool. Sprint through a fight, release a luminous cyan version of the route you just took, and cut back through your moving afterimage to **braid** the two timelines into a shockwave. Another runner can cross your echo instead, creating a stronger **double braid** and restoring both players’ dash. A retreat can become a setup for a friend; a solo runner can cooperate with their own past.

It is playable from **level 0**, within an authoritative world shard:

1. **Lay a route.** Move at least **12 m over two seconds**. The HUD shows your progress; the game remembers up to six seconds of recent movement.
2. **Release it.** Press **R**, press the controller’s **right stick (R3)**, or tap the **R hotbar slot**. Costs **30 energy**, with an **18-second cooldown**; no selected enemy is needed. A glowing runner replays the recorded route, with a dotted trail and minimap trace.
3. **Cross the runner.** After a **0.6-second arming delay**, passing within **2.5 m** triggers one **10 m shockwave** against visible enemies. You recover **20 energy**, capped at your maximum, and your dash becomes ready immediately.
4. **Share the opening.** If another living player makes contact first, the blast has **50% more power**, and both runners receive the energy and dash recovery. No party or guild membership is needed. The creator receives ordinary kill XP, gold, and quest progress; crossing an echo does not duplicate those rewards.

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

Each dungeon has three authored chapters, two evidence stations per chapter, named enforcement machines, an explained twist, and two consequential choices plus a provisional ending for tied or abstaining ballots. Chapter breaks wait for every runner's explicit readiness. During encounters, use the common abilities, walk clear of three-second marked hazards, and select evidence, the free recovery station, or a fallen ally and press **E** within four meters. Everyone must witness at least one station per chapter; no class or voice-chat role is required. Recovery restores 45% maximum health every 12 seconds per runner, and each runner can revive allies twice per encounter. A full wipe resets the current chapter after five seconds, retaining earlier chapter progress.

The final 90-second ballot resolves early when everyone votes. Every ending gives the same personal XP/gold reward once per run; character saves retain clear counts and the last ending. Dungeon enemies grant no repeatable kill rewards or unrelated quest progress. Leaving or disconnecting before completion ends the expedition for the crew and returns them to the Commons; there is no mid-run backfill. Runs and queues are transient, and completed rewards use the existing checkpoint persistence guarantee. Runs expire after 90 minutes.

The readable source is [dungeons.json](client/data/dungeons.json). Every entry includes its literary/cinematic and philosophical reference points, clue/reveal logic, the relationship between mechanics and story, composition assumptions, art/audio direction, and acceptance criteria. The shipped environments use distinct procedural motifs and existing models/sounds; any bespoke art/audio directions are identified as future production work. Initial tuning has automated coverage, but human group balance and live multiplayer acceptance remain unverified.

## Gear, loot, and the player economy

Open **I → Gear & Buffs / Crafting / Mob Drop Encyclopedia**, or **C → Auction House**. Patch's supply counter also opens crafting and the sell-from-pack view.

Gold is the shared currency for supplies, crafting, upgrades, talent refunds, recovery fees, auction bids, and player gifts. Ordinary patrols, contracts, expeditions, and work orders pay gold. Daily lineage supplies now deliver **18 gold**, or **36 gold** in a lineage guild; medkits remain healing consumables. Existing credit balances and deliveries load as gold at **1:1**, and old medkit auctions and deliveries remain valid.

The catalog contains **24,031 items**, including **24,000 deterministic modular equipment combinations** built from five tiers, eight slots, six frames, ten prefixes, and ten suffixes. These are combinations of editable components, with fixed names, stats, recipes, and permanent IDs. Existing named gear remains available. Equip a weapon module, armor, implant, helmet, gloves, boots, belt, and charm. Choose between health, damage, healing, regeneration, critical chance, movement, armor, cooldown reduction, energy efficiency, penetration, leech, combo damage, and patrol gold. **I → Crafting** searches all recipes by name, tier, slot, and rarity, with 24 results per page and comparisons against equipped gear.

The five tiers remain Street (0), District (10), Basin (20), Skyline (35), and Afterlight (50), independent of Common through Legendary rarity. Ordinary patrols retain their named loot tables and have an additional **16% chance** to drop one modular item at their own tier. Its rarity weights are 60/25/10/4/1; each rarity has 960 equally likely combinations per tier. The drop encyclopedia shows these rates and searchable equipment. Incident and expedition machines do not generate ordinary loot. Every equipment item can be crafted at Patch. Salvaging a modular item costs gold and returns fewer materials than its recipe consumes.

**I → Work Orders** or Patch's counter offers **15 repeatable commissions** across all five tiers. Accept one, defeat the specified ordinary patrols in its tier, and return to Patch for gold and XP. Progress and completed-order counts are saved; accepting a new order requires completing or explicitly abandoning the current one. Fifteen additional patrol placements provide all three enemy types at each tier, including the previously incomplete Skyline and Afterlight pools. The existing 203 story contracts and six expeditions remain available.

Food and tool coatings use separate buff groups: one of each may be active. Eight new provisions join the original broth and tonic. Buff timers count living online play and survive reconnecting. The pack holds **160 distinct stacks**, with materials stacking to 999 and gear/provisions to 99. Medkits keep their separate 24-kit pack. Excess ordinary loot sells automatically at vendor value, capped by wallet space. Full auction deliveries retain their unclaimed items. Crafting, selling, salvaging, equipment changes, and paid talent refunds use the existing durable transaction and retry receipts.

**T → Talents** presents **78 nodes across six branching trees**: Anchor, Disruptor, Sustainer, Runner, Artificer, and Prospector. Each has a foundation, three paths, explicit rank and branch-point prerequisites, and three mutually exclusive capstones. Three invested points activate a branch's signature buff; hybrid builds can activate several. Start with **six points**, then earn one at each quarter of a level, reaching **246 total points at level 60**. Patch refunds all spent points for `100 + 25 × level` gold without refilling health or energy. Existing flat talent allocations are refunded automatically on the first migration.

Eleven abilities now support attack setups and payoffs. **7 / Breach shot** exposes an enemy for eight seconds; subsequent hits gain 20% damage, increased by combo power. **Echo collapse** consumes exposure. **Rail lance** gains 35% damage against a stunned enemy and consumes the stun. **8 / Siphon tether** restores health from 40% of actual damage dealt; **9 / Severance** gains 60% damage below 30% enemy health; **0 / Static net** exposes an area. The new hotbar uses two rows. Controllers retain their existing bindings; hold left-stick press and use D-pad up/right/down/left for Breach, Siphon, Severance, and Static net. Stun and exposure appear on the target label. Armor, haste, efficiency, penetration, leech, combo power, and gold gain have shared client/server caps shown in the inventory.

Level costs are now **1,100 × (80 + 35 × current level)**. Level 0 to 60 requires **73,425,000 XP**, while base kill and story rewards stay unchanged. As a tuning reference, 4–8 same-level patrol kills per minute takes approximately **511–1,023 hours** before quests, work orders, founder bonuses, travel, and downtime. This targets months of ordinary play; it is a rate model, not a calendar gate or a measured playtest guarantee. Work orders supplement the long climb, and quarter-level points provide intermediate build decisions. Existing characters retain their level and percentage toward the next level through a one-time `progressionVersion: 1` migration; no quest, gear, or wallet progress is erased.

## Run the game

The first **1,000 account signups per server** receive the **First Signal Halo**, a numbered, permanent black-chrome crown with magenta light fins and a rotating cyan orbit. It is worn automatically by every character on the eligible account, appears to nearby players, and cannot be traded. The game’s title screen links directly to signup and checks the server for remaining editions.

The halo grants **+5% combat and quest XP from level 1 until reaching level 10**. The level-0 prologue is unboosted; large rewards are split at both boundaries, small rewards retain fractional bonus credit, and no bonus spills into progression beyond level 10. The cosmetic remains permanently. Gear shows the edition and boost status, and reward messages include the XP actually granted. Existing-account upgrade behavior is documented in [operations](docs/OPERATIONS.md).

Install Rust 1.89 or later, then start the complete application from the repository root:

```sh
cargo run --release
```

Open **http://localhost:8080** to go directly to the game title screen at **/play.html**, then choose **Enter Vesper**. This one Rust process serves the frontend, accounts, multiplayer WebSockets, community, and persistence on the same listener. Browser JavaScript is served directly as ES modules; no frontend build or separate runtime is needed.

The default port is **8080**. To serve everything on **80** instead:

```sh
PORT=80 cargo run --release
```

`HOST` selects the bind IP (default `0.0.0.0`, all IPv4 interfaces); use `HOST=127.0.0.1` for local-only access. `SLOPERBERPUNK_BIND=IP:port` overrides both `HOST` and `PORT`. The default browser-origin allowlist follows the configured port, including the port-80 origin without a port suffix. When connecting through another hostname or LAN IP, set `SLOPERBERPUNK_ORIGINS` to the exact browser origin. See [operations](docs/OPERATIONS.md) for public HTTPS hosting, low-port permissions, storage, and thread configuration.

Use **Account** or **Enter Vesper** to register or sign in, then create or resume a server character. Each account supports eight characters. All play requires a connection to this server; characters and progress are stored there. **Settings → Export signed character** downloads a server-signed archive. The first Cargo run resolves dependencies and compiles the application; server startup creates the runtime database.

With a server character, press **C** or choose **Comms** for chat, messages, guilds, parties, the auction house, forums, contacts, and deliveries. Press **U** or choose **Guild** to open the guild roster, invitations, roles, and tabard editor directly. The server generates its private Ed25519 signing identity on first startup and reuses it thereafter. Back up the entire data directory, including `social.json` and `signing-key.json`. Server character exports are signed by that server identity; they include progression, cooldowns, social records, and economic records without including authentication secrets.

### Wipe the server database

The database is stored as JSON files in `server/data/` by default. If the server uses `SLOPERBERPUNK_DATA`, replace `server/data` in the commands below with that configured directory; relative overrides are resolved from the server process's working directory.

Stop the server with **Ctrl-C**, **SIGTERM** on Unix, or its service manager, and wait for the process to exit so final character writes finish. Prevent automatic restarts during the reset. Back up the entire data directory, including `signing-key.json`, outside that directory before continuing; see [operations](docs/OPERATIONS.md) for backup and restoration guidance. **A wipe deletes all accounts, characters and progress, and community/economy records, and resets the First Signal signup count.**

From the repository root, clear player data while preserving the server's signing identity:

```sh
rm -rf -- server/data/accounts server/data/characters server/data/social.json
```

Remove all three together: `social.json` also holds character recovery records, auction escrow, and pending deliveries.

For a complete reset that also erases the signing identity, use this command instead, while the server is stopped:

```sh
rm -rf -- server/data
```

Deleting `signing-key.json` makes the next startup generate a new signing identity. Previously signed exports still require the old public key for verification; they will not verify against the new server key.

Restart with the same configuration (`cargo run --release` for the default setup). The server recreates missing account/character directories and initializes empty community state. Players must register new accounts and create new characters.

### Play on Steam Deck

Use the browser client through a non-Steam browser shortcut in Gaming Mode. The [Steam Deck guide](docs/STEAM_DECK.md) covers the game URL, browser launch options, Steam Input, account access, and signed exports. Sign in to the same server to resume your character across devices and browser profiles. Steam Deck hardware acceptance is still outstanding.

The title screen, character creation, HUD, maps, dialogs, and every community section are presented by a dedicated WebGL interface. Original pixel glyphs, square terminal panels, labeled ability slots, and a bottom navigation rail share a single visual language. UI resolution stays independent of world render quality. The unpainted HTML controls retain browser layout, keyboard focus, native text editing/IME, password-manager support, and screen-reader semantics; they do not paint a second interface. Select menus and tabard color choices are rendered in the game as well.

Community drafts stay in memory for the current character while switching sections or returning to play; they are cleared when switching characters or reloading the page. **Ctrl/Cmd + Enter** sends a composed message or forum post. Failed requests retain their draft and request ID for retry. Native Tab navigation works in menus without triggering combat or target selection. Browser/GPU and touch/controller visual acceptance for the new interface remains outstanding.

## What is implemented

- A custom WebGL2 renderer with a WebGL1 shader path, beveled architecture and character meshes, smooth lineage details, cyan/magenta lighting, height fog, procedural wet pavement, rain, vent steam, wind-driven vegetation, walking residents, cargo traffic, and a pixel terminal interface rendered in WebGL. Articulated runners have speed-driven leg and arm motion, planted feet, airborne poses, and moving coat panels.
- A deterministic **725-building city**, approximately **2.24 km across**, inside a **6.4 km playable basin**. Streets, 24 m skyways, 48 m crowns, rooftop landings, lifts, terminals, NPCs, and enemy spawns come from readable map data.
- **577 walk-in buildings with three usable floors each**, eight ground-floor layouts, shared rooms and workrooms upstairs, and two internal stair flights. Lit ground entrances open on both sides, with server-validated walls, furniture, stairwells, windows, and headroom. Map fog reveals nearby streets during the browser session; active objectives remain visible. Green minimap marks identify discovered entrances. Interior geometry streams near the camera, and distant actors use simpler meshes.
- Keyboard/mouse, touch movement and action controls, and standard-mapped browser gamepads. Movement includes acceleration, sprint, buffered jumping, coyote time, air control, a short dash, wall collision, and first/third-person cameras.
- Four factions: **The Relay, Glass Covenant, Ash Foundry, and Null Choir**. Four playable lineages: **Afterborn, Lattice, Revenant, and Sporebound**, each with its own lore, passive, and campaign.
- **203 distinct quests**: 31 per faction at levels 0, 2, …, 60, 13 per lineage at levels 0, 5, …, 60, twelve shared biome contracts, and fifteen neighborhood contracts. Prerequisites, NPC proximity, objectives, turn-ins, and one-time rewards are enforced. Each faction campaign provides enough XP to reach level 60 without required grinding; lineage, basin, and neighborhood quests supply additional progression.
- Percentile-roll combat, target selection, misses and criticals, level scaling, cooldowns, energy, enemy aggression, stuns, respawns, medkits, gold, and ten weapon upgrades. Eleven abilities support ranged damage, disruption, healing, shielding, exposure, finishers, siphoning, area damage, and **Ghostline movement combos**. Seventy-eight talent nodes form six branching trees with prerequisites and capstone choices. Online healing affects nearby allies, and shielding draws nearby enemy attention.
- A **38-second opening cinematic** with four camera shots, captions, optional narration, replay/skip controls, and an original synthesized score. Its asset is an editable timeline rendered by the game, not a pre-encoded video file.
- Browser narration with local English voices preferred and browser-provided/default English voices as fallbacks. Some browser voices require an internet connection. No application-managed cloud voice API, microphone permission, downloaded recording, or neural voice model is bundled. Settings exposes playback status and a voice test; text remains available if speech fails.
- Browser accounts, Argon2id password hashes, random session cookies, ownership checks, character deletion confirmation, per-IP authentication limits, bounded WebSocket queues, server-validated gameplay, atomic JSON saves, persisted cooldowns, and a database process lock.
- Persistent guilds with invitations, member/officer/leader roles, leadership transfer, and tabards with editable cloth/trim colors, three patterns, and three emblems. Tabards appear on both sides of player models and guild names appear above nearby players. Parties, contacts, offline direct messages, read cursors, and blocking are included.
- Persistent world/trade/lineage/guild/party chats with older-history browsing; in-game forum sections with threads and replies; shared community state across world shards. Lineage halls are private to their own race. Completing a lineage chapter unlocks daily supplies, doubled for members of a guild reserved for that lineage.
- A credit economy with gifts, medkit auctions, bids, buyout, cancellation before bidding, real-time expiry, escrow, refunds, a 5% market fee, and durable deliveries. Retried requests retain their ID, and stored receipts prevent duplicate monetary actions.
- Schema-versioned flatfile persistence and signed exports, with legacy character/account migration and rejection of unsupported future versions. No database service is required.
- A **24-hour UTC day/night cycle** driven by real server time, an always-visible in-game UTC clock, changing sun/moon, sky and surface lighting, height fog, and inexpensive atmospheric sunlight and lamp shafts. Settings can disable volumetric light; low render quality skips the lamp shafts.

## Repository layout

```text
client/
  index.html                 Direct entry to the game title screen
  play.html, style.css        Semantic controls and responsive interface layout
  src/                       World/UI renderers, pixel font, prediction, input, audio, network
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
  src/morality.rs            One-time decisions, relationships, restitution, and conviction gear
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
| Move / look | WASD / hold and drag right mouse | Left / right stick |
| Jump / dash / sprint | Space / Q / Shift | A / B / left-stick press |
| Select a character or object | Left click; Tab cycles visible targets | Y cycles visible targets |
| Act on selected target: attack, talk, inspect, or ride | E; right click selects and acts | X |
| Arc / surge / heal / shield | 1 / 2 / 3 / 4 | RT / LB / RB / LT |
| Rail lance / echo collapse | 5 / 6 | D-pad left / right |
| Ghostline: release your recent route | R | Right-stick press (R3) |
| Medkit | H | D-pad up |
| Journal / talents / gear / map | J / T / I / M | View opens journal; Menu exposes controls; D-pad down opens map |
| Community / chat / auction house | C | Select Comms on the HUD or Community from Settings |
| Guild roster / roles / tabards | U | Select Guild on the HUD |
| Dungeons / group finder / casebook | G | Select Dungeons / Group Finder from Settings |
| Clear target / settings / camera | Escape clears target, then opens settings / V toggles camera | Menu opens settings |

One selection drives combat and interaction. Click empty space or press Escape to clear it. Right-drag only rotates the camera; the mouse remains free, including after double-clicks. On touch devices, use the left stick, drag the world to look, tap a character or object to select it (or cycle with TARGET), then tap ACT or an ability. In controller menus, navigate with the D-pad and activate with A. Text entry uses the browser/OS keyboard. Browser, OS, USB adapter, and standard controller mapping determine Android controller availability; see [compatibility](docs/COMPATIBILITY.md).

## Validation and present limits

Read-only source checks:

```sh
rustfmt --edition 2024 --check server/src/main.rs
node --experimental-default-type=module client/tests/world.test.mjs
node --experimental-default-type=module client/tests/citylife.test.mjs
node --experimental-default-type=module client/tests/quests.test.mjs
node --experimental-default-type=module client/tests/story.test.mjs
node --experimental-default-type=module client/tests/morality.test.mjs
node --experimental-default-type=module client/tests/ui.test.mjs
node --experimental-default-type=module client/tests/social.test.mjs
node --experimental-default-type=module client/tests/audio.test.mjs
node --experimental-default-type=module client/tests/recovery.test.mjs
node --experimental-default-type=module client/tests/targeting.test.mjs
node --experimental-default-type=module client/tests/economy.test.mjs
node --experimental-default-type=module client/tests/progression.test.mjs
git diff --check
```

When build outputs are permitted, run `cargo test` for the Rust configuration, frontend HTTP, content, gameplay, dungeon, Ghostline, founder reward, economy, community, persistence, and export tests. The frontend tests cover page/asset delivery, content types, security headers, HEAD requests, method restrictions, and private paths. Configuration tests cover ports 80/8080, IPv6, bind precedence, exact origins, and thread-count validation.

This change was checked without generating build outputs. Rust formatting/parsing, JavaScript syntax and in-memory behavior, JSON/content references, and the diff were validated. **The Rust service has not been compiled or integration-tested in this environment.** Browser/device and player-capacity certification remain outstanding. A Cargo lockfile has not been generated; resolve and retain the workspace's `Cargo.lock` before a reproducible binary release.

The server uses dedicated OS threads for independently owned world shards, a separate multithreaded HTTP/WebSocket scheduler, 20 Hz simulation, 10 Hz nearby snapshots, and bounded queues. The default cap is 256 players per shard with at most 64 nearby player representations sent to a client. An additional expedition shard has its own 256-player ceiling, shared by queued runners, active runs, and runners who remain in its city after leaving a dungeon. These are design limits, **not measured capacity**. Ordinary party membership does not migrate characters; joining the dungeon finder moves a character to the expedition shard until disconnect. PvP, account recovery, and raid systems beyond these eight-player expeditions are not implemented. The community flatfile is retained in memory and rewritten atomically for each mutation; its growth and disk latency limit capacity. See [architecture](docs/ARCHITECTURE.md) for persistence and scaling tradeoffs.

## License and originality

Sloperberpunk's original source and content are released under **GNU GPL version 3 or, at your option, any later version**, to the extent licensable rights exist. This includes editable art, map data, dialogue, sound recipes, and cinematic source. The software is provided **without warranty**, including merchantability or fitness for a particular purpose. See [LICENSE](LICENSE).

No commercial game meshes, textures, music, film clips, logos, or quest text were imported. Generic genre and combat concepts are implemented in original code and content. The [provenance analysis](docs/PROVENANCE.md) explains this construction and the limits of AI-assisted authorship, dependency licensing, and trademark clearance. It does not certify the user-supplied name or all assets as legally unencumbered.
