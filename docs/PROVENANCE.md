# Sloperberpunk asset provenance and licensing

The game-specific content in this repository is created for Sloperberpunk, using editable source files and procedural rendering. This approach avoids a dependency on extracted game assets, film footage, licensed music, or commercial asset packs. It supports a reasoned originality assessment; it does **not** establish that every possible intellectual-property claim has been cleared.

## License scope and source forms

The project's original authored code and content are offered under **GPL-3.0-or-later**, to the extent the contributors hold rights that can be licensed. This includes the client, server, rules, world data, dialogue, geometry definitions, icons, sound recipes, and cinematic instructions. Third-party dependencies and the GPL license document retain their own notices. Player account records and personal character data are runtime data, not a claim of authorship over users' information.

The editable JavaScript, Rust, GLSL, HTML, CSS, SVG, JSON, and documentation are the preferred forms for making changes. Keep these files, their license notices, and the corresponding build instructions with distributions. The GPL can cover artwork and other non-software works when their editable source is identified; distributing compiled versions requires compliance with the applicable corresponding-source provisions. See the [GNU GPL FAQ on non-software works](https://www.gnu.org/licenses/gpl-faq.en.html#GPLOtherThanSoftware) and [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.html).

## Content inventory

| Category | Editable source and origin | External content used |
| --- | --- | --- |
| Sloperberpunk branding and interface | Project-specific lettering treatment, CSS, and SVG symbols; the name was supplied by the user | Browser/OS system fonts; no downloaded font files |
| Vesper and surrounding wasteland | Plaintext map data and procedural low-poly building, terrain, prop, and character geometry | No imported meshes, textures, or asset packs |
| Materials and lighting | Project-authored shader and color definitions | WebGL browser implementation only |
| Races, factions, quests, and dialogue | Original JSON/text content for Vesper, Relay, Glass Covenant, Ash Foundry, and Null Choir | No franchise dialogue, quest text, character biographies, or fictional locations copied into the content |
| Combat and abilities | Editable rule data and implementation for futuristic weapons and transhuman abilities | Genre concepts; no commercial game's code or rule text imported |
| Music and effects | Source-defined Web Audio synthesis and sequencing | No sampled recordings or downloaded soundtrack |
| Opening cinematic | Editable in-engine camera, timing, text, and scene instructions | No film clips or externally sourced video; this is a rendered cinematic, not an encoded movie file |
| Optional narration | Original dialogue passed to an installed local speech-synthesis voice | Browser/OS voice implementation; no voice model, actor recording, or cloned voice bundled |

The implementation is AI-assisted. “Project-authored” identifies where this content was produced; it does not assert that every element has sufficient human authorship to qualify for copyright. External software dependencies are separate from this game-asset inventory and must retain their applicable licenses and notices.

## Why the design reduces IP exposure

Cyberpunk cities, transhumanism, factions, level gates, cooldowns, and dice-based outcomes are broad ideas or systems. U.S. copyright protects qualifying expression rather than ideas and methods themselves. That distinction supports creating a new setting and implementation inspired by a genre, while avoiding another work's dialogue, characters, artwork, distinctive symbols, music, and code. It does not make copying expressive details acceptable. See the [U.S. Copyright Office's Circular 33](https://www.copyright.gov/circs/circ33.pdf).

The Matrix and World of Warcraft were references in the requested design direction. They are not content suppliers or affiliated projects. Sloperberpunk uses its own setting, factions, lore, visual geometry, interface treatment, and audio recipes. No franchise logo or claim of endorsement is intended. Keeping the content in readable source makes its construction inspectable and makes accidental similarities easier to replace.

## Limits of this assessment

**No exhaustive trademark, patent, or similarity clearance has been performed.** A newly coined or user-supplied name can still conflict with an existing mark. In particular, “Sloperberpunk” and the setting's names are not certified available for registration or commercial use. Trademark clearance considers similar marks and related goods, including common-law use, rather than an exact-name web search alone. See the [USPTO's clearance-search guidance](https://www.uspto.gov/trademarks/search/comprehensive-clearance-search-similar-trademarks).

AI assistance does not guarantee ownership or freedom from claims. The U.S. Copyright Office explains that copyrightability depends on sufficient human control over expressive elements; prompting alone is insufficient. The GPL notice grants only rights that exist and can be granted, and does not manufacture copyright in otherwise unprotectable material. See the [Copyright Office's report announcement on AI output copyrightability](https://www.copyright.gov/newsnet/2025/1060.html).

This document records the production approach and its limits, using U.S. official sources as a reference. It is not an international clearance opinion or a promise of legally “unencumbered” IP. For a public commercial launch, review the final name, logo, dependency notices, and shipped content in the intended markets, and update this inventory whenever external content is introduced.
