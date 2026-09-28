# Accounts, plans and file formats: a plan

A plan, partly built (see the milestones in section 8). Written 27 Sep 2026
from a voice note. Section 7 lists the decisions to settle before building.

## 1. The idea

Shader Studio is not open source and has a **Free** and a **Pro** plan. Both
need an account, but the account holds almost nothing: it exists so the app
can know you've paid, and so you can see your purchases. There is no cloud
profile. Your graphs, presentations and settings stay on your machine (or in
your workspace folder), as they do now.

- **Sign up** (email) → you get a licence. It's Free until you buy Pro.
- **Activate** a device by signing in once. After that the desktop app works
  **offline**, signed out or not, for as long as the activation is valid.
- **Up to 5 activations** per licence. You can free one from your account page
  (an old laptop, say) or buy more.
- **Shared passwords are fine.** The activation limit is the only guard, by
  design.

## 2. What the account server stores (and nothing else)

- The account: email, and a password hash or magic-link sign-in.
- Purchases and the licence: plan, date, receipts.
- Activations: a device name, a random device id and when it was activated.

No graphs, no usage data, no analytics. The app sends nothing about what you
make.

**Keep the server as small as possible: use a licensing service instead of
writing one.**

- **Lemon Squeezy** or **Paddle** act as *merchant of record*: they take the
  payment and handle sales tax and VAT worldwide, send receipts, and issue
  licence keys with an **activation limit** built in (activate, validate and
  deactivate through their API).
- **Keygen** is the alternative if payments go through Stripe instead: licences,
  machine activations and offline licence files.

With either, there's no database to run. The only code of ours on a server is
a tiny sign-in page. Even that can be the provider's hosted checkout plus a
customer portal.

## 3. How the app checks a licence (offline-first)

1. **Activating** (online, once per device): the app sends the licence key and
   a device id to the provider, and gets back a **signed licence token**
   (plan, licence id, device id, issued/expiry dates). The token is signed
   with the vendor's private key; the app ships the matching public key.
2. **Every launch**: the app checks the token's signature locally. No network
   is needed, so it works fully offline.
3. **Refresh**: when online, the app quietly refreshes the token about every
   7 days. If it can't reach the server, Pro keeps working for 30 days after
   the last good check, then drops to Free with the reason shown (see
   decisions 7–8 in section 7).
4. **Deactivate** from the app (Settings → This device) or from the account page.

Honest limit: in an app that runs on your machine, a determined person can
patch the checks out. The point is to make paying the easy path, not to win
an arms race. That matches "not something crazy".

## 4. Free vs Pro

| Area | Free | Pro |
|---|---|---|
| Studio (nodes, graph, groups, History, Rebuild) | ✓ | ✓ |
| Play | Controls and mappings only: **mouse, keyboard, live audio**. No layers, no other sources (MIDI, OSC, hands, LFOs, triggers…) | Everything: layers, all sources, triggers, takes, backgrounds |
| Output window and projection mapping (`play.output`, `play.projection`; see `projection.md`) | – | ✓ |
| Convert (GLSL → nodes) | – | ✓ |
| Record / export video | Up to **720p and 1080p** | Also **2K and 4K**, frame-by-frame renders of takes |
| Files | Save, open, organise, delete; **import node packs** others share | Also **Download everything / Install a profile**, selective ZIPs |
| Present | *to decide* | ✓ |
| GLSL page, Builder, Learn, examples | *to decide* (suggestion: Free) | ✓ |
| Website export ("Put it on a website") | *to decide* | ✓ |

**Locked features stay visible:** they show a small Pro badge and one short
"Pro" sheet explaining what unlocks, instead of disappearing. Files made on
Pro still open on Free. What Free can't run is shown but disabled, such as a
layer greyed out with "needs Pro", and nothing is ever deleted.

## 5. One Playfield file format

Today there are several: `.present.json`, play files, library ZIPs, graph JSON,
`.glsl`. The plan is one container, **`.playfile`** (built: its spec is
[playfile-format.md](playfile-format.md); it was called `.playfield` here at
first):

- A ZIP with a `manifest.json`: kind (graph, play, presentation, node pack,
  GLSL, background, profile), format version, app version, author, and
  signatures. The typed payloads sit inside, and a single file can carry
  several kinds, such as a presentation bundled with its graphs, GLSL files
  and images.
- The app opens any `.playfile` and says what's inside before importing, the
  same way the Files page's Install works today.
- **Node packs** (`kind: nodes`) can be **signed** by their author, so you know
  who made them, and optionally **sealed**:
  - their GLSL and settings are minified and encrypted at rest, so the source
    isn't readable in a text editor;
  - the pack opens and runs as nodes, but its code isn't shown in the code panel.

  Honest limit: a shader has to reach the GPU as source text, so a determined
  person with debugging tools can still recover it. Sealing stops casual
  copying, not a determined reverse engineer.
