# Playing Sloperberpunk on Steam Deck

Run the existing browser client through a non-Steam shortcut. The Deck renders the game locally with WebGL, and the browser still handles account cookies, signed-character downloads, and web updates on reload. The shortcut needs no native game build or Proton. These instructions describe the intended setup; physical Steam Deck testing and performance measurements are still outstanding.

## Choose the game address

- **Hosted game:** use your deployment's HTTPS URL. This repository does not specify a public game server. For accounts, multiplayer, and community features, the host needs the Rust service and the HTTPS/HTTP/WebSocket configuration in [Operations](OPERATIONS.md). The Deck only needs a browser. Playing requires a connection to that server.
- **Game hosted on the Deck:** use `http://localhost:8080` with Rust 1.89 or later and a copy of this repository; see [Host the Rust server on the Deck](#host-the-rust-server-on-the-deck) below. This runs the same account-backed game and multiplayer service.

`localhost` means the device running the browser. Starting the server on another PC does not make the Deck's `localhost:8080` reach that PC. Use HTTPS with a trusted certificate for a remote host: a plain HTTP LAN IP is not a secure context for browser gamepads. Serve the game over HTTP(S), rather than opening `client/index.html` as a file. See [browser delivery requirements](COMPATIBILITY.md#rendering-and-delivery).

## Add the browser to Gaming Mode

1. Select **Steam → Power → Switch to Desktop**. In **Discover**, install **Google Chrome**. Open it once to finish browser setup, then open your chosen game URL and check that the title screen loads. Current Chrome is an existing project target; the commands below use its `com.google.Chrome` Flatpak package.
2. In desktop Steam, choose **Add a Game → Add a Non-Steam Game**, select Google Chrome, and add it. Open the shortcut's **Properties** and rename it **Sloperberpunk**. Leave forced compatibility tools disabled for this native Linux browser.
3. Keep Steam's generated **Target**, **Start In**, and existing **Launch Options**. Append the following to the end of Launch Options, after `@@u @@` if present:

   ```text
   --app="https://your-game-host.example/"
   ```

   Replace that example URL with your actual game address, or use `--app="http://localhost:8080"` for a server running on the Deck. `--app` opens the URL in a dedicated browser window using the browser's profile. To keep the address bar and tabs, append the quoted URL alone instead. Keep cookies enabled; changing profiles requires signing in again to the same server.
4. Open the shortcut's **Controller Layout**, choose the **Gamepad with Mouse Trackpad** template, and apply it. Keep the sticks, face buttons, triggers, and D-pad mapped as gamepad inputs. Set the right trackpad to **Mouse** and its click to **Left Mouse Click** for forms and menus.
5. Fully quit Chrome before launching the shortcut so Steam starts the browser process. Select **Return to Gaming Mode**, open **Library → Non-Steam → Sloperberpunk**, and launch it. Tap/click the page and press a gamepad button to let the browser detect the controller. Choose **Enter Vesper** or **Account** to register or sign in, then create or resume a server character.

The desktop installation and shortcut steps follow [Valve's Desktop FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C). The [Chromium application-mode switch](https://chromium.googlesource.com/chromium/src/+/a771c0b220a3c12454cd814f0033f249355793af/chrome/common/chrome_switches.cc) supplies the dedicated window; it does not install an offline copy of the game.

Firefox can also be added as a Steam shortcut. The `--app` flag and Chrome Flatpak ID in this guide apply only to Chrome. Sign in to the same server to access your characters in either browser.

If the sticks or buttons do nothing, first check that the page is focused, the URL is HTTPS or Deck-local localhost, and the Steam layout sends gamepad inputs. Open Settings using the on-screen menu button; a recognized gamepad produces **Controller connected.** The status also reports blocked access or an unsupported layout. If Chrome's Flatpak still cannot see it, quit Chrome and run this in Desktop Mode's **Konsole**, then relaunch through Steam:

```sh
flatpak override --user --filesystem=/run/udev:ro com.google.Chrome
```

This grants that browser read-only access to device metadata. It adapts [Microsoft's Steam Deck browser-controller setup](https://support.microsoft.com/en-us/edge/xbox-cloud-gaming-in-microsoft-edge-with-steam-deck) to the [Chrome Flatpak package](https://github.com/flathub/com.google.Chrome/blob/master/com.google.Chrome.yaml); it is not a hardware verification result. The [Flatpak reference](https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-override) describes the permission. Keep browser security and hardware acceleration enabled.

## Controls and browser features

The complete bindings are in the [README controls table](../README.md#controls). On the Deck, left/right stick move/look, **A/B** jump/dash, **Y** cycles visible characters and objects, **X** acts on the selected target, and left-stick press sprints. **R2/L1/R1/L2** use arc/surge/heal/shield; D-pad left/right use the remaining abilities and D-pad up uses a medkit. **View** opens the journal, D-pad down opens the map, and **Menu** opens Settings.

In menus, use the D-pad to focus controls and **A** to activate them, or use the trackpad/touchscreen. Keep the mouse option available for text fields, dropdowns, scrolling, and browser download dialogs. Focus a text field and press **Steam + X** for the on-screen keyboard. **Settings → Controls** lists the bindings; open Community from Settings and use the HUD buttons for talents and gear. Valve documents the keyboard and per-game layouts in its [input guide](https://help.steampowered.com/en/faqs/view/69E3-14AF-9764-4C28).

Click a character or object to target it, then press E / X to act; right-click selects and acts. For mouse camera control, hold and drag the right mouse button. The cursor stays free; double-clicking never locks it. Click empty space or press Escape to clear the target. If browser gamepad access remains unavailable, a Steam Input keyboard/mouse layout can use the README bindings: left stick as WASD, right trackpad as mouse, and buttons for Space/Q/E/Tab and abilities. Provide a right-mouse binding for looking in that layout.

Start with **Settings → Render resolution → High**. If frame pacing is poor, try **Balanced**, then disable **Volumetric light** or use **Low** as needed. These are tuning options, not a measured frame-rate or battery-life promise. Use browser zoom if text is too small. Click/tap the page to unlock audio; narration prefers local English voices and can use other browser voices, which may need an internet connection. Use **Settings → TEST VOICE** to check playback; dialogue text remains available if speech fails. See [audio compatibility](COMPATIBILITY.md#audio-narration-and-the-opening-cinematic).

## Preserve saves and account access

- **Characters:** progress is stored by the Rust server. Sign in to the same server from Desktop Mode, Gaming Mode, or another device to resume it. Keep cookies allowed; sign in again after a session expires or the service restarts.
- **Exports:** use **Settings → Export signed character** and confirm that `sloperberpunk-<id>.json` downloads. The server signs this archive. The client has no character-import UI; exports are archives, not an implemented restore or transfer workflow. Server operators should back up the entire runtime database.
- **Before leaving or sleeping:** choose **Settings → Return to title** to close the world connection. After resume, restore connectivity and use **Reconnect** if the game reports **Signal interrupted**, or reload and sign in again. Suspend does not pause the server world or its timers.

## Host the Rust server on the Deck

With Rust 1.89 or later available, run from the repository root:

```sh
cargo run --release
```

Open `http://localhost:8080` in the browser. This one process serves the frontend, accounts, multiplayer, and community. The first run compiles the server; runtime progress lives in `server/data`. For Gaming Mode, keep the Rust process running through your user service manager across the mode switch. Use the same data directory when restarting, and shut down cleanly before backing it up. See [Operations](OPERATIONS.md) for listener configuration and storage recovery. Add `/play.html` to the shortcut URL to skip the landing page.

## Verify on the actual Deck

Record SteamOS and browser versions and the Steam Input layout. Follow the [device acceptance checks](COMPATIBILITY.md#verification-status-and-acceptance-checks), including movement, combat, menus, text entry, and legibility. Also check that a server character survives closing/reopening the shortcut and switching modes, that a signed export downloads, and that a character can reconnect after suspend. For Deck hosting, verify that the Rust server survives the mode switch. Report those results separately from automated repository checks; Steam Deck compatibility and a specific frame rate have not been certified.
