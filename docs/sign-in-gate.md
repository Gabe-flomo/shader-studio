# The sign-in gate

An early, local stand-in for milestones 1 and 2 of
[accounts-and-plans.md](accounts-and-plans.md): a sign-in page in front of the
app, and Free and Pro logins so the two plans can be tried side by side.

## It is not protection

Everything runs in the browser, and the repository is public.

- The user list (usernames, plans, salted password hashes) ships in the
  JavaScript bundle. Anyone can read it.
- Anyone can patch the check out in the developer tools, or clone the repo and
  run the app with no gate at all.
- The hashes are slow to crack (PBKDF2-SHA256, 150,000 iterations, random salt
  per user), so use passwords you don't use anywhere else. A short or common
  password can still be guessed offline.

It keeps casual visitors out of a shared link. That's all it does.

## Adding and removing users

Passwords are never written to the repo, only hashes, in
`src/auth/gateUsers.json`. The file ships empty.

```sh
npm run gate:user -- <username> free     # asks for the password twice, without echoing it
npm run gate:user -- <username> pro
npm run gate:user -- --list              # who is in the file, and their plans
npm run gate:remove -- <username>
```

For a script, pipe the password in (first line of stdin):
`printf '%s\n' "$PW" | npm run gate:user -- <username> pro`.

Running `gate:user` again for the same username replaces that entry (a new
password or plan). Commit `src/auth/gateUsers.json` and deploy for the change
to reach the site. Anyone signed in as a removed user, or with a changed
password, is signed out the next time the app loads.

## When the gate is on

- **No users in the file:** the gate is off and everyone is Pro. This is how the
  app ships, so development and the current site keep working.
- **Users in the file:** the sign-in page shows before any of the app loads.
- **`VITE_GATE=off`** at build time switches it off anyway
  (`VITE_GATE=off npm run build`, or in `.env.local` for dev).

"Stay signed in" keeps the sign-in in localStorage. Without it the sign-in
lasts until the tab closes. **Sign out** is in the More menu (the ⋯ at the end
of the top bar, desktop and phone), under "Signed in as … · Free/Pro". Sign
out reloads the app, so save first.

## Free and Pro

Every gate asks one question, `can(feature)` in `src/lib/plan.ts`, which
lists each feature with its plan. Moving a feature between plans is a one-line
change there. Play's own rules (which sources Free maps from, and what plays)
are in `src/play/planGates.ts`.

Locked things stay visible with a small **Pro** badge. Using one opens the Pro
sheet (what Pro includes, the price, and a store link set by `PRO_STORE_URL` in
`plan.ts`). A file made on Pro opens on Free without losing anything: Pro-only
layers, mappings and backgrounds are kept in the record and shown as
"needs Pro", and they just don't play.

## Replacing it with the licence service

`src/auth/gate.ts` decides who is signed in and hands a `Session` (user, plan,
source) to `usePlan.setSession`. The licence service (a signed licence token,
checked offline, refreshed weekly: accounts-and-plans.md §3 and decision 8)
replaces that module and `SignInPage`, and sets the session the same way with
`source: 'licence'`. `can()` and every gate stay as they are.

Not done yet: splitting the Pro features into their own lazily loaded (and, on
desktop, encrypted) chunks (decision 10). The checks are all behind `can()`,
so that split can follow the same feature list.
