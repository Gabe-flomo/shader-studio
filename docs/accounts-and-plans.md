# Accounts, plans and file formats: a plan

Plan, not built. Written 27 Sep 2026 from a voice note. Section 7 lists the
decisions to settle before building.

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
3. **Refresh**: when online, the app quietly refreshes the token, say every 30
   days. If it can't reach the server for a long time (for example 90 days
   offline), Pro keeps working through a grace period and then asks to go
   online once.
4. **Deactivate** from the app (Settings → This device) or from the account page.

Honest limit: in an app that runs on your machine, a determined person can
patch the checks out. The point is to make paying the easy path, not to win
an arms race. That matches "not something crazy".

## 4. Free vs Pro

| Area | Free | Pro |
|---|---|---|
| Studio (nodes, graph, groups, History, Rebuild) | ✓ | ✓ |
| Play | Controls and mappings only: **mouse, keyboard, live audio**. No layers, no other sources (MIDI, OSC, hands, LFOs, triggers…) | Everything: layers, all sources, triggers, takes, backgrounds |
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
`.glsl`. The plan is one container, **`.playfield`**:

- A ZIP with a `manifest.json`: kind (graph, play, presentation, node pack,
  GLSL, background, profile), format version, app version, author, and
  signatures. The typed payloads sit inside, and a single file can carry
  several kinds, such as a presentation bundled with its graphs, GLSL files
  and images.
- The app opens any `.playfield` and says what's inside before importing, the
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
  `.playfield` bundle). Nothing is stored on a server.
- **The app moves off GitHub Pages** to its own domain. GitHub Pages can hold the
  landing page.
- **Later: a community site** (separate from the app) hosting **presentations**
  as lessons. Each one can bundle downloadable files (graphs, GLSL,
  `.playfield` packs) that open in Shader Studio. A marketplace for node packs
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
   - **Nodes are only exported as `.playfield` node packs**: signed, and
     optionally sealed. Importing packs works on Free.
6. **Sealed packs:** signature plus encryption at rest, and a little beyond
   "good enough"; see section 9 for how far protection can go.
7. **Still open:** does the browser version count as an activation or sign in
   each session? A trial for Pro?

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
5. **Periodic online checks** (say every 7–30 days): stronger against shared
   licences, but it weakens "works offline". The plan keeps a long grace
   period.

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

1. **Licence layer:** provider integration, the signed token, offline check,
   activation and deactivation, the account page link, a Settings → Plan
   screen.
2. **Feature gates:** a single `can(feature)` check with Pro badges, the Pro
   sheet, the video-resolution cap, locked Play sources and layers, and Convert.
3. **The `.playfield` container:** manifest, open-anything, bundles, and
   migration of the old formats (they still open).
4. **Node packs:** export with signing and optional sealing; import on Free.
5. **Hosting:** own domain for the app, the landing page on GitHub Pages.
   (The community site comes later.)
