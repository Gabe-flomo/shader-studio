# Release notes

The History panel has a **What's new** view: a short, friendly summary of each update, newest first. The notes live in `src/changelog/releases.ts`. The newest release id is also the app's version.

## What people see

- **A dot** on History (the sidebar's rail icon, or the Browse button and History tab on a phone) when there's a release this device hasn't seen. Opening What's new clears it.
- **"Updated · What's new"**, a small notice shown once after an update, with a button that opens What's new. It only appears if the device had already seen an earlier release. On a first run, the dot is enough.
- Both are stored per device in localStorage (`playfield:whats-new-seen`, `playfield:whats-new-toasted`). The web app and the desktop app work the same way.

## Versions

Release ids are calendar versions, `YEAR.MONTH.N`, where N counts that month's releases: `2026.9.7` is the seventh release of September 2026. They are valid semver with no leading zeros, so Tauri accepts them. `2026.09.07` would not work. They sort as numbers, part by part, so `2026.9.10` comes after `2026.9.9`.

The newest id is the version in three places, and a test checks that they match:

- `package.json` (and the root entry of `package-lock.json`)
- `src-tauri/tauri.conf.json` (the desktop app's version, which is also stamped into profile ZIPs and `workspace.json` through `__APP_VERSION__`)

`src-tauri/Cargo.toml` stays at `0.1.0`. Tauri reads the bundle version from `tauri.conf.json`, and changing the crate version would also change `Cargo.lock`.

## Adding a release (checklist for a merge)

Not every PR needs a release. Batch a day's merges, or a logical group of them, into one.

1. Add an entry at the **top** of `RELEASES` in `src/changelog/releases.ts`:
   ```ts
   {
     id: '2026.9.8',            // next N this month; first release of a new month is YEAR.MONTH.1
     date: '2026-09-28',
     title: 'Short and friendly',
     highlights: [
       { area: 'Play', text: 'One line, what you can do now.', link: { kind: 'example', key: 'handPaths', page: 'play' } },
     ],
   },
   ```
   - 3–8 highlights. Keep each to one line in the user's words. Leave out PR numbers and internal names.
   - `area`: Studio, Play, Present, Learn, Files, Desktop, Phone or Account.
   - `link` (optional):
     - `{ kind: 'example', key, page? }` opens a bundled example. Add `page: 'play'` to open it on the Play page.
     - `{ kind: 'page', page }` opens one of the app's pages.
     - `{ kind: 'doc', path: 'docs/…md' }` opens the doc on GitHub.
2. Run `npm run release:sync`. It writes the new id to `package.json`, `package-lock.json` and `tauri.conf.json`. `npm run release:sync -- --check` only reports.
3. Run `npx vitest run src/changelog`. The tests check:
   - the order and the id format
   - that each example key and doc path exists
   - that the version files match the newest release

If two PRs each add a release, the second one to merge takes the next N and runs `release:sync` again.
