# Playing Sloperberpunk on Steam Deck

Run the existing browser client through a non-Steam shortcut. The Deck renders the game locally with WebGL, and the browser still handles site storage, account cookies, signed-character downloads, and web updates on reload. The shortcut needs no native game build or Proton. These instructions describe the intended setup; physical Steam Deck testing and performance measurements are still outstanding.

## Choose the game address

- **Hosted game:** use your deployment's HTTPS URL. This repository does not specify a public game server. For accounts, multiplayer, and community features, the host needs the Rust service and the HTTPS/HTTP/WebSocket configuration in [Operations](OPERATIONS.md). The Deck only needs a browser. A hosted client also supports local characters when the account service is unavailable, provided the client files can still load.
- **Game hosted on the Deck:** use `http://localhost:3000` with Node.js 22 or later and a copy of this repository on the Deck; see [Local and offline play](#local-and-offline-play) below. The Node server alone supports local characters.

`localhost` means the device running the browser. Starting the server on another PC does not make the Deck's `localhost:3000` reach that PC. Use HTTPS with a trusted certificate for a remote host: a plain HTTP LAN IP is not a secure context for browser gamepads and Web Crypto. Serve the game over HTTP(S), rather than opening `client/index.html` as a file. See [browser delivery requirements](COMPATIBILITY.md#rendering-and-delivery).

## Add the browser to Gaming Mode

1. Select **Steam → Power → Switch to Desktop**. In **Discover**, install **Google Chrome**. Open it once to finish browser setup, then open your chosen game URL and check that the title screen loads. Current Chrome is an existing project target; the commands below use its `com.google.Chrome` Flatpak package.
2. In desktop Steam, choose **Add a Game → Add a Non-Steam Game**, select Google Chrome, and add it. Open the shortcut's **Properties** and rename it **Sloperberpunk**. Leave forced compatibility tools disabled for this native Linux browser.
3. Keep Steam's generated **Target**, **Start In**, and existing **Launch Options**. Append the following to the end of Launch Options, after `@@u @@` if present:

   ```text
   --app="https://your-game-host.example/"
   ```

   Replace that example URL with your actual game address, or use `--app="http://localhost:3000"` for a server running on the Deck. `--app` opens the URL in a dedicated browser window using the browser's profile. To keep the address bar and tabs, append the quoted URL alone instead. Keep your existing profile; private/incognito mode or a different `--user-data-dir` would separate your saves.
4. Open the shortcut's **Controller Layout**, choose the **Gamepad with Mouse Trackpad** template, and apply it. Keep the sticks, face buttons, triggers, and D-pad mapped as gamepad inputs. Set the right trackpad to **Mouse** and its click to **Left Mouse Click** for forms and menus.
5. Fully quit Chrome before launching the shortcut so Steam starts the browser process. Select **Return to Gaming Mode**, open **Library → Non-Steam → Sloperberpunk**, and launch it. Tap/click the page and press a gamepad button to let the browser detect the controller. Choose **Enter Vesper** while signed out for a local character, or use **Account** to sign in to the connected server.

The desktop installation and shortcut steps follow [Valve's Desktop FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C). The [Chromium application-mode switch](https://chromium.googlesource.com/chromium/src/+/a771c0b220a3c12454cd814f0033f249355793af/chrome/common/chrome_switches.cc) supplies the dedicated window; it does not install an offline copy of the game.

If you already have local characters in Firefox on the Deck, keep that browser: add Firefox to Steam and open the same URL there. The `--app` flag and Chrome Flatpak ID in this guide apply only to Chrome; changing browsers does not transfer local saves.

If the sticks or buttons do nothing, first check that the page is focused, the URL is HTTPS or Deck-local localhost, and the Steam layout sends gamepad inputs. Open Settings using the on-screen menu button; a detected standard gamepad produces **Standard controller connected.** If Chrome's Flatpak still cannot see it, quit Chrome and run this in Desktop Mode's **Konsole**, then relaunch through Steam:

```sh
flatpak override --user --filesystem=/run/udev:ro com.google.Chrome
```

This grants that browser read-only access to device metadata. It adapts [Microsoft's Steam Deck browser-controller setup](https://support.microsoft.com/en-us/edge/xbox-cloud-gaming-in-microsoft-edge-with-steam-deck) to the [Chrome Flatpak package](https://github.com/flathub/com.google.Chrome/blob/master/com.google.Chrome.yaml); it is not a hardware verification result. The [Flatpak reference](https://docs.flatpak.org/en/latest/flatpak-command-reference.html#flatpak-override) describes the permission. Keep browser security and hardware acceleration enabled.

## Controls and browser features

The complete bindings are in the [README controls table](../README.md#controls). On the Deck, left/right stick move/look, **A/B** jump/dash, **X** interacts, **Y** cycles enemies, and left-stick press sprints. **Right-stick press (R3)** casts Ghostline after you have moved at least 12 m over 2 seconds; cross the cyan runner to braid. **R2/L1/R1/L2** use arc/surge/heal/shield; D-pad left/right use the remaining abilities and D-pad up uses a medkit. **View** opens the journal, D-pad down opens the map, and **Menu** opens Settings.

In menus, use the D-pad to focus controls and **A** to activate them, or use the trackpad/touchscreen. Keep the mouse option available for text fields, dropdowns, scrolling, and browser download dialogs. Focus a text field and press **Steam + X** for the on-screen keyboard. **Settings → Controls** lists the bindings; open Community from Settings and use the HUD buttons for talents and gear. Valve documents the keyboard and per-game layouts in its [input guide](https://help.steampowered.com/en/faqs/view/69E3-14AF-9764-4C28).

For mouse camera control, hold right mouse while moving or double-click the world to request pointer capture; Escape releases capture. The right gamepad stick does not need mouse capture. If browser gamepad access remains unavailable, a Steam Input keyboard/mouse layout can use the README bindings: left stick as WASD, right trackpad as mouse, and buttons for Space/Q/E/Tab and abilities. Provide a right-mouse binding for looking in that layout.

Start with **Settings → Render resolution → High**. If frame pacing is poor, try **Balanced**, then disable **Volumetric light** or use **Low** as needed. These are tuning options, not a measured frame-rate or battery-life promise. Use browser zoom if text is too small. Click/tap the page to unlock audio; narration depends on installed local voices, with dialogue text available when none are exposed. See [audio compatibility](COMPATIBILITY.md#audio-narration-and-the-opening-cinematic).

## Preserve saves and account access

- **Local characters:** keep the same browser profile and origin (scheme, host, and port) in both modes. For example, `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:8080`, and an HTTPS deployment have separate stores. Local characters and their signing identity live in browser storage; clearing site data or removing the profile deletes them. Private browsing discards its storage when that session ends. See [browser localStorage behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage).
- **Exports:** use **Settings → Export signed character** and confirm that `sloperberpunk-<id>.json` downloads. Use the same browser in Desktop Mode if the download UI is awkward in Gaming Mode. Local signing requires Web Crypto Ed25519 support. The current client has **no character-import UI**; an export is an archive, not an implemented restore or transfer workflow. Preserve the browser profile as well. Local characters cannot become authoritative server characters.
- **Across devices:** use **Account** on the same Rust server to resume a server character. Local saves are not synchronized by Steam Cloud or browser account sync. A Steam shortcut does not add either feature. Keep cookies/site storage allowed, and sign in again if the server session expires or the service restarts.
- **Before leaving or sleeping:** choose **Settings → Return to title**. This explicitly saves a local character and closes an online world connection. After resume, restore connectivity and use **Reconnect** if the game reports **Signal interrupted**, or reload and sign in again if necessary. Suspend does not pause the server's world or its real-time timers.

## Local and offline play

With Node.js 22 or later available on the Deck, open Konsole in the repository root and run:

```sh
node tools/serve.mjs
```

Open `http://localhost:3000` in Chrome. Keep the terminal/server running while playing in Desktop Mode. There are no npm dependencies or client build step, and local play needs no Rust account service.

For a local Gaming Mode shortcut, run the server independently of the Desktop terminal. Stop the foreground server with **Ctrl+C**, then, from the same repository directory, start a transient user service:

```sh
systemd-run --user --unit=sloperberpunk-web --collect --service-type=exec \
  --working-directory="$PWD" "$(command -v node)" tools/serve.mjs
```

The [systemd-run service](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html) runs in the background without a permanent service file. Check that `http://localhost:3000` loads before switching modes. It is not enabled at boot; rerun the command after a reboot or if the user service has stopped. Diagnose it with `systemctl --user status sloperberpunk-web` in Desktop Mode. After returning to the game's title screen, stop it when finished:

```sh
systemctl --user stop sloperberpunk-web
```

With the browser, Node runtime, and repository already on the Deck, that local URL can load without internet access. The client has no service worker or offline installation flow, and the frontend server sends `Cache-Control: no-store`. Visiting a remote site once or adding the Steam shortcut does not make later offline launches work. Accounts, multiplayer, and community features require a reachable Rust service; the Node server alone does not provide them. Add `/play.html` to the shortcut URL to open the game directly, skipping the landing page.

## Verify on the actual Deck

Record SteamOS and browser versions and the Steam Input layout. Follow the [device acceptance checks](COMPATIBILITY.md#verification-status-and-acceptance-checks), including movement, combat, menus, text entry, and legibility. Also check that a local character survives closing/reopening the shortcut and switching modes at the same origin, that an export downloads, and that an online character can reconnect after suspend. For local hosting, verify the server survives the mode switch and the page reloads with Wi-Fi off. Report those results separately from automated repository checks; Steam Deck compatibility and a specific frame rate have not been certified.
