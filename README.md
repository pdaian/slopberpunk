# Sloperberpunk

Sloperberpunk is a multiplayer cyberpunk RPG set in Vesper and the surrounding Pale Basin. A WebGL browser client connects to an authoritative Rust server. The main story follows fourteen people missing from a neighborhood kitchen.

This is a playable alpha. Browser/device testing and server load testing remain outstanding. PvP and account recovery are not implemented.

## Run locally

Install Rust 1.89 or later, then run from the repository root:

```sh
cargo run --release
```

Open [localhost:8080](http://localhost:8080), choose **PLAY**, and register or sign in. Each account can have up to eight characters. All play requires a server connection; progress is saved on that server.

The Rust process serves the client, HTTP API, and multiplayer WebSockets. The client uses JavaScript modules directly, with no frontend build step. The first Cargo run downloads dependencies and compiles the server; startup creates its data directory.

The default listener is `0.0.0.0:8080`. Use `HOST=127.0.0.1` for local-only access, `PORT` to change the port, or `SLOPERBERPUNK_BIND=IP:port` to override both. Login and gameplay work through the hostname or IP used to open the page, including a LAN address such as `http://192.168.1.20:8080`. Set `SLOPERBERPUNK_ORIGINS` to restrict access to exact browser origins. See [operations](docs/OPERATIONS.md) for configuration, HTTPS hosting, and deployment.

## Playing

New characters start in the First Steps Courtyard. Walk to the cyan square, try the training terminal, and shoot the practice target, then use the Commons gate to enter the city. The gate also lets you skip training. The journal gives each quest a next action, place description, and full route through its final handover. Choose **FOLLOW QUEST** to follow any story, or **VIEW AREA** for a local map with named places and descriptions. Vesper and Pale Basin overviews help you find other neighborhoods. Quest guidance uses these descriptions instead of floating beacons or objective pins.

- Explore city streets, building interiors, rooftops, and four surrounding biomes.
- Ride velvet-lined Art Deco observation elevators to the Gilded Hour hotel lounge, Maison Nocturne tasting terrace, Verdigris Winter Garden, and Blue Hour jazz club. Gold squares on the city map mark their street entrances. Step inside and press **E** (controller **X** or touch **USE**) anywhere in the cabin to ride; use it again after arrival to return. A brief tutorial appears on your first entry, with no confirmation menu. All four venues are free to explore.
- Choose from four factions and four lineages. Their campaigns, neighborhood stories, and basin quests total 203 contracts, with saved choices and reputation.
- Build around combat abilities, talents, equipment, and crafting.
- Join six expeditions with fixed crew sizes of 1, 2, 3, 4, 6, or 8 players.
- Chat, form parties and guilds, trade at the auction house, and customize cosmetic armor in the Frame Forge.

### Controls

| Action | Keyboard / mouse |
| --- | --- |
| Move / look | WASD / hold and drag right mouse |
| Jump / dash / sprint | Space / Q / Shift |
| Select a target | Left click; Tab cycles visible targets |
| Attack, talk, inspect, or use selected target | E; right click selects and acts |
| Shoot / stun / heal / shield | 1 / 2 / 3 / 4 |
| Additional attacks | 5–9 / 0 |
| Medkit | H |
| Journal / map | J / M |
| Talents / gear and crafting | T / I |
| Chat / gestures | Enter / B |
| Community / guild / dungeons | C / U / G |
| Clear target, then open settings | Escape |
| Switch first/third-person camera | V |

Touch controls and standard-mapped gamepads are also supported. Open **HOW TO PLAY** for their bindings and gameplay help. See [compatibility](docs/COMPATIBILITY.md) for browser and controller requirements, or the [Steam Deck guide](docs/STEAM_DECK.md) for setup.

In menus and on interface buttons, use Tab / Shift+Tab to navigate and Enter or Space to activate a control. Tab cycles targets when the game world has focus. Panels restore focus when closed. Browser high-contrast mode uses native interface controls; reduced motion keeps cinematic camera shots still. The combat log can be read without interrupting spoken quest updates.

If your character gets stuck, open **Escape → UNSTUCK** (press Escape again if it first clears your target). This returns you to the Commons, the training courtyard during the tutorial, or your current dungeon's entrance. It preserves progress, health, and energy and can be used every 30 seconds.

Controller mappings are applied automatically, including the native Backbone One layouts on desktop Linux in Chrome and Firefox. **Settings → Camera turn speed** adjusts mouse, touch, and right-stick turning. Settings also shows controller connection or access problems. No right-stick calibration is needed; previously saved calibration settings are ignored. See [compatibility](docs/COMPATIBILITY.md#input-targets) for the supported layouts and verification limits.

## Server data

The default data directory is `server/data/`; override it with `SLOPERBERPUNK_DATA`. Relative overrides are resolved from the server process's working directory. Saves use JSON files, so no database service is required.

Back up the entire directory after a clean shutdown or with a consistent filesystem snapshot. Keep `accounts/`, `characters/`, `social.json`, and `signing-key.json` together. The signing key is private and identifies the server that issued signed character exports. Players can download an export from Settings. See [operations](docs/OPERATIONS.md) for recovery and restoration.

### Reset player data

Stop the server with Ctrl-C, SIGTERM on Unix, or its service manager, and wait for it to exit. Disable automatic restarts and back up the data directory elsewhere before continuing.

**This deletes all accounts, characters, progress, and community/economy records, and resets the First Signal signup count.** From the repository root, run:

```sh
rm -rf -- server/data/accounts server/data/characters server/data/social.json
```

If `SLOPERBERPUNK_DATA` is set, substitute that directory in all three paths. Remove all three together: `social.json` also contains character recovery records, auction escrow, and pending deliveries.

This preserves the signing identity. Removing the entire data directory also resets that identity; old exports still require the old public key for verification. Restart with the same configuration to recreate empty storage. Players must register again.

## Development

| Path | Contents |
| --- | --- |
| `client/src/` | Rendering, input, gameplay, UI, audio, and networking |
| `client/data/` | Editable world, quests, rules, dialogue, and item definitions |
| `client/assets/` | SVG artwork and model recipes |
| `client/tests/` | JavaScript tests |
| `server/src/` | Rust service, simulation, persistence, and tests |
| `docs/` | Architecture, content formats, operations, and device guides |

From the repository root, run the client tests with Node.js 22 or later and check Rust formatting:

```sh
node --experimental-default-type=module --test client/tests/*.test.mjs
rustfmt --edition 2024 --check server/src/main.rs
git diff --check
```

These checks do not create build or test output files. Run `cargo test` for the Rust tests when build outputs and temporary test fixtures are permitted. Source checks do not establish Rust compilation or live multiplayer behavior.

A `Cargo.lock` is not checked in. Resolve dependencies and retain the workspace lockfile before a reproducible binary release.

Further documentation:

- [Architecture](docs/ARCHITECTURE.md): networking, server authority, persistence, and scaling limits.
- [Content formats](docs/FORMATS.md): editable assets, map data, and save schemas.
- [Operations](docs/OPERATIONS.md): configuration, backups, deployment, and validation.
- [Compatibility](docs/COMPATIBILITY.md): browser, audio, touch, and controller requirements.
- [Steam Deck](docs/STEAM_DECK.md): browser setup and controls.

## License

The source and original content are offered under [GPL-3.0-or-later](LICENSE), to the extent licensable, without warranty. See [asset provenance](docs/PROVENANCE.md) and [third-party notices](docs/THIRD_PARTY.md) for authorship and dependency details.
