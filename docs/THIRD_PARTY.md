# Dependencies and system components

The game-specific code, geometry, symbols, dialogue, rules, and synthesized audio sources are original to this project and offered under GPL-3.0-or-later to the extent licensable. The complete GPL text in `LICENSE` is the Free Software Foundation's license document, reproduced unmodified.

The browser client has no third-party JavaScript package, hosted font, texture pack, mesh library, sampled audio, or bundled external media dependency. It uses browser WebGL, Web Audio, Gamepad, Pointer Lock, and Speech Synthesis implementations and installed system fonts for semantic layout and Unicode fallback. The visible terminal uses original editable pixel glyphs in `client/src/pixel-font.js`. Those implementations and browser-provided speech voices retain their providers' terms; they are not redistributed as project-authored assets. Narration prefers local English voices but can use browser-managed online voices or the browser default, so speech is not guaranteed offline. No separate cloud speech SDK or service credentials are included.

The Rust manifest pins seven runtime dependencies:

| Crate | Version | Upstream license |
| --- | --- | --- |
| [argon2](https://docs.rs/argon2/0.5.3/argon2/) | 0.5.3 | MIT or Apache-2.0 |
| [axum](https://docs.rs/axum/0.8.9/axum/) | 0.8.9 | MIT |
| [getrandom](https://docs.rs/getrandom/0.3.4/getrandom/) | 0.3.4 | MIT or Apache-2.0 |
| [ed25519-dalek](https://docs.rs/ed25519-dalek/2.2.0/ed25519_dalek/) | 2.2.0 | BSD-3-Clause |
| [serde](https://docs.rs/serde/1.0.228/serde/) | 1.0.228 | MIT or Apache-2.0 |
| [serde_json](https://docs.rs/serde_json/1.0.149/serde_json/) | 1.0.149 | MIT or Apache-2.0 |
| [tokio](https://docs.rs/tokio/1.49.0/tokio/) | 1.49.0 | MIT |

HTTP regression tests additionally use [tower 0.5.3](https://docs.rs/tower/0.5.3/tower/) (MIT) as a development dependency.

Dependencies are referenced by the manifest; their source has not been copied into this repository. Compiled distributions must retain the resolved direct and transitive crates' required notices and provide corresponding source as applicable to the GPL-covered combined work. Generate and retain a Cargo lockfile and audit the resolved transitive license inventory when preparing a binary release. This table is the direct-dependency inventory, not an assertion that the unbuilt transitive graph has been fully audited.

Copyright notices for dependencies remain upstream notices. The game's GPL notice does not reassign their authorship or replace their own licenses. The discussion of original game assets and naming is in [PROVENANCE.md](PROVENANCE.md).
