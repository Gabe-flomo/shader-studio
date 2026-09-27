# Hand tracking

*Play can follow your hands with the camera: fingertips move nulls, a pinch turns a knob, a fist fires a burst. Everything runs on your computer.*

---

## Turning it on

A setup that reads hands shows **Enable hand tracking** on the picture, and a **Hands** status in the mappings drawer, on a hand trigger and on a null that follows a hand:

| Status | Means |
|---|---|
| Hands: off | Not running. **Enable** opens the camera (the browser asks the first time) and starts the tracker. |
| Hands: starting… | The model is loading (the first time in a session, about a second). |
| Hands: tracking 2 hands | Running; the number is the hands in view. Hover it for the frame rate and timings. |
| Hands: none in view | Running, nobody's hands in the picture. |
| Hands: camera blocked | The browser or macOS refused the camera. Allow it and press **Try again**. |

Browsers only open the camera after a click, which is why there is a button. The camera is the same one a Camera layer shows: one stream, shared. Tracking works with no Camera layer, or with it hidden.

The sliders button beside the status holds the settings, saved with the setup (`PlayRecord.hands`):

- **Smoothing**: low follows every twitch, high is steady but a little late (a one-euro filter).
- **Show hands on the picture**: the skeleton and landmark dots, in a colour you pick. They are a guide: H hides them with the other guides.
- **Mirror, like a selfie**: your right hand moves right on the picture. With a Camera layer, that layer's own Mirror decides, so the dots sit on your hands in its image.

## Where a hand is on the picture

Landmarks are placed where the camera image is: under a Camera layer, exactly where that layer shows it (its position, scale, rotation and mirror); with none, the camera covers the picture so a hand can reach every edge. X and Y are 0 to 1 across the picture with Y up, the same as nulls and the mouse.

**Left and right mean the performer's own hands.** MediaPipe labels hands as if the image were a mirrored selfie; the tracker undoes that, so "Right" is always your right hand, mirrored view or not.

## Sources (the Hands group in the source list)

| Source | Reads |
|---|---|
| Fingertip or joint (X, Y, Z) | Any of the 21 landmarks: wrist, thumb base, knuckle, joint and tip, and each finger's knuckle, middle joint, top joint and tip. Z is 0.5 level with the wrist and rises toward the camera. Shown as "Right · Index tip · X". |
| Pinch | Thumb tip to the index, middle, ring or pinky tip: 0 touching, 1 spread wide. Measured against the hand's own size, so it reads the same near and far. |
| Openness | 0 a fist, 1 an open hand. |
| Palm centre | X or Y of the middle of the palm. |
| Roll | The hand's turn: 0.5 fingers up, higher leaning right. |
| Nearness | How big the hand looks: 0 far, 1 close to the camera. |
| Hand in view | 1 while the hand is in the picture. |
| Gesture held | 1 while a gesture is held: a gate. |
| Distance between the hands | Palm to palm, 1 = a picture width apart. Reads only while both hands are in view. |

Each picks **Right**, **Left** or **Either** (your right hand while it is in view, else your left). While a hand is out of view its readings are empty, so the controls they drive stay where they were instead of jumping. A hand that drops out for a frame or two is held for 250 ms, so a missed detection never flickers a value.

**Learn** works with hands: press Learn and move one finger; the landmark and axis that moved furthest becomes the source.

## Gestures

**On: Hand gesture** is a trigger like a key: it plays an envelope, a toggle, a step or a random value in a Trigger mapping, and fires actions (burst, next line, drop…) and action buttons.