- Human-readable JSON stays available: an "Export as readable JSON" option for
  your own files, and the workspace folder stays readable.

## 6. Sharing and hosting

- **No hosted links to Plays or files.** You share by sending the file (the
  `.playfile` bundle). Nothing is stored on a server.
- **The app moves off GitHub Pages** to its own domain. GitHub Pages can hold the
  landing page.
- **Later: a community site** (separate from the app) hosting **presentations**
  as lessons. Each one can bundle downloadable files (graphs, GLSL,
  `.playfile` packs) that open in Shader Studio. A marketplace for node packs
  could follow. Both are out of scope for the first version.

## 7. Decisions (27 Sep 2026)

1. **Payments and licences: Lemon Squeezy** (merchant of record, licence keys,
   activation limits).
2. **Price:** a **one-time purchase of $128**, or a **subscription of $8 a
   month**. Both unlock the same Pro.
3. **Free:** Studio, **Present**, the **GLSL page**, the **Function Builder**,
   Learn and the examples. Play is limited (controls with mouse, keyboard and
   audio mappings, no layers). Video export goes up to 1080p.
4. **Pro only:**
   - all of Play;
   - Convert;
   - 2K and 4K export;
   - **website export**;
   - Download everything and Install a profile;
   - **turning Custom Functions, Expression Blocks and groups into published
     nodes**, and **making node packs**.
5. **File formats:**
   - Graphs, groups, presentations, GLSL and the rest can still be exported as
     readable JSON, and anyone can share or sell those.
   - **Nodes are only exported as `.playfile` node packs**: signed, and
     optionally sealed. Importing packs works on Free.
6. **Sealed packs:** signature plus encryption at rest, and a little beyond
   "good enough"; see section 9 for how far protection can go.
7. **Buying and signing in are separate.** Licences are sold on a separate
   store website, not on the app's own domain. In the app you **sign in with
   your account** and Pro unlocks. There's no key to paste. The only server
   involved is the one that checks licences.
   - Lemon Squeezy has no "sign in with Lemon Squeezy" for other apps, so this
     needs a tiny service of ours, for example a Cloudflare Worker with a
     key-value store. A Lemon Squeezy webhook records email → licence. Sign-in
     is an emailed one-time code or link, so there are no passwords to store.
     The service then issues the signed licence token from section 3.
8. **Periodic checks, offline-friendly.**
   - When online, the app re-verifies about **every 7 days**.
   - Offline, Pro keeps working for **30 days** after the last good check.
   - If a check fails, the app **drops to Free** and says why: "couldn't reach
     the licence server for 30 days", "subscription ended on …", "licence
     refunded", or "this device was deactivated". It offers **Check again** and
     **Sign in**.
   - Nothing is lost when that happens. Files stay, and Pro-only things (Play
     layers, sealed packs) still open to view but can't be edited or exported
     until Pro is back.
9. **An activation is a physical device, not an app.** The browser version and
   the desktop app on the same Mac count as **one** activation, verified once.
   A phone signing in is another activation. A browser can't read a hardware
   id, so the two are matched like this:
   - **Desktop first:** the desktop app activates with a device id from the
     machine, kept in the keychain.
   - **Linking the browser on that machine:** when you sign in on the web on a
     computer where the desktop app is installed, the browser offers "Link to
     Playfield on this Mac". That opens a `playfield://link?code=…` link, the
     already-activated desktop app confirms the code with the licence service,
     and the browser session joins that device's activation. It uses no new
     slot and needs no second check.
   - **Browser only** (no desktop app, or a phone): the browser gets its own
     device id stored in the browser and uses one slot. If site data is
     cleared, the service tries to recognise the device by its browser, OS and
     rough network (the same account, the same browser and OS, and the same
     network within a short window), so it doesn't burn a new slot. The
     account page lists devices with "last seen", so freeing one is one click.
   - Each device then follows the weekly check with the 30-day grace.
10. **Encrypt the Pro code: yes.**
   - **Desktop:** the build ships the Pro-only parts encrypted: Play layers and
     the full Play sources, Convert, the 2K/4K and website exporters, node
     publishing and pack sealing. The Rust side decrypts them only while the
     licence token is valid (layers 2 and 3 in section 9).
   - **Browser:** the web app never downloads Pro code until you've signed in,
     so it simply isn't there to patch.
   - This means the Pro features have to be split into their own
     separately-loaded code chunks. That's part of the feature-gates milestone.
11. **No trial; discount codes instead.** Lemon Squeezy discount codes cover
   this with no code of ours:
   - a percentage or a fixed amount off;
   - on subscriptions, for **once**, **N months** or **forever**. For example,
     "$1 a month for the first 3 months" is $7 off, repeating for 3 months;
   - an optional expiry date, a maximum number of uses, and limited to the
     monthly plan, the one-time plan, or both.
   - Codes are made in the Lemon Squeezy dashboard and typed in at checkout on
     the store site.
   - A share link can put the code in the checkout URL so it's applied
     automatically.
   - **In the app:** the licence service can serve a small "current offer" note,
     such as "Pro is $1/month for 3 months, until 31 Oct" with a link to the
     store. The Pro sheet and Settings → Plan show it when there is one. It's
     optional and off unless an offer is set.

