# Hand tracking

*Play can follow your hands with the camera: fingertips move nulls, a pinch turns a knob, a fist fires a burst. Everything runs on your computer.*

---

## Turning it on

A setup that reads hands shows **Enable hand tracking** on the picture, and a **Hands** status in the mappings drawer, on a hand trigger and on a null that follows a hand:

| Status | Means |
|---|---|
| Hands: off | Not running. **Enable** opens the camera (the browser asks the first time) and starts the tracker. |
| Hands: starting… | The model is loading (the first time in a session, about a second). |
| Hands: tracking 2 hands | Running; the number is the hands shown (a hand still appearing, or one ignored, doesn't count). Hover it for the frame rate and timings. |
| Hands: none in view | Running, nobody's hands in the picture. |
| Hands: camera blocked | The browser or macOS refused the camera. Allow it and press **Try again**. |

Browsers only open the camera after a click, which is why there is a button. The camera is the same one a Camera layer shows: one stream, shared. Tracking works with no Camera layer, or with it hidden.

The **eye** beside the status shows or hides the hand on the picture in one click. Tracking keeps going while it's hidden: sources, gestures and nulls carry on.

The sliders button holds the settings, saved with the setup (`PlayRecord.hands`; the newer ones are written only once changed, so older files read back as they were):

- **Show hand on picture**: the skeleton and landmark dots, in a colour you pick (also in a Camera layer's Hand tracking section). It has its own switch, apart from the guides: **H hides the other guides and leaves the hand to this switch**, so you can hide the hand all the time and show it only for a moment. Web pages still show it only with their markers on.
- **Hands to track: 1 or 2** (MediaPipe's `numHands`, default 2). With 1 a second hand can never appear, and Distance between the hands reads nothing. The default stays 2 even when a setup reads only one hand: with 1, MediaPipe follows whichever hand it finds first and keeps it, so a right-hand setup would go dead while your left hand is the one it latched onto. The setting says when a setup reads only one hand and suggests 1 if you keep the other out of view.
- **Strictness**: MediaPipe's three confidence thresholds together, from lenient to strict. The default (0.5) is a notch stricter than MediaPipe's own 0.5s: detection 0.6, presence 0.57, tracking 0.55 (0 is 0.3 each; 1 is 0.9, 0.84, 0.8). **Advanced** sets the three by hand (Finding, Keeping and Following a hand); **Use Strictness again** goes back.
- **Smoothing** and **Responsiveness**: a one-euro filter on every landmark. Smoothing sets how calm a still hand is (its cutoff: 0 passes landmarks straight through, 0.5 is 1.6 Hz, 1 is 0.3 Hz); Responsiveness how much a fast move opens the filter up (its beta: 0 is a plain low-pass that lags, 0.5 follows a quick move within a frame or two), so a still hand is calm and a fast one doesn't trail.
- **Mirror, like a selfie**: your right hand moves right on the picture. With a Camera layer, that layer's own Mirror decides, so the dots sit on your hands in its image. Mirror moves the dots; it never changes which hand is which.
- **Swap left and right**: for a camera that already sends a mirrored picture (some virtual cameras do), where Right would otherwise be your left hand.
- **What the tracker sees**: while tracking, the frame rate and model time, how many hands MediaPipe found and how many were ignored, each hand followed (its number, its side, what the model said this frame and how sure it was, whether it is still appearing or held), and the thresholds in use. Handy when a hand misbehaves.

## Where a hand is on the picture

Landmarks are placed where the camera image is: under a Camera layer, exactly where that layer shows it (its position, scale, rotation and mirror); with none, the camera covers the picture so a hand can reach every edge. X and Y are 0 to 1 across the picture with Y up, the same as nulls and the mouse.

**Left and right mean the performer's own hands.** MediaPipe Tasks labels a hand as it is in the image it's given, and camera frames reach it unmirrored, so its "Right" is your right hand and is used as it is; mirroring the picture (the Camera layer's Mirror, or the selfie default) moves the dots but never the labels. (Checked with a photo of a right hand: MediaPipe says Right, and Left once the photo is flipped. The older MediaPipe Hands docs describe the opposite, for selfie images; following them was why early builds had the hands the wrong way round.)

## Steady hands

MediaPipe looks at each frame on its own, so its left/right label can flip for a frame, and a shadow or a face can pass for a hand for a frame or two. The tracker (`hdUpdate` in `play/kit/hands.js`) smooths that out:

- **Believable hands only**: a detection smaller than 6% of the frame's height, or whose palm is off the frame, is ignored.
- **Tracks**: each hand is followed from frame to frame by where its palm is (the nearest within a gate that grows with the hand's size; the model's label breaks a near tie). A hand keeps its side while the model wavers. The side changes only after the model has said the other side, at 80% or surer, for 0.7 s; if both hands say they're the other one, they swap together.
- **Appearing**: a new hand counts once it's been seen 3 frames running (about 0.1 s), so a phantom for a frame or two never appears, and never fires Comes into view or Leaves view. If both hands are already shown, a newcomer waits.
- **Two hands, one side**: if the model calls both hands Right, the one already shown keeps Right and the newcomer is Left.
- **Holding**: a hand that drops out is held for 250 ms (below).

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

**On: Proximity** can measure from a point on a hand: pick **Right hand**, **Left hand** or **Either hand** in From or To, then the point (Index tip, Thumb tip, the palm…). A fingertip coming close to a shape then fires like a key press; the example **Hands: touch a shape** steps a line of text each time you touch a circle. **Layer sensor → Distance** reads the same distance as a source.

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

A null's **Follows** can be **A hand**: pick the hand and the point (a fingertip, the wrist…). It chases that landmark on its Spring and Wobble like any following null, and waits where it was when the hand leaves. Until it has seen its hand (and while tracking is off) it rests where it was placed, so you can drag it. Everything that reads nulls reads it unchanged: particle roles (emitter, absorber, attract, repel, vortex), sensors (distance to another layer or a hand point), Script layers' `s.null()`, Cloner effectors, brushes, lenses and mappings.

## Hand paths (shapes made from nulls)

A Shape's **Shape** can be **Path**: its corners are nulls, in order, so a path through nulls that follow your fingertips is a shape that moves with your hands. Put a null on both thumb and index tips and the four points are a quad you hold between your hands; three make a triangle; two make a line (or a circle that grows as you spread them). Since it is a shape, everything a shape does works: fill, outline, **Trim**, blend, **Invert**, a track matte for another layer, particle zones, Fill and Hover readings, triggers.

**Add hand path** (Add layer → Drawing, or the Camera layer's Hand tracking section) makes one in a step: the fingertip nulls it needs (both hands' index and thumb tips; ones already there are reused) and a filled path through them with Hull on, and starts tracking. The **Hand paths** example in the Play folder is a window through ASCII framed by four fingertips, strung with a web.

On the path's card:

- **Points**: the nulls, in order, each with what it follows (*Right hand · Index tip*, *Follows the mouse*…). Reorder with the arrows, remove with × (the null stays), add any null (or **+ New null**), or press **Fingertips** for the four fingertip nulls.
- **Style**: **Fill** (a polygon through the points), **Smooth** (a closed centripetal Catmull-Rom curve through them: round, never looping between close points), **Circle**, **Lines** (a line through them in order, left open) or **Web** (every pair joined). Lines and webs are drawn with the Outline colour and width.
- **Hull** (Fill, Smooth): go round the outermost points, so crossing fingers never twist the shape into a bow-tie. Off: list order.
- **Centre** (Circle): **Middle** centres it between the points, its radius their mean distance from there; **First point** centres it on point 1 and the others set the radius (with two points, the second: pinch to shrink it).
- **Reach** (Web): join only points closer than this (picture heights), links fading as they stretch toward it; 0 joins all at full strength.
- **Hand lost**: when a hand a point follows is out of view (while tracking runs), **Drop** its corners (four become a triangle, then a line), **Hold** them where they were last seen, or **Fade** the whole shape out until the hand is back (0.35 s).

**Readings**: a path reads its **Area** (the share of the picture it covers; lines and webs: the area their points span), **Perimeter** (its outline's length, a web's links added up; 1 is the length of the picture's own edge) and **Spread** (the points' mean distance from their centre; 1 is half a picture height or more), with Fill, Hover and Distance like any shape. With Fade they fade with the shape. Map them from the card's Readings or Mappings → Layer sensor.

**As a zone**: Fill, Smooth and Circle are closed regions (walls, containers, attract, sensors…); Lines and Web are walls as thick as their outline. Its anchor (proximity, distance) is its points' centre.

**Without a camera**: a hand null that has never seen its hand rests where it was placed, and you can drag it there, so a setup made for hands still shows its shape. Once tracking runs, a hand out of view is lost (Hand lost decides). A path has no box of its own: select it on the picture by pressing inside it; move it by moving its nulls.

**Where it lives**: the geometry is in the kit (`play/kit/geometry.js`: `geoPathBuild`, `geoHull`, `geoCatmullRom`, `geoPathNodes`, `geoPathFade`, `geoPathReadings`), built each frame in `kit.js` after the nulls' springs (so it works the same in exported websites), drawn by `klDrawShape` in `layers.js`. Saved on the Shape: `shape: 'path'`, `pointIds`, `pathStyle`, `hull`, `webReach`, `circleMode`, `onLost`; files from before have the defaults.

## Recording

Takes record hands like everything else: controls driven by hand sources and gesture envelopes are control tracks, following nulls are null tracks, and actions a gesture fired are events. Playing a take back rests the tracker (the take has every value, and a hand waved meanwhile changes nothing); rendering a take frame by frame reproduces it exactly. The skeleton overlay is a live guide and isn't part of a rendered take.

## How it works

- **Model**: MediaPipe's Hand Landmarker (`@mediapipe/tasks-vision`, the float16 `hand_landmarker.task`, 7.8 MB, from Google's MediaPipe model storage), up to two hands of 21 landmarks each.
- **Files**: the model is in `public/mediapipe/`; MediaPipe's WebAssembly is served from the npm package at `<base>mediapipe/wasm/` (`vite.config.ts` serves it in dev and copies it into a build). The app never fetches anything from the internet for hand tracking.
- **Loading**: nothing loads until hands are first enabled. `lib/handFeed.ts` (status, the newest frame) is tiny and in the main bundle; it imports `lib/handTracker.ts` on demand, which starts `lib/handWorker.ts` in a module worker holding MediaPipe.
- **Frames**: about 30 a second, never more than one in flight, the camera frame scaled to 480 px wide as an ImageBitmap and handed to the worker. The model runs there, GPU first (WebGL2 on an OffscreenCanvas), falling back to the CPU. The render loop never waits on it.
- **Meaning**: `play/kit/hands.js` turns landmarks into hands on the picture (plausibility, tracks and steady sides, placement, mirroring, one-euro smoothing, the hold), readings and gestures. The same file runs in web exports, with the setup's settings (the page's tracker takes Hands to track and the thresholds when it starts).
- **Settings reach the model live**: the engine hands `hdTrackerOptions(settings)` to `handFeed.configure`, which passes a change to the running worker (`HandLandmarker.setOptions`).
- **Engine**: `lib/playEngine.ts` takes in each new frame once per tick, reads hand sources, turns gestures into presses on the trigger hub (so envelopes, toggles and actions work as they do for keys), and feeds Learn. The overlay (`play/overlay.ts`) hands the kit the points nulls follow and the skeleton.

Measured on this machine in the browser preview (Chrome, GPU delegate): 30 frames a second, the model about 19 ms a frame in the worker, 24 ms from camera frame to landmarks.

## Privacy

Everything happens on your device. Camera frames go from the camera to a worker in the same page and come back as 21 points per hand; they are never uploaded, stored or sent anywhere, and the model and its runtime are part of the app. A take stores the values hands produced (a number per control per frame), never images.

## On a website

A page exported with **Put it on a website** leaves hand tracking out unless you tick **Include hand tracking (+12.2 MB)**: MediaPipe, its WebAssembly and the model, gzipped, travel inside the page, so it too tracks offline on the visitor's device. The player gets an **Enable hands** button; a background has none, but the host page can call `ShaderStudioPlay.enableHands()` from its own button. Without the files, the dialog lists hand tracking under what the page leaves behind, and hand mappings, gestures and hand-following nulls stay at rest there. Unpacking needs `DecompressionStream` (Chrome 80+, Safari 16.4+, Firefox 113+).

## Desktop app

The macOS app declares `NSCameraUsageDescription` (`src-tauri/Info.plist`, merged by the Tauri CLI) and, for signed builds, the camera entitlement (`src-tauri/Entitlements.plist`). macOS asks once; after that it's in System Settings → Privacy & Security → Camera. The packaged app has to be rebuilt to pick them up.