| Gesture | Is |
|---|---|
| Pinch, Middle pinch, Ring pinch, Pinky pinch | The thumb tip against that fingertip. Only the nearest fingertip starts a pinch, and not while the hand is a fist. |
| Fist | All four fingers curled in (a thumbs-up counts). |
| Open palm | Every finger and the thumb stretched out. |
| Point | Index finger out, the middle finger curled, ring and pinky mostly curled (a V sign isn't pointing). |
| Comes into view | Fires when the hand appears; held while it stays. |
| Leaves view | Fires when the hand goes; held while it is away (only after it was seen once). |

Every gesture has **hysteresis**: it starts past one threshold and ends only past a looser one (a pinch starts at 0.28 palm lengths and ends at 0.42), so holding a fist fires once, however much it wobbles, and fires again only after you let go. Learn on a trigger row takes the next gesture you make (one already held has to be let go first).

## Nulls that follow a hand

A null's **Follows** can be **A hand**: pick the hand and the point (a fingertip, the wrist…). It chases that landmark on its Spring and Wobble like any following null, and waits where it was when the hand leaves. Everything that reads nulls reads it unchanged: particle roles (emitter, absorber, attract, repel, vortex), sensors (distance between nulls), Script layers' `s.null()`, Cloner effectors, brushes, lenses and mappings.

## Recording

Takes record hands like everything else: controls driven by hand sources and gesture envelopes are control tracks, following nulls are null tracks, and actions a gesture fired are events. Playing a take back rests the tracker (the take has every value, and a hand waved meanwhile changes nothing); rendering a take frame by frame reproduces it exactly. The skeleton overlay is a live guide and isn't part of a rendered take.

## How it works

- **Model**: MediaPipe's Hand Landmarker (`@mediapipe/tasks-vision`, the float16 `hand_landmarker.task`, 7.8 MB, from Google's MediaPipe model storage), up to two hands of 21 landmarks each.
- **Files**: the model is in `public/mediapipe/`; MediaPipe's WebAssembly is served from the npm package at `<base>mediapipe/wasm/` (`vite.config.ts` serves it in dev and copies it into a build). The app never fetches anything from the internet for hand tracking.
- **Loading**: nothing loads until hands are first enabled. `lib/handFeed.ts` (status, the newest frame) is tiny and in the main bundle; it imports `lib/handTracker.ts` on demand, which starts `lib/handWorker.ts` in a module worker holding MediaPipe.
- **Frames**: about 30 a second, never more than one in flight, the camera frame scaled to 480 px wide as an ImageBitmap and handed to the worker. The model runs there, GPU first (WebGL2 on an OffscreenCanvas), falling back to the CPU. The render loop never waits on it.
- **Meaning**: `play/kit/hands.js` turns landmarks into hands on the picture (placement, mirroring, one-euro smoothing, the hold), readings and gestures. The same file runs in web exports.
- **Engine**: `lib/playEngine.ts` takes in each new frame once per tick, reads hand sources, turns gestures into presses on the trigger hub (so envelopes, toggles and actions work as they do for keys), and feeds Learn. The overlay (`play/overlay.ts`) hands the kit the points nulls follow and the skeleton.

Measured on this machine in the browser preview (Chrome, GPU delegate): 30 frames a second, the model about 19 ms a frame in the worker, 24 ms from camera frame to landmarks.

## Privacy

Everything happens on your device. Camera frames go from the camera to a worker in the same page and come back as 21 points per hand; they are never uploaded, stored or sent anywhere, and the model and its runtime are part of the app. A take stores the values hands produced (a number per control per frame), never images.

## On a website

A page exported with **Put it on a website** leaves hand tracking out unless you tick **Include hand tracking (+12.2 MB)**: MediaPipe, its WebAssembly and the model, gzipped, travel inside the page, so it too tracks offline on the visitor's device. The player gets an **Enable hands** button; a background has none, but the host page can call `ShaderStudioPlay.enableHands()` from its own button. Without the files, the dialog lists hand tracking under what the page leaves behind, and hand mappings, gestures and hand-following nulls stay at rest there. Unpacking needs `DecompressionStream` (Chrome 80+, Safari 16.4+, Firefox 113+).

## Desktop app

The macOS app declares `NSCameraUsageDescription` (`src-tauri/Info.plist`, merged by the Tauri CLI) and, for signed builds, the camera entitlement (`src-tauri/Entitlements.plist`). macOS asks once; after that it's in System Settings → Privacy & Security → Camera. The packaged app has to be rebuilt to pick them up.
