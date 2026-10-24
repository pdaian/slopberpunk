# Sloperberpunk browser and device compatibility

Sloperberpunk targets current Chrome and Firefox on desktop and Android through browser APIs. These are compatibility targets, not a claim that every browser, GPU, operating system, or USB controller has passed hardware testing. This document records the required behavior and the platform limits; it is not a hardware test report.

## Rendering and delivery

The renderer should request `webgl2` first, then fall back to `webgl` if creation returns `null`. Both paths need compatible shader sources and buffer handling; obtaining a context alone does not validate rendering. If both fail, report the unavailable renderer clearly. WebGL availability also depends on the GPU, driver, browser policy, and hardware-acceleration settings. See [MDN's canvas context reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext) and [WebGL overview](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API).

Serve the client over HTTP on localhost for development, and HTTPS for access from other devices. Opening the HTML directly as `file://` is not the supported loading path for modules and fetched world data. A phone accessing a development server through a plain HTTP LAN address is not equivalent to localhost on that phone. Gamepad access is among the [browser features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts).

## Input targets

| Environment | Intended input | Conditions and limits |
| --- | --- | --- |
| Desktop Chrome / Firefox | Mouse and keyboard; standard mapped gamepad; native Backbone One on Linux | Active game window, functioning GPU, and browser permission policies; automatic layouts below |
| Steam Deck / SteamOS browser | Steam Input standard gamepad; trackpad mouse; touch | Native Linux browser shortcut, HTTPS or Deck-local localhost, browser controller access; see the [Steam Deck setup guide](STEAM_DECK.md). Hardware acceptance remains outstanding. |
| Android Chrome / Firefox | Touch controls; compatible USB gamepad; keyboard where exposed by the OS | Device USB host support, suitable cable/adapter, OS driver recognition, and browser mapping |
| Embedded preview / iframe | Browser-exposed input | Host restrictions can block gamepads; test the standalone page as well |

The mouse stays free. Left-click selects a character or object; right-click selects and acts, while holding and dragging the right button rotates the camera. Dragging must not activate a target on release. Click empty space or press Escape to clear the selection. Touch taps select and touch drags look; Tab / controller Y / TARGET cycles visible targets, and E / controller X / ACT acts on the selection. Clear held input and gestures on focus loss or cancellation. No Pointer Lock permission is required.

Tab cycles targets while the game world has focus. On interface controls, Tab and Shift+Tab navigate, and Enter or Space activate buttons without also triggering gameplay. Escape opens or closes menus; Shift+Tab is never captured by gameplay. Panel headings identify each menu, and closing a panel restores focus. Tooltips also appear on keyboard focus and can be dismissed with Escape. Touch action buttons activate on release, and losing joystick capture clears movement.

Browser high-contrast settings that enable `forced-colors` switch menus and the HUD to native HTML controls. The world still requires WebGL. The interface follows changes to this preference during play. Reduced motion, read at startup, also keeps each opening cinematic shot still while retaining its captions and narration. These behaviors have in-memory regression coverage for input, focus, validation, and presentation switching; physical-device and assistive-technology acceptance testing remains outstanding.

Controllers use `navigator.getGamepads()`, not direct WebUSB access. A USB plug does not establish a usable button mapping. The browser exposes standard mappings as `mapping === "standard"`; unrecognized controllers may expose different raw axis and button indices. Press a controller button after focusing the game, because browsers can withhold devices until interaction. Poll fresh state, handle null entries and disconnection, and clear held input on blur. These behaviors follow the [W3C Gamepad working draft](https://www.w3.org/TR/gamepad/).

`client/src/controllers.js` normalizes supported browser layouts before gameplay and menus read them. No calibration or saved remapping is used. The Backbone exception matches USB vendor `358a`, products `0102`, `0202`, `0203`, and `0204`, the desktop Linux backend, and the expected eight-axis layout. A correctly mapped standard controller keeps its browser mapping, including Backbone through Steam Input. Unknown raw layouts are reported as unsupported in Settings instead of silently assigning arbitrary buttons.

| Browser layout | Right stick | Actual LT / RT | Other controls |
| --- | --- | --- | --- |
| Standard mapping | Axes 2 / 3 | Buttons 6 / 7 | Standard button indices |
| Chrome on Linux, raw Backbone | Axes 2 / 3 | Axes 5 / 4 | Explicit face/shoulder/menu/stick button mapping; D-pad axes 6 / 7 |
| Firefox on Linux, Backbone before 151 | Extra axes 4 / 5 | Extra axes 7 / 6 | Correct reversed X/Y face-button positions; other buttons use standard indices |
| Firefox on Linux, Backbone from 151 | Analog values of buttons 6 / 7, converted from 0…1 to −1…1 | Extra axes 7 / 6 replace the erroneous trigger aliases | Correct reversed X/Y face-button positions; other buttons use standard indices |

The raw Backbone layout follows the Linux entries in the [SDL controller database](https://github.com/mdqinc/SDL_GameControllerDB/blob/master/gamecontrollerdb.txt), interpreted through [Chromium's joydev implementation](https://github.com/chromium/chromium/blob/main/device/gamepad/gamepad_device_linux.cc). Firefox reserves axes 2/3 for Linux `ABS_RX/RY`, while Backbone uses `ABS_Z/RZ` for its right stick. Compare the [Firefox ESR 140 backend](https://github.com/mozilla-firefox/firefox/blob/esr140/dom/gamepad/linux/LinuxGamepad.cpp) with the [current Firefox backend](https://github.com/mozilla-firefox/firefox/blob/main/dom/gamepad/linux/LinuxGamepad.cpp) and the [trigger conversion introduced in Firefox 151](https://bugzilla.mozilla.org/show_bug.cgi?id=2029254). The latter delivers those stick values as analog trigger buttons; the client decodes them for look and reads the real triggers separately. Initial zero button reports are ignored per stick axis until that axis supplies a nonzero value, avoiding camera rotation from uninitialized browser state.

The right stick turns continuously with a dead zone and elapsed frame time. **Settings → Camera turn speed** also applies to controller look. In menus, the left stick or D-pad navigates, left/right adjusts a focused slider, A activates a visible control, and B returns. Gameplay actions fire on new presses; analog trigger hysteresis avoids repeated casts from threshold jitter. Focus loss and hidden pages stop movement, look, and menu activation; returning does not replay button presses made while away. Disconnection and changes to the controller slot or layout clear the corresponding input history. Settings distinguishes a connected controller, an unsupported layout, missing browser support, and blocked access.

Automated in-memory tests exercise standard Chrome/Firefox input, the raw Chrome/Linux Backbone layout, both Firefox/Linux Backbone variants, independent triggers and look, menu transitions, focus loss, reconnection, and multiple controllers. These fixtures derive from the linked implementations; physical Chrome/Firefox/Debian/Backbone testing remains outstanding.

Standard-layout assumptions must be checked on each target controller. Do not advertise arbitrary controllers as supported unless remapping or device-specific bindings have been implemented and verified. Android USB-controller support remains conditional on the device, OS, browser, and controller combination; no USB transport or driver is bundled with this browser client.

## Audio, narration, and the opening cinematic

Start or resume synthesized audio after a click, tap, or other supported user gesture, and preserve a mute option. The opening is an in-engine cinematic driven by readable scene instructions, so it does not require a downloaded video or video codec. It is not a separately encoded movie asset.

Narration uses the browser's `SpeechSynthesis` interface. It prefers explicitly selected local English voices, then other browser-provided English voices. An empty or unavailable voice list still gets an attempt using the browser default with `lang: en-US`. Browser-managed voices and the default may use an online speech service; narration is no longer restricted to offline voices. No microphone permission, application-managed speech API, or service credentials are required. See the [Web Speech voice specification](https://webaudio.github.io/web-speech-api/#speechsynthesisvoice).

Speech and Web Audio are unlocked separately in trusted click, touch-end, and keyboard handlers, before asynchronous account or character requests. Voice discovery uses `voiceschanged` (including the legacy event property) and bounded polling after a failed default attempt. Autoplay denial retains only the current line for a later gesture; it never starts an automatic retry loop. A controller-generated click may not grant browser activation, so click/tap the page or use a keyboard if prompted.

Character narration starts enabled and can be muted with **VOICES** or Settings. **Settings → TEST VOICE** and the dialogue/quest replay controls enable speech and request playback directly. Settings reports starting, playing, blocked, unavailable, or failed speech instead of treating a nonempty voice list as proof of playback. Speaker profiles retain distinct pitch, rate, and stable voice slots. Long dialogue is split into short utterances, with the full caption retained until playback ends. Native failures try another available voice or the English default, with at most three attempts per chunk. Missing start/end events time out. Muting, dismissal, hiding the page, or leaving a scene cancels speech and pending retries; late callbacks cannot restart an old line.

**No portable speech engine or recorded dialogue is bundled, so narration cannot be guaranteed in every browser.** Targets include current desktop Chrome, Edge, Firefox, and Safari, and mobile browsers that expose speech synthesis. Embedded webviews or browsers without that API need a different browser to hear narration. A browser/OS combination still needs a functioning English speech engine and permission to play audio. Captions and written dialogue remain available when speech is unsupported, blocked, or fails. Consult [MDN's SpeechSynthesis compatibility data](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis#browser_compatibility); real device and listening tests remain necessary.

## Verification status and acceptance checks

No physical Steam Deck, Android, USB-controller, or cross-browser hardware test results are asserted here. Automated syntax, data, or browser smoke checks should be reported separately with their actual environment and result. A successful desktop preview does not validate SteamOS, Firefox, Android, controller mapping, local voice availability, or a particular frame rate.

Before calling a device combination supported, record browser and OS versions, GPU, controller model, and connection type, then check:

1. WebGL2 renders correctly; forced WebGL1 renders the same playable world; unavailable WebGL produces a useful error.
2. Create an account and character, play or skip the introduction, enter the city, and reload the character successfully.
3. Movement, camera look, targeting, abilities, menus, and dialogue work with the applicable keyboard, touch, and controller bindings. Disconnecting a controller or changing tabs does not leave movement stuck.
4. Resize and rotate the viewport; confirm legible controls, usable menus, and acceptable frame timing on the actual device.
5. Use TEST VOICE and replay on each browser/OS combination, with music off and on. Check local and browser-managed voices, initially empty lists, autoplay denial/retry, long dialogue, background/foreground transitions, and absent speech support. Verify captions, useful failure status, and that mute/dismissal prevents delayed playback.
6. Verify the standalone HTTPS page and any intended embedded host separately, including input-policy denials and network reconnection.
