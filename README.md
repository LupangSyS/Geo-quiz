# Strata: Geology Quiz

A mobile-friendly geology quiz with 240 questions across 10 branches. Play solo, or in a room with friends:
**Duel** (1 v 1), **Team battle** (two teams of 3 to 5) and **Deathmatch** (any number of players, 3 wrong answers and you are out).
Rooms are joined by link or QR code. Players can sign in with **Google** (progress and leaderboard) or play as a **guest**.

No build step. It is plain HTML, CSS and JavaScript modules, so it runs on GitHub Pages or Firebase Hosting.

## Who can do what

| | Guest | Google account |
|---|---|---|
| Solo modes (stage climb, quick round, Rockslide) | yes, saved on the device | yes, saved online |
| Duel, team battle, deathmatch, join by link/QR | yes | yes |
| Progress follows you to another device | no | yes |
| Appears on the global leaderboard | no | yes |

## Setup (about 10 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and create a project (the free Spark plan is enough).
2. **Build > Firestore Database > Create database** (production mode, pick the region closest to your friends).
3. **Build > Authentication > Get started**, then enable two sign-in methods:
   - **Anonymous** (this is how guests join rooms)
   - **Google** (set a support email)
4. **Authentication > Settings > Authorized domains > Add domain**: add the domain where you will host the game, for example `yourname.github.io`. Google sign-in fails without this.
5. **Project settings > Your apps > Web (`</>`)**: register an app and copy the `firebaseConfig` object.

### 2. Paste your config
Open `js/firebase-config.js` and replace the placeholder values with yours. These values are public by design. Never commit a service account key.

### 3. Publish the security rules
Firestore Database > **Rules**, paste the contents of `firestore.rules`, and **Publish**.
(Or with the CLI: `npm i -g firebase-tools && firebase login && firebase use --add && firebase deploy --only firestore:rules`.)

### 4. Host it
**GitHub Pages:** push this folder to a repo, then Settings > Pages > Deploy from a branch > `main` / root. Your game is at `https://<you>.github.io/<repo>/`.
**Firebase Hosting:** `firebase deploy --only hosting` (already configured in `firebase.json`).

### 5. Clean up old rooms (optional but recommended)
Firestore > **TTL** > create two policies on the field `expireAt`: collection group `rooms` and collection group `players`. Old rooms then delete themselves after 24 hours.

## How rooms work
- The host picks a mode, branch, difficulty and question count, then taps **Create room**. A 5-letter code, a link (`?room=CODE`) and a QR code appear in the lobby.
- Friends scan or open the link. New players pick a name and badge (or continue with Google) and land straight in the lobby.
- Team battle: players are balanced across Team Basalt and Team Granite on joining and can switch before the host starts.
- Every phone shows the same questions. After everyone has answered (or the 20 second timer runs out) the room moves on after a short pause. Any player's phone can advance the room, so the game does not freeze if the host leaves.
- Deathmatch ends when one player is left, or the question pool runs out.

## Files
```
index.html            page shell
css/                  base.css (theme, solo UI), multiplayer.css (lobby, teams)
js/questions.js       the 240 questions (edit or add more here)
js/rooms.js           multiplayer engine (no DOM, fully tested)
js/app.js             screens, solo modes, profile, auth, leaderboard
js/firebase.js        Firebase wiring; firebase-config.js holds your keys
js/qr.js, vendor/     QR code generator
firestore.rules       security rules
tests/                npm install && npm test
```

## Adding questions
Open `js/questions.js`. Each branch has `e`, `m`, `h` lists. Add entries like
`["Question?", "Correct", "Wrong 1", "Wrong 2", "Wrong 3", "Why it is right"]`.
Everyone in a room must be running the same version, so redeploy after changing questions.

## Honest limits
- Scores are calculated on each player's phone. That is fine for a friends game, but a determined player could fake a score. A cheat-proof version needs Cloud Functions (Blaze plan).
- Google sign-in uses a popup, which some in-app browsers (inside chat apps) block. Guests work everywhere, and Google users can open the link in Chrome or Safari.
- Every score change is sent to every player in the room, so very large deathmatches use more of the free Firestore read quota. Dozens of players are fine.