## 9. How far protection can go

The layers, cheapest first. Each raises the effort a cracker needs; none
makes it impossible for software that runs on the buyer's machine.

1. **Signed licence tokens** (the plan above): someone can't forge a licence,
   but they can patch the check out of the app.
2. **The check in Rust, not JavaScript (desktop):** the Tauri side verifies the
   token and hands the web side only a yes or no plus a per-licence key. Patching
   a compiled, signed and notarized binary is much harder than editing
   JavaScript in the developer tools.
3. **Encrypted Pro code:** the Pro-only parts of the app (Play layers, Convert,
   the exporters, pack sealing) ship encrypted and are decrypted by the Rust
   side with a key it releases only for a valid licence. Flipping a flag
   doesn't unlock anything; the Pro code simply isn't readable without a
   licence. This is the biggest practical step up.
4. **Obfuscating the web bundle and integrity checks** (the app refuses to run
   if its files were modified): modest, and easy to overdo.
5. **Periodic online checks** (decided: every 7 days, with a 30-day offline
   grace): stronger against shared licences while keeping "works offline".
6. **The `.playfile` envelope** (shipped: container v2,
   [playfile-format.md](playfile-format.md), "Container v2"): a `.playfile` is
   no longer a ZIP any archive tool opens; it's encrypted (AES-256-GCM, a key
   per file from an app-embedded secret and the file's salt) and a changed file
   is refused. This is obscurity, like sealing: it stops casual opening,
   extraction and importing elsewhere, not someone who reads the app's code for
   the secret. The step up, when it's wanted, is a licence-bound key released
   by the Rust side (layers 2 and 3 above) for files meant for one buyer, with
   the shared secret kept for files meant for anyone.

Suggested: 1 + 2 + 3 for the desktop app. The browser version signs in and
checks online each session, and gets its Pro code from the server only after
sign-in.

## 10. Protecting the work itself (not legal advice)

- **The repository is public today** (github.com/Gabe-flomo/shader-studio,
  with no licence file). Anyone can read and copy the source right now.
  Making it **private** is the single most important step. Note: GitHub Pages
  from a private repository needs a paid GitHub plan, or the app moves to its
  own host, which was planned anyway.
- **Copyright** is automatic from the moment the code is written; no filing is
  needed to own it. **Registering** with the US Copyright Office (online,
  around $45–65 per work) is what lets you sue for statutory damages and
  attorney's fees. It's worth doing for the app's code before launch.
- **Add a proprietary licence** (a `LICENSE` file stating "All rights
  reserved" and an end-user licence agreement shown at sign-up), plus a
  copyright notice in the app's About screen and the site footer.
- **Trademark the name** you ship under (the USPTO charges roughly $250–350 per
  class). Search first: "Shader Studio" and "Playfield" are common words and may
  already be taken for software.
- **Ideas can't be protected by copyright**, only the code and assets. A
  patent is the only thing that covers an idea, and it's rarely worth the cost
  for an app like this. Being first, good and cared for is the real moat.
- A short consultation with a software or IP lawyer before launch is
  worthwhile for the licence agreement and the trademark search.

## 8. Milestones

1. **Licence layer:** the licence service (Lemon Squeezy webhook, email
   sign-in, token signing), the signed token, the Rust-side check, 7-day
   re-verification with the 30-day grace, the "dropped to Free because …"
   notice, activation and deactivation, and a Settings → Plan screen with a
   link to the store.
2. **Feature gates:** a single `can(feature)` check with Pro badges, the Pro
   sheet, the video-resolution cap, locked Play sources and layers, and Convert.
   Pro features move into their own lazily-loaded code chunks. The desktop
   build encrypts those chunks, and Rust decrypts them for a valid licence.
   The web app serves them only after sign-in.
3. **The `.playfile` container: done** ([playfile-format.md](playfile-format.md)).
   The manifest, the one reader and writer with their checks, open anything
   (Import, Install, drop on the window, the desktop file association), the
   preview with keep both / replace, bundles that bring what a graph or
   presentation uses, and `.playfile` offered at every download next to the
   readable format. The old formats still open. Not yet: reading a file passed
   on the command line on Windows and Linux.
4. **Node packs: done** (same doc). Signed with a per-author Ed25519 key
   (keychain on desktop, IndexedDB in a browser), trusted authors, optional
   sealing (AES-256-GCM at rest, source hidden in the app); making packs is Pro,
   importing them Free. The seal's key is derived inside the app, so it stops
   casual copying only (section 9); moving that secret to the Rust side waits
   for the encrypted Pro code of milestone 2.
5. **Hosting:** own domain for the app, the landing page on GitHub Pages.
   (The community site comes later.)
