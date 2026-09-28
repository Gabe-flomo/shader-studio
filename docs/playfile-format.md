# The `.playfile` format

Playfield's one file format (milestones 3 and 4 of
[accounts-and-plans.md](accounts-and-plans.md)). A `.playfile` is a ZIP with a
`manifest.json` and one file per item, wrapped since **container v2** in an
encrypted envelope so that only Playfield opens it (see
[Container v2](#container-v2-the-envelope)). It carries a graph, a Play setup,
a presentation, a node pack, GLSL shaders, background images, presets or a
whole profile, or several of these at once. Every older format still opens
(v1 plain-ZIP files forever), and the readable formats are still offered next
to it wherever the app downloads something.

The code is in `src/playfile/`:

| File | What it does |
|---|---|
| `format.ts` | Types, versions, kinds, limits, safe paths |
| `container.ts` | The v2 envelope: header, HKDF key, AES-256-GCM, wrap and unwrap |
| `secret.ts` | The app-embedded secrets (container, sealing), with what they are and aren't worth |
| `writer.ts` | The one writer: items in, ZIP + manifest, wrapped in the envelope, signed if asked |
| `reader.ts` | The one reader: v2 unwrapped (or a v1 ZIP taken as is), then every check before anything is imported |
| `signing.ts` | Ed25519 keys, signatures, fingerprints, trusted authors |
| `sealing.ts` | Sealed node packs: AES-256-GCM at rest |
| `bundle.ts` | What an export puts in (items and their dependencies) |
| `importer.ts` | The import preview (rows, clashes) and the import itself |
| `app.ts` | Wiring to the app: storage, plan, file dialogs, the dialogs' state |

The dialogs (open/import preview, node pack export, the export format menu)
are in `src/components/playfile/`.

## Names

The extension is **`.playfile`** and the manifest says `format: "playfile"`.
While it was being built the format was briefly called `.playfield` and
`.play`, so files with `format: "playfield"` or `"play"` (and those extensions)
are read too.

## Layout

The ZIP inside the envelope (what a v1 file is, bare):

```
manifest.json                      what is inside (below)
README.txt                         a note for anyone who gets the ZIP out
graphs/<Name>.graph.json           a graph file, exactly what "Export as readable JSON" writes
plays/<Name>.play.json             a Play file (a graph with kind "shader-studio-play")
presentations/<Title>.present.json a presentation, pictures and fonts embedded
nodes/<Pack>.nodes.json            a node pack: { "version": 1, "nodes": [UserNodeDefinition…], "finishEffects"?: [custom Finish effects] }
glsl/<Name>.glsl                   a GLSL shader, plain text
backgrounds/<Name>.<png|jpg|…>     a background image, as the picture file
library/<Name>.library.json        a Library snapshot: presets, functions, scripts, palettes…
profile/<Name>.zip                 a whole profile ZIP (Files → Download everything)
videos/<Name>.<mp4|webm|wav…>      a Video layer's file or a drum pad's sample (meta: its library id and type)
```

Paths are unique inside the file (a clash gets ` (2)`); a name is made safe
for a path, but the item's real name is the manifest's `name`.

## The manifest

```json
{
  "format": "playfile",
  "version": 1,
  "appVersion": "0.1.0",
  "kinds": ["graph", "nodes"],
  "created": "2026-09-27T10:38:34.928Z",
  "author": { "name": "Ada", "publicKey": "<base64, 32 bytes>" },
  "items": [
    { "kind": "graph", "path": "graphs/Rings.graph.json", "name": "Rings", "bytes": 2416,
      "sha256": "d263…", "meta": { "detail": "v3 · 4 nodes" } },
    { "kind": "nodes", "path": "nodes/Wobble.nodes.json", "name": "Wobble", "bytes": 1022,
      "sha256": "9f1a…", "meta": { "dependency": true, "count": 1, "sealed": true, "labels": ["Wobble"] } }
  ],
  "signature": { "alg": "Ed25519", "value": "<base64, 64 bytes>" }
}
```

- `version` is the manifest's layout version (1). A reader refuses a newer one
  and says "made by a newer Playfield"; it reads every older one. The envelope
  around the ZIP has its own version byte (2); a v2 file's manifest still says
  `version: 1`, because the envelope changed, not the layout.
- `kinds` is a summary; `items` is what counts.
- `author` is optional. `name` is whatever the author typed; `publicKey` is
  there when the file is signed.
- `meta` is informational. `dependency: true` marks an item that came along
  because another item uses it (shown as "Used by another item").
- An item of a kind this version doesn't know is left out with a note; the
  rest of the file still opens.

## Kinds and what importing does

| Kind | Import | Clash (same name, different content) |
|---|---|---|
| `graph` | saved graph; opened in the Studio when it's the file's one graph | keep both (`Name (2)`) or replace (yours becomes an earlier version) |
| `play` | saved graph; opened on Play | the same |
| `presentation` | saved presentation, marked as imported (its Script layers run sandboxed); embedded pictures move into the backgrounds library | keep both or replace |
| `nodes` | each node type registered (sealed ones stay sealed); rows per node type. Custom Finish effects in its `finishEffects` go into Your effects (a row each, "Finish effect") | replace (updating a node you have, the default) or keep both (a new id and GLSL function name; an effect gets a new id and name) |
| `glsl` | added to the GLSL page's list, with its note and folder | keep both or replace the code |
| `background` | added to the backgrounds library | — (same name and size is "already here") |
| `library` | merged like Install's Merge: nothing of yours is overwritten, clashing presets come in as `Name (2)` | automatic |
| `profile` | Install's Merge (needs Pro: `files.install`) | automatic |
| `video` | added to the videos library under its id, so the Video layers (or drum pads: sounds are `video` items too) that name it find it | — (the same id is "already here") |

"Already here" (identical content) rows are shown but not ticked. Nothing in a
file runs on import: graphs and presentations are data, and node types are GLSL
for the compiler.

## Reading: the checks

`readPlayfile` checks everything before an item is shown:

- the file's size (256 MB) first of all, then, for a v2 file, the header: its
  version, the ciphertext length against the file's, the ZIP's declared size
  against the same 256 MB, all before anything is decrypted or inflated; the
  GCM tag refuses a changed or damaged file ("This file was modified or
  damaged"); a file that is neither a v2 container nor a ZIP is "Not a
  Playfield file";
- the number of entries (2000), each item's
  unpacked size (128 MB), the manifest's (1 MB) and the total unpacked
  (512 MB), both as the ZIP declares them and as they actually come out;
- every path: relative, `/`-separated, no `..`, `.`, empty parts, drive
  letters, backslashes or control characters. A manifest pointing outside the
  file refuses the whole file; a stray ZIP entry with such a name is ignored
  with a note;
- the manifest: its format, version, item fields, no path listed twice;
- each item's size and SHA-256 against the manifest (a mismatch leaves that
  item out and marks the file as modified);
- the signature.

Limits are in `DEFAULT_LIMITS` (`format.ts`); the desktop app's file reader
uses the same 256 MB cap.

## Signing

Each author has one **Ed25519** key pair, made on this device the first time
they export a node pack:

- the private key is a 32-byte seed: in the desktop app in the system keychain
  (service "Playfield signing key", `src-tauri/src/playfile.rs`, like the
  Kaggle key), in a browser in IndexedDB (`playfield-keys`), never in
  localStorage, a profile ZIP, a library export or the workspace folder;
- the public key and the author's display name go in the manifest's `author`;
- the signature is over `canonicalJson(manifest without "signature")`: the
  manifest's JSON with object keys sorted and no whitespace. It covers every
  item's path, size and SHA-256, and the author's name, so changing any item,
  or the name, breaks it. It's checked against the manifest exactly as it is
  in the file, so fields a newer version adds are covered too.

Ed25519 runs through WebCrypto where the browser has it (Chrome 137+, Safari
17+, Node 20+) and through `@noble/ed25519` otherwise; both give the same keys
and signatures.

Node packs are always signed. Other exports are signed when this device
already has a key (it isn't made just for them).

On import the preview says one of:

- **Signed by *name*** with the key's fingerprint (the first 16 hex digits of
  its SHA-256, in fours), and **Trusted** or **New author**. "Remember this
  author's key as trusted" keeps the key (Settings, `trustedAuthors`); if a
  trusted key comes back under another name, the preview says so.
- **Unsigned**: nothing says who made it or whether it changed.
- **Signature doesn't match: modified**: it was signed but changed afterwards.
  Its node types aren't ticked.

A signature says the file hasn't changed since the holder of that key made it.
It doesn't say who that is: the name is the author's own choice, and the key is
what identifies them. Imported node types remember who signed them (shown on
their card).

## Sealing

A node pack can be **sealed** (a checkbox when exporting one):

- each node type's GLSL (the function, minified, its iteration variants,
  minified, and its helpers) is encrypted with **AES-256-GCM** under a key
  derived with HKDF-SHA-256 from a secret inside the app and a random salt per
  node; its ports, params and name stay readable so the app can show the node;
- a sealed node never carries its source (the graph or GLSL it was built from);
- it stays encrypted everywhere it's stored: the pack, this browser's storage,
  profile ZIPs and the workspace folder. The code is filled back in only in
  memory, when the node registry loads, so the compiler gets real GLSL;
- in the app the code panel shows `// Sealed node pack: Name (its code isn't
  shown)` in place of its functions (line for line, so error marks still line
  up), the GLSL page won't load a graph's shader that uses one, and its card
  says "Sealed node pack";
- it only ever leaves sealed: exporting it again seals it whatever the
  checkbox says, a graph export carries it sealed, and publishing a group built
  with sealed nodes makes the new node sealed too (its function would contain
  theirs).

### What sealing does not do (be honest about it)

Sealing stops casual copying: the code isn't in the file, the app or the
workspace folder as text. It does **not** stop a determined person:

- the key is derived from a secret that ships with the app. Anyone who reads
  the app's code can decrypt any sealed pack;
- a shader has to reach the GPU as source text, so the browser's developer
  tools, a WebGL debugger or a GPU capture tool shows it. So do web pages made
  with "Put it on a website", which must contain the compiled shader.

That's section 9 of accounts-and-plans.md: the aim is to make copying the
unusual path, not to win an arms race. When the Pro code is encrypted and
checked on the Rust side (decision 10), the seal secret can move there too;
that raises the effort, it doesn't change the GPU limit.

## Exporting: what goes in

`bundle.ts` works on the Files page's inventory, so every export chooses items
the same way. With dependencies on (graphs, Play setups and presentations), an
export brings:

- the published node types a graph is built from (sealed ones sealed). These
  come along on Free too: they're what the graph needs, not a node pack you
  chose to make;
- the graphs a presentation was made from;
- the custom function presets, layer kinds and background images a graph or
  presentation uses;
- linked presentations and graphs, when saved records have
  `linkedPresentations` / `linkedGraphs` (ids or names). The Studio's Export
  offers "with its linked presentations" or "without"; an import that renames
  a linked graph or presentation ("keep both") updates the links. Records
  without these fields export as before.

- the files of the videos their Video layers use (`videoId`), as `video`
  items. Past 200 MB in all the export asks first whether to take them along
  (the same question as a library ZIP); left out, those layers ask for their
  files after an import.

A graph file already carries its groups, expression and custom function nodes'
code, datasets, Play media and layer kinds, so it opens without the extra
items; they come along so they're in the recipient's library too.

## Where the app writes one

Every download offers `.playfile` first and the readable format it always had
as the other:

| Where | `.playfile` | Other option | Plan |
|---|---|---|---|
| Top bar Export (and the phone menu, the shortcut) | the graph + what it uses | readable JSON | Free |
| Play → Export a play file | the Play setup + what it uses | readable JSON play file | Free |
| Present → Download, the presentations list, the web-page dialog's "Presentation file" | the presentation + its graphs, pictures, fonts | `.present.json` | Free |
| Presentations list → Download all | every presentation | ZIP of `.present.json` | Free |
| GLSL page → download every shader | every shader | ZIP of `.glsl` | Free |
| Studio → Functions → Export | the Functions library | `custom-fns.json` | Free |
| Backgrounds library → an image's menu | the image | the picture file | Free |
| Library → Export everything / Download… (per kind) | that kind (or everything) | ZIP | Pro, as before |
| Files → Download everything | everything | ZIP (or a folder, desktop) | Pro, as before |
| Files → a selection's Download… | the selection (+ what it uses, optional) | ZIP | Pro, as before |
| Node types (My nodes, a node's card, Library → Only published nodes) | a node pack only (signed, optionally sealed) | — | Pro (`nodes.pack`) |
| Builder → Node packs → Export | the pack: its nodes, examples and extras (signed, optionally sealed) | — | Pro (`nodes.pack`) |

Deliberately not `.playfile`: rendered video and frames (`.mp4`, `.mov`,
`.webm`, `.png`), "Put it on a website" and "Export as a web page" (they're
HTML pages meant for a browser), the OSC bridge script, and backup ZIPs made
before Install → Replace (they're for Install).

Published nodes only leave as node packs: the per-kind "Only published nodes"
download opens the node pack dialog. Profile and backup ZIPs still hold
published nodes in their stored form (sealed ones sealed), since they're for
Install.

## Opening

- **Import** (top bar, phone menu, the shortcut) accepts `.playfile` and every
  older format (graph and play JSON, `.present.json`, `library.json`, library
  and profile ZIPs), telling them apart by content.
- **Files → Install…** and the node list's import take `.playfile` too.
- **Drop** a `.playfile` anywhere on the window (browser and desktop).
- **Desktop:** `.playfile` is registered with the app (`bundle.fileAssociations`
  in `src-tauri/tauri.conf.json`, UTI `com.shaderstudio.playfile` conforming to
  `public.data` only, MIME `application/x-playfile`: not an archive type, so
  Finder and Archive Utility don't offer to expand it), so double-clicking one
  or dropping it on the Dock icon opens it. `RunEvent::Opened` (macOS) keeps
  the paths for the web side to take at launch and announces them while
  running; `open_file_read` reads only container files, up to 256 MB, and
  hands the bytes to the web side unchanged: nothing native parses the
  container, so the envelope lives in one place (`container.ts`). On Windows and Linux the association is
  registered by the bundle, but a file passed on the command line isn't read
  yet.

Importing a `.playfile` is Free; a `profile` item inside one needs Pro, like
Install.

## The workspace folder

Unchanged, by design: it keeps graphs, presentations and shaders as readable
files, since it's the place for working with them in other tools, syncing and
version control. The envelope is for files that leave the app as one thing to
share; it isn't applied to the folder. A published node is written in its
stored form, so a sealed node's file holds its encrypted blob, not its code.

## Container v2: the envelope

Since container v2 a `.playfile` is no longer a ZIP that any archive tool
opens. Renaming one to `.zip` shows nothing; `unzip`, 7-Zip, Finder and
Archive Utility refuse it, and another app can't import its contents. The
bytes are:

```
offset  size  field
     0     4  magic "PLYF"
     4     1  container version (2)
     5     1  flags: bit 0 = the payload is deflated before encryption
     6     2  reserved (0)
     8     4  ciphertext length, little-endian (includes the 16-byte GCM tag)
    12     4  payload length once decrypted and inflated (the v1 ZIP's size)
    16    16  salt, random per file
    32    12  nonce, random per file
    44     …  ciphertext: the v1 ZIP, deflated, then AES-256-GCM
```

- The key is **HKDF-SHA-256** of a secret that ships in the app
  (`src/playfile/secret.ts`) and the file's own salt, so every file has its
  own key: no single static key opens every file in the ecosystem, and one
  file's key doesn't open another.
- The whole header is the GCM's additional data. A changed byte anywhere (the
  ciphertext, the tag, the salt, the nonce, the flags, a length field) fails
  the tag, and the file is refused: **"This file was modified or damaged, so it
  wasn't opened."** The hashes and the signature inside still work as before;
  the tag just refuses a damaged file before they're looked at.
- Lengths come first. The file's size is checked against the 256 MB limit,
  then the header's ciphertext length against the file's and its ZIP size
  against the same limit, before anything is decrypted; the inflate writes
  into a buffer of exactly the declared size. Then the ZIP is read with every
  check a v1 file gets.
- AES runs through WebCrypto where the page has it (every https page,
  localhost, the desktop app) and through `@noble/ciphers` otherwise (a
  plain-http LAN address); both give the same bytes, and tests run both.
- The manifest, its signature and sealed node packs are unchanged inside the
  payload: a signed file's signature and a sealed pack's blobs are exactly what
  a v1 file would hold. Every export writes v2; the reader opens v1 too, and
  always will.
- "Export as readable JSON" (graphs, Play setups), `.present.json`, and the
  readable ZIPs the tables above list stay the explicit readable routes.

### What it stops, and what it doesn't (be honest about it)

It stops the casual paths: opening a `.playfile` as an archive, extracting a
graph or a node pack out of one, importing its contents into another app or a
script, and passing off a changed file as the original (the tag refuses it).

It does **not** stop someone who wants in. The secret is a string in the app's
JavaScript (and in the desktop binary): anyone who reads the app's code has
it, and with it and the file's salt can derive the key and get the ZIP out.
So this is obscurity, the same limit sealing has. Nothing in the app or the
docs should call it protection against a determined person.

A later step, if it's wanted: derive the key from something the app doesn't
carry for everyone. Pro or licence-bound keys (a per-licence key the Rust
side releases only for a valid licence, as accounts-and-plans.md §9 suggests
for the Pro code itself), so a file can be made openable only by a given
licence or account, with the app-embedded secret kept as the fallback for
files meant for anyone. That's a new container version with a key-id field,
not a change to this one.

## Node packs

A pack made in Builder → Node packs is a `nodes` item whose JSON also carries
`pack` (name, version, author, description, colour, glyph, licence, notes, and
the names of its example graphs and presentations), plus those graphs and
files as ordinary items. On import its nodes are listed under the pack's name
and its examples are opened from the pack's entry in the node list. See
[node-packs.md](node-packs.md).

## Tests

`src/playfile/__tests__/container.test.ts` (the container, the v2 envelope:
a round trip per kind, not a valid ZIP, tampered bytes refused, v1 still
opens, wrong magic refused, limits checked from the header before decrypting,
both AES backends; validation; signing with both backends; sealing) and `importExport.test.ts` (bundling,
the import preview and keep both / replace, each kind's round trip, sealed
packs compiling, links, the Free/Pro matrix, older formats).
