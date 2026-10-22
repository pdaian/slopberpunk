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
| Embedded preview / iframe | Browser-exposed input | Host restrictions can block pointer lock or gamepads; test the standalone page as well |

Mouse capture requires a user interaction and the browser's Pointer Lock API. Handle denial and release without trapping the user. Escape should allow the pointer to be released. Do not assume that `requestPointerLock()` returns a promise in every implementation; pointer-lock events are needed for compatibility. A sandboxed iframe also needs `allow-pointer-lock`. See [MDN's pointer-lock documentation](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestPointerLock).

Controllers use `navigator.getGamepads()`, not direct WebUSB access. A USB plug does not establish a usable button mapping. The browser exposes standard mappings as `mapping === "standard"`; unrecognized controllers may expose different raw axis and button indices. Press a controller button after focusing the game, because browsers can withhold devices until interaction. Poll fresh state, handle null entries and disconnection, and clear held input on blur. These behaviors follow the [W3C Gamepad working draft](https://www.w3.org/TR/gamepad/).

Standard-layout assumptions must be checked on each target controller. Do not advertise arbitrary controllers as supported unless remapping or device-specific bindings have been implemented and verified. Android USB-controller support remains conditional on the device, OS, browser, and controller combination; no USB transport or driver is bundled with this browser client.

## Audio, narration, and the opening cinematic

Start or resume synthesized audio after a click, tap, or other supported user gesture, and preserve a mute option. The opening is an in-engine cinematic driven by readable scene instructions, so it does not require a downloaded video or video codec. It is not a separately encoded movie asset.

Optional narration uses the browser's `SpeechSynthesis` interface with an explicitly selected voice whose `localService` is `true`. The default voice can be remote, so an unset `utterance.voice` is not a local-only fallback. Voice discovery can initially return an empty list; handle `voiceschanged`. If no local voice is available, leave dialogue visible as text and disable narration rather than selecting a remote service. These distinctions are defined by the [Web Speech API specification](https://webaudio.github.io/web-speech-api/#speechsynthesisvoice).

Local speech is a wrapper around installed browser/OS synthesis. **No neural text-to-speech model or portable offline voice is bundled.** Voice quality and available languages depend on the installed engine. The browser's `localService` declaration is the selection criterion; this project does not independently audit the OS voice provider. The game does not need a microphone for narration.

Character narration starts enabled and can be muted with **VOICES** or Settings. Only local English voices are selected for the English script. Speaker profiles assign different pitch, rate, and voice slots; devices with fewer installed voices share the underlying voice while retaining each character's pitch and pacing. Captioned guidance remains available without speech support. Late voice discovery respects dismissed lines and the mute setting. Browser autoplay rules may require a click or replay before speech starts; live voice quality and browser/device acceptance require listening tests.

## Verification status and acceptance checks

No physical Steam Deck, Android, USB-controller, or cross-browser hardware test results are asserted here. Automated syntax, data, or browser smoke checks should be reported separately with their actual environment and result. A successful desktop preview does not validate SteamOS, Firefox, Android, controller mapping, local voice availability, or a particular frame rate.

Before calling a device combination supported, record browser and OS versions, GPU, controller model, and connection type, then check:

1. WebGL2 renders correctly; forced WebGL1 renders the same playable world; unavailable WebGL produces a useful error.
2. Create an account and character, play or skip the introduction, enter the city, and reload the character successfully.
3. Movement, camera look, targeting, abilities, menus, and dialogue work with the applicable keyboard, touch, and controller bindings. Disconnecting a controller or changing tabs does not leave movement stuck.
4. Resize and rotate the viewport; confirm legible controls, usable menus, and acceptable frame timing on the actual device.
5. Narration selects only a local voice, falls back to text when none exists, and does not continue over dismissed dialogue. Muting audio remains effective.
6. Verify the standalone HTTPS page and any intended embedded host separately, including input-policy denials and network reconnection.
