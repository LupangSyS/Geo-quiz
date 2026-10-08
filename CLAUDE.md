# Strata: Geology Quiz (handoff notes for Claude Code)

Mobile-first geology quiz. Plain HTML/CSS/JS modules, no build step. Hosted on GitHub Pages, backed by Firebase (Auth + Firestore).
Read README.md for the feature list and setup. This file is the project state and the next steps.

## Accounts and targets
- GitHub repo: LupangSyS/Geo-quiz (use Codespaces or a local clone). Pages URL: https://lupangsys.github.io/Geo-quiz/
- Firebase project id: geo-quiz-e89a2 (Spark plan)
- Owner works from a phone, so keep instructions short and do the terminal work yourself where possible.

## What is built (all tested against an in-memory fake Firestore, NOT yet against real Firebase)
- Solo: stage climb (10 branches x easy/medium/hard), quick round, Rockslide. 240 questions in js/questions.js.
- Login: guests (Firebase anonymous auth) and Google (linkWithPopup keeps the guest uid). Only Google users are saved online and appear on the leaderboard.
- Multiplayer rooms (js/rooms.js, DOM-free, Firestore injected as `F`): duel, team battle (teamSize 3 to 5), deathmatch (3 wrong answers = out).
  Rooms are joined by 5-letter code, link `?room=CODE`, or QR. Any client can advance a question via a transaction, so there is no host dependency.
- Firestore rules in firestore.rules. Leaderboard collection `leaderboard/{uid}` (public read, Google-only write).
- Tests: `npm install && npm test` (rooms engine, solo/offline UI, end-to-end UI with simulated phones).

## Status of the Firebase setup
- DONE: Firebase project created. Authorized domain `lupangsys.github.io` added (Authentication > Settings).
- UNCONFIRMED: Authentication sign-in methods Google and Anonymous both enabled. Ask the owner or check.
- TODO: create Firestore database (production mode, region near Thailand such as asia-southeast1).
- TODO: publish firestore.rules (`firebase deploy --only firestore:rules`, or paste into the console Rules tab).
- TODO: put the web app config into js/firebase-config.js (still placeholders). Get it from Project settings > Your apps > Web app, or `firebase apps:sdkconfig web`.
- TODO: optional TTL policies on `expireAt` for collection groups `rooms` and `players`.
- TODO: commit and push, then GitHub repo Settings > Pages > Deploy from branch main, folder / (root). The repo must be public for free Pages.
- TODO: real-device test with 2 or 3 phones: duel, team battle, deathmatch, join by QR, Google sign-in.
  Google popup sign-in can be blocked inside in-app browsers; guests work everywhere.

## Known limits
- Scores are computed on each client (fine for friends, not cheat-proof; a cheat-proof version needs Cloud Functions).
- Firestore snapshot fan-out grows with players in a room (fine for dozens).

## Ideas the owner mentioned for later ("more ideas about challenges")
Ask the owner before building. Candidates: daily challenge, achievements and badges, rematch button in the same room, more questions per stage (a random 8 of 20+), spectator mode, per-branch leaderboards.

## Rules for working here
- Keep screens usable on a phone (one thumb, large tap targets). Keep the existing visual style (css/base.css tokens).
- Never commit secrets. The Firebase web config is public, but service account keys must never be added.
- Run `npm test` before every push. If you change rooms.js behaviour, update tests/rooms.test.js.
