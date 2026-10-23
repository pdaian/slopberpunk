# Sloperberpunk browser and device compatibility

Sloperberpunk targets current Chrome and Firefox on desktop and Android through browser APIs. These are compatibility targets, not a claim that every browser, GPU, operating system, or USB controller has passed hardware testing. This document records the required behavior and the platform limits; it is not a hardware test report.

## Rendering and delivery

The renderer should request `webgl2` first, then fall back to `webgl` if creation returns `null`. Both paths need compatible shader sources and buffer handling; obtaining a context alone does not validate rendering. If both fail, report the unavailable renderer clearly. WebGL availability also depends on the GPU, driver, browser policy, and hardware-acceleration settings. See [MDN's canvas context reference](https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/getContext) and [WebGL overview](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API).

Serve the client over HTTP on localhost for development, and HTTPS for access from other devices. Opening the HTML directly as `file://` is not the supported loading path for modules and fetched world data. A phone accessing a development server through a plain HTTP LAN address is not equivalent to localhost on that phone. Gamepad access is among the [browser features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts).

## Input targets

| Environment | Intended input | Conditions and limits |
| --- | --- | --- |
| Desktop Chrome / Firefox | Mouse and keyboard; standard mapped gamepad | Active game window, functioning GPU, and browser permission policies |
| Steam Deck / SteamOS browser | Steam Input standard gamepad; trackpad mouse; touch | Native Linux browser shortcut, HTTPS or Deck-local localhost, browser controller access; see the [Steam Deck setup guide](STEAM_DECK.md). Hardware acceptance remains outstanding. |
| Android Chrome / Firefox | Touch controls; compatible USB gamepad; keyboard where exposed by the OS | Device USB host support, suitable cable/adapter, OS driver recognition, and browser mapping |
| Embedded preview / iframe | Browser-exposed input | Host restrictions can block gamepads; test the standalone page as well |

The mouse stays free. Left-click selects a character or object; right-click selects and acts, while holding and dragging the right button rotates the camera. Dragging must not activate a target on release. Click empty space or press Escape to clear the selection. Touch taps select and touch drags look; Tab / controller Y / TARGET cycles visible targets, and E / controller X / ACT acts on the selection. Clear held input and gestures on focus loss or cancellation. No Pointer Lock permission is required.

Controllers use `navigator.getGamepads()`, not direct WebUSB access. A USB plug does not establish a usable button mapping. The browser exposes standard mappings as `mapping === "standard"`; unrecognized controllers may expose different raw axis and button indices. Press a controller button after focusing the game, because browsers can withhold devices until interaction. Poll fresh state, handle null entries and disconnection, and clear held input on blur. These behaviors follow the [W3C Gamepad working draft](https://www.w3.org/TR/gamepad/).

If a detected controller's right stick does nothing or casts an ability (for example, shield when looking left), open **Settings → SET UP RIGHT STICK**. Hold only the right stick fully left, right, up, and down in turn, choosing **NEXT** after each direction; then release it and the triggers and choose **SAVE**. This learns alternate axes, inverted inputs, and analog or directional buttons used for camera movement. Inputs captured as look cannot also cast abilities or navigate menus. The mapping is saved per controller and browser when browser storage is available; **RESET RIGHT STICK** restores the default. After reconnecting, release the stick once before looking. This is a camera remap, not a full remapping of all controls or support for otherwise unrecognized controllers.

Firefox's Linux backend can label a controller standard based on its Linux button codes while assigning axes by their Linux codes. Its handling of trigger axes has also changed between releases; see [Mozilla's Linux gamepad implementation](https://github.com/mozilla-firefox/firefox/blob/main/dom/gamepad/linux/LinuxGamepad.cpp). Calibration uses the browser's observed inputs instead of assuming a layout from the controller's product name. Automated tests simulate the right-stick/shield conflict; physical Firefox/Debian/Backbone testing remains outstanding.

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
