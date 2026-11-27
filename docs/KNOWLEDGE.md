# Age of Sports – Project Knowledge

Handover/reference document for anyone (human or Claude) continuing development.
Conversations with the owner (Robert) are in **German**; all app UI, code comments and console messages are in **English**.

## Overview

Sports-tracking PWA in a Greek/Roman RPG style: log activities, level up athletes, equip items, duel in the Stadium.

- Repo: https://github.com/RobRownin/Age-of-Sports
- Live (production, branch `main`): https://robrownin.github.io/Age-of-Sports/
- Staging (branch `staging`): https://robrownin.github.io/Age-of-Sports/staging/
- Firebase projects: `age-of-sports` (production) and `age-of-sports-staging-53048` (staging), both Auth + Firestore, location `eur3`
- **Never commit access tokens.** The GitHub token is handed over out-of-band.

## Architecture

- Single file `index.html`, vanilla HTML/CSS/JS, no build step.
- Two script blocks: a classic `<script>` (all app logic, state, rendering) and a `<script type="module">` (Firebase; exposes everything as `window.fb`). The classic script only calls `window.fb.*`.
- Auth changes: `onAuthStateChanged` -> `window.handleAuthState(user)`.
- PWA: `manifest.json`, `service-worker.js` (network-first for HTML), `icon-192.png`, `icon-512.png`.
- Fonts: Cinzel (headings/names), Inter (UI), JetBrains Mono (numbers).
- Key state: `athletes`, `activeAthleteId`, `accountInventory`; working copies `ACTIVITIES`, `WEEK`, `athleteName` of the active athlete. `persist()` saves to Firestore and calls `syncLeaderboard()`.
- Navigation: footer only (no side drawer). Tabs `athlete`, `activities`, `missions`, `stadium`, `inventory`; sub-screens `gymnasium` (from the athlete screen, `SCREEN_PARENT_TAB` keeps the Athlete tab active) and `leaderboard` (from the stadium); `account` via the settings icon top right (incl. Log Out). `showScreen(name)` maps old names via `SCREEN_ALIASES` (`stats`/`sleep` → `activities`); last screen kept in `localStorage` (`aos_lastScreen`).

## Environments (production / staging)

- Deployment runs via GitHub Actions (`.github/workflows/deploy.yml`; Pages source = "GitHub Actions"). It checks out `main` into the site root and `staging` into `/staging/`, and renames the staging PWA in its `manifest.json` ("Age of Sports (Staging)").
- A push to `main` runs the deploy directly. A push to `staging` runs `trigger-staging-deploy.yml`, which dispatches the deploy on `main` (the `github-pages` environment only allows `main`). Both workflow files must exist on both branches.
- `index.html` is identical on both branches: `window.AOS_ENV` is `'staging'` when the path contains `/staging/`. That selects the Firebase config from `FIREBASE_CONFIGS`, shows a small "STAGING" badge, and uses the localStorage prefix `aos_staging_` instead of `aos_` (both builds share one origin).
- The service worker scopes its caches per environment (`age-of-sports-` vs `age-of-sports-staging-` prefix) and only deletes its own old caches.
- Firebase rules, authorized domains (`robrownin.github.io`) and Email/Password sign-in must be kept identical in both projects. Staging data is independent from production.

## Firebase

Login is username + password. `usernames/{name}` maps a username to the real email; there is a fallback for legacy accounts (`{name}@ageofsports.app`) and direct email login. Email changes use `verifyBeforeUpdateEmail`; Firestore is synced on next login (`syncEmailIfChanged`).

| Collection | Doc ID | Content |
| --- | --- | --- |
| `users` | uid | profile, `athletes[]`, `activeAthleteId`, `inventory[]` |
| `usernames` | normalized username | uid + email (login lookup, `get` only) |
| `leaderboard` | `{uid}_{athleteId}` | public athlete card: name, username, portrait, `score` = arena rating (level is set to null, FP are never published) |
| `challenges` | auto id | Stadium dice duels |

Rules are maintained manually in the Firebase Console (not in the repo), in **both** projects. **Every new collection or changed doc ID needs a rules update, otherwise access fails silently.** Current rules (verified identical in production and staging, 2026-11):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /leaderboard/{docId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && (
        docId == request.auth.uid ||
        (resource == null && request.resource.data.uid == request.auth.uid) ||
        (resource != null && resource.data.uid == request.auth.uid)
      );
    }
    match /usernames/{username} {
      allow get: if true;
      allow list: if false;
      allow write: if request.auth != null && (
        (resource == null && request.resource.data.uid == request.auth.uid) ||
        (resource != null && resource.data.uid == request.auth.uid)
      );
    }
    match /challenges/{challengeId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.resource.data.creatorUid == request.auth.uid;
      allow update: if request.auth != null && (
        resource.data.creatorUid == request.auth.uid ||
        (resource.data.status == 'open' && request.resource.data.opponentUid == request.auth.uid)
      );
      allow delete: if request.auth != null && resource.data.creatorUid == request.auth.uid;
    }
  }
}
```

## Data model

`users/{uid}`: `username`, `email`, `athletes[]`, `activeAthleteId`, `inventory[]` (account-wide item IDs).

Athlete entry: `id` (`athlete_<ts>_<rand>`), `name` (max 20), `baseAttrs` (`{endurance, pace, strength, mental, discipline}`, set once by `ensureBaseAttrs`), `activities[]`, `week[]` (legacy aggregate, no longer displayed), `equipped` (`{clothing, equipment, supplies, slot4}` -> item id or null), `portrait` (1-4), `isFixedType` (`'athleticus'`), `manualLevel` (Athleticus only).

Activity: type, km, reps, `exercises` (Strength only: `[{id, reps}]`, ids `pushups|situps|pullups|burpees|other`; `reps` = total), mins, date, `dateISO`, avgHeartRate, elevationGain, bedTime, wakeTime. Types are fixed: `run, ride, walk, row, strength, sleep`. Old Strength entries without `exercises` count as `other`.

### Fitness model (all in the "Fitness model" block of `index.html`)

**Fitness Points (FP)** per activity (`activityFPParts` / `computeActivityScore`): 10/km, 1/min, 0.3/bpm, 0.2/m elevation; sleep 5/h capped at 9 h; Strength exercises per rep: push-up 0.6, sit-up 0.4, pull-up 1.5, burpee 1.0, other 0.5 (`EXERCISES`). FP are the leaderboard score and drive the level.

**Level** (`levelFromFP`): each level needs 100 FP more than the previous one (step = 300 + 100·(L−1); Level 2 at 300 FP, 5 at 1,500, 10 at 6,300). Athleticus keeps its manual level.

**Attributes** = base + training (`computeAttrs(entry)`), keys `endurance, pace, strength, mental, discipline` (`ATTRIBUTES`):
- Base points: assigned once per athlete in `ensureBaseAttrs`, deterministic from the athlete id (seeded PRNG) so all devices agree; stored as `baseAttrs` + `baseAttrsVersion`. Version 2: every athlete gets the same total (`BASE_TOTAL` = 150, each 22–38) in a different distribution, for a fair arena; older versions are regenerated on load.
- Training points: not stored, replayed from the activity history in `computeTrainingPoints` (consistent across devices, editing old activities recalculates). Each activity gives a stimulus per attribute = FP parts × weights (`TYPE_TRAINING` per activity type, `EXERCISES[].train` per exercise). Gain = (max − current) · (1 − e^(−stimulus/2000)), max = 1.5 × base, i.e. fast at first and asymptotically slower. Decay: 1 % of the training points present at each midnight 00:00 UTC (step-wise; counted as UTC day boundaries between activities and up to now), i.e. values stay constant during the day. Constants in `TRAINING`.
- Reference: daily 50 push-ups + three 5 km runs per week, base 30 (max 45): strength training ≈ 6 after 1 week, 16 after 4, 22 after 8 weeks; after a 4-week break ≈ 17, after 8 weeks ≈ 13.
- UI: bar shows base (muted) + training (colour) and a tick at the maximum; training points are shown with one decimal (a single session often adds < 1); after saving a new activity a toast shows the FP and training gains (`showToast`); the activity view shows the training points the activity added per attribute at the time it was done (`activityTrainingGain`: history replayed up to that moment without/with the activity).

Challenge: `creatorUid/AthleteId/AthleteName/Username`, `discipline`, `creatorScore` (discipline score at creation), `creatorProfile` (`{portrait, stars}`; coarse 1–5 stars per attribute, no exact values), `status` (`open|completed`), `createdAt`; on join: `opponent*` (incl. `opponentScore`, `opponentProfile`), `creatorRoll`/`opponentRoll` (performances), `winner` (`creator|opponent|tie`), `completedAt`. Legacy dice duels have no `discipline` and are ignored for ratings.

Migrations run on load: single-athlete -> `athletes[]`; per-athlete inventory -> account inventory; new catalog items backfilled (`backfillNewCatalogItems`); Athleticus added once (`ensureAthleticus`); old leaderboard docs keyed by uid removed.

## Features

- **Athlete:** portrait, level, 5 attribute bars, 4 labeled equip slots; name dropdown switches the active athlete (renaming only in Gymnasium).
- **Inventory:** account-wide; shows which athlete wears an item. An item can be worn by one athlete at a time.
- **Activities (incl. sleep and stats):** one screen: stats on top (type chips incl. Sleep × period Week/Month/Year/All-time, prev/next + swipe), below the day-grouped list of exactly the activities of the current filter (`renderFilteredActivityList`, called from `renderStats`; `renderActivities()` just calls `renderStats()`). Chart/tile unit follows the filter (`statsMetric`): km, hours for Sleep, reps for Strength. The "+" button logs the filtered type. Detail sheet prev/next follows the shown list (`viewListOrder`).
- **Garmin import:** GPX and/or TCX, selectable together. TCX only knows `Running/Biking/Other` as sport, GPX has `<type>` (e.g. `rowing_v2`) but no trackpoints for indoor activities, so `mergeGarminResults` takes type from GPX and distance/duration/HR from TCX.
- **Stats details:** Monday-Sunday week buckets in month view (month total counts calendar-month days only), current bucket highlighted.
- **Gymnasium:** roster with attribute bars; dialog to rename and pick portrait; create new athlete.
- **Stadium / Arena:** see "Arena" below.
- **Leaderboard:** one entry per athlete of all accounts, ranked by arena rating (replayed from the duel history in the browser), shows portrait, title, W/L record; own marked "You". No level, no FP.
- **Athleticus:** fixed test athlete, name/portrait locked, portrait follows level 1-5 (`athlete-level-N.png`), level set manually in the Gymnasium dialog for now.
- **Items:** `ITEM_CATALOG` (clothing, equipment, supplies, slot4); items may have a real image (`image`), otherwise an emoji. Only `lion_sandals` has an image so far.
- **Gestures:** swipe left/right on the Activities screen changes the period; swipe in the detail sheet moves to the next/previous activity.

## Arena (simulation stage)

Idea: activities only make your own character stronger (level, attributes; private). Characters compete in the arena; only arena results are public and rank the leaderboard. This keeps raw training data (and later Strava data) away from anything other users see.

- **Disciplines** (`DISCIPLINES`): Stadion Sprint, Dolichos, Pale Wrestling, Pankration, Pentathlon, each with attribute weights (sum 1). A random discipline is drawn when a challenge is issued; the opponent sees it before fighting.
- **Duel**: discipline score = Σ weight × attribute value (base + training). Performance = score × (0.75…1.25 luck, `ARENA.NOISE`). Higher performance wins, difference < 0.5 = draw. The open challenge card shows the viewer's estimated win chance (Monte Carlo of the same model).
- **Rating** (`computeArenaRatings`): Elo, start 1000, K = 32, replayed chronologically from all completed duels (so everyone computes the same values). Titles: Novice < 950 ≤ Hoplite < 1050 ≤ Veteran < 1150 ≤ Champion < 1250 ≤ Legend.
- **Limits**: max 5 duels per athlete per UTC day (created + joined), one open challenge per athlete, no fights against own account.
- **Public data**: name, portrait, title, rating, record, 1–5 stars per attribute, discipline score inside a challenge. Exact attributes, level, FP and activities stay private.
- **Known limitations of this stage**: duels are resolved and attributes computed in the browser (not cheat-proof); all challenges are loaded for the rating replay (`fetchAllChallenges`); profile is a live snapshot at challenge time. No Firestore rule change was needed.
- **Next steps** (discussed, not built): server-side resolution + attribute calculation (Cloud Functions, needed for Strava anyway); weekly public snapshot of the arena profile; settings "Arena & privacy" (opt-in to compete, separate opt-in for Strava data); duel narration texts; then optional Strava import (only after Strava confirms the concept; plan B: Strava activities count privately only).

## Missions and Kleos

Missions make a character stronger for the arena; the leaderboard stays arena-only. (Separate weekly quests were merged into missions as training goals.)

- **Missions** (`MISSIONS`, 6 so far: Courier to Corinth 2 h → Nemean Games 4 d, level gates 1–10). One mission per athlete at a time; away athletes can't fight or start another mission; an open arena challenge must be withdrawn first.
- **Training goals / support**: each mission has 1–2 `goals` (e.g. run or walk 3 km; 200 strength reps + 2 active days) measured over the athlete's own activities that **start after the mission started and end before it is over** (start ≥ mission start at minute precision, start + duration ≤ planned end; sleep never counts; `missionGoalProgress`). Support = average goal progress (0–100 %). Effects at 100 % (linear): +25 pp success, injury risk halved, +3 pp brilliant, +25 % Kleos (`MISSION_RULES.SUPPORT_*`). Support does **not** change the duration. Progress is private. After logging an activity during a mission the toast shows the support level.
- **Outcome** is rolled **on return** (`claimMission`, "Reveal result" once the mission is over), so training during the mission counts. Odds (`missionOdds(entry, id, support)`): r = weighted score (attributes incl. gear, injury and Kleos) / difficulty; base success = 1/(1+e^(−8(r−0.9))); brilliant 1–4 %, injury 1–4 % (before support effects). Legacy missions with a stored `outcome` still resolve with it.
- **Results**: success = Kleos + one item of a rolled tier; brilliant = 2× Kleos + item one tier better; failure = 25 % Kleos; injury = −10 % arena/mission attributes for 3 days and unavailable for 1 day (2 days after missions ≥ 48 h).
- **Item tiers & loot** (classic RPG naming, may be renamed later): `tier` 1 Common (grey, ≈ +2 total bonus), 2 Uncommon (green, ≈ +3), 3 Rare (blue, ≈ +5), 4 Epic (purple, ≈ +7), 5 Legendary (orange, ≈ +9). Mission tier from demand = difficulty + 4·log2(hours): < 45 Common, < 60 Uncommon, < 72 Rare, < 80 Epic, else Legendary (Courier/Regatta Common, Delphi Uncommon, Agoge Rare, Isthmian Epic, Nemean Legendary). `LOOT_TABLES[missionTier]` = chance per item tier (e.g. Common mission 80/17/3/0/0 %, Rare 5/22/58/13/2 %, Legendary 0/0/10/35/55 %). The concrete item is picked at random among unowned items of the rolled tier (`pickRewardItem`, falls back to lower tiers; if nothing is left: 1.5× Kleos). **New items only need an entry with `tier` in `ITEM_CATALOG`.**
- **Kleos** (`computeKleos`): replayed from `entry.missionLog` (last 100 entries; old weekly-quest entries still count): gain × (1 − k/50), −1 % at each 00:00 UTC. Adds 0.2 × Kleos to every discipline/mission score. Public as 0–5 stars (`kleosStars`, KLE column in the arena profile).
- **Items with bonuses**: equipped bonuses count in arena and missions and show as striped "Gear" segment on the attribute bars; capped at +6 per attribute (`ITEM_BONUS_CAP`). Only `STARTER_ITEMS` are given to everyone.
- Data lives in the athlete entry (`mission {id, startedAt, endsAt}`, `missionLog`); no Firestore rule change needed. Simulation stage: outcomes are decided in the browser (not cheat-proof), like the arena.
- Ideas for later: festival games series (Isthmian, Nemean, Pythian, Olympic → title "Periodonikes"), Labours of Heracles for high levels, relay missions with several athletes, more items/real item images.

## Whitepaper

- `whitepaper.html` (repo root, standalone page in the app's design) is deployed with the app: production `https://robrownin.github.io/Age-of-Sports/whitepaper.html`, staging `/staging/whitepaper.html`. Linked from the login screen and the Account screen.
- Structure follows move-to-earn whitepapers (e.g. STEPN): abstract, problem, vision, core loop, game systems, fairness/anti-cheat, privacy, economy, roadmap, disclaimer. Deliberately **no token/NFT economy** – the economy section lists the in-game values.
- **Keep it in sync**: all numbers (FP rates, level formula, training model, item tiers, mission table, loot tables, arena weights, Elo, limits) are copied from `index.html`. When game constants change, update the whitepaper too and bump its version.

## Development workflow

1. Edit `index.html` (and assets).
2. Syntax check: extract the classic block (`re.search(r'<script>(.*?)</script>', c, re.S)`) and the module block (`re.findall(r'<script type="module">(.*?)</script>', c, re.S)[0]`), run `node --check` on each.
3. Headless test with jsdom: strip the module script from the HTML, mock `window.fb`, call `window.handleAuthState({uid, email})`, assert via the DOM.
4. Commit and push to `staging`; the owner tests on https://robrownin.github.io/Age-of-Sports/staging/.
5. After the owner's approval, merge `staging` into `main` and push (= production release).
6. Data-model changes or migrations: test on staging first, warn the owner explicitly before releasing, keep migrations backward compatible.

Testing pitfalls: top-level `let` variables are not on `window` (assert via DOM); in jsdom override `window.Math.random`, not the global one; async renders need a short wait.

Cache-busting: bump `AVATAR_VERSION` whenever a portrait/item image changes (URLs append `?v=${AVATAR_VERSION}`). Service worker cache name: `CACHE_NAME` in `service-worker.js`.

## Images

- Portraits: `athlete-portrait.png`, `-2`, `-3`, `-4` (array `PORTRAITS`); level images `athlete-level-1..5.png` (array `LEVEL_PORTRAITS`); items `item-*.png`.
- Portrait standard: transparent PNG, 360x520 canvas, content cropped to its bounding box, scaled with `ratio = min(360/w, 520/h)`, centered horizontally, top-aligned (y = 0), never distorted.
- Background removal: Python with PIL and `rembg` using `new_session('u2netp')` (the default model is >1 GB and runs out of memory). First check whether the PNG already has real transparency (mode `RGBA`, corner alpha 0).
- New portrait: create file, add to `PORTRAITS`/`LEVEL_PORTRAITS`, bump `AVATAR_VERSION`, commit. Images are created externally (no image generation available to Claude).

## Design

Modern dark UI (redesign 2026-11), the ancient theme lives in the content (athletes, laurel logo, wording), not in ornate chrome.

- Tokens in `:root`: `--bg #0B0B0E`, `--surface #15151A`, `--surface2 #1C1C23`, `--surface3 #25252E`, `--border rgba(255,255,255,.07)`, `--text #F4F2EE`, `--muted #8E8B97`, `--faint`, `--gold #F2B33D` (+ `--gold-light`, `--gold-grad` gradient), `--red #F0544F`, `--green`. Radii `--radius-lg/--radius/--radius-sm`.
- Fonts: Inter (UI), Sora (`--font-display`: headings, numbers with tabular figures), Cinzel only in the wordmark.
- Icons: inline SVG sprite at the top of `<body>` (`<symbol id="i-…">`, used as `<svg class="i"><use href="#i-…"/></svg>`), line style. `#i-laurel` is the logo, `#i-tunic` (filled tunic silhouette) is the Clothing slot/category symbol, `#i-winged-sandal` (Hermes-style winged sandal, 48er viewBox) the Equipment symbol (`SLOT_ICONS` values may be emoji or SVG markup). Activity types and items still use emojis (stored in data).
- Navigation: bottom nav (`.nav-item[data-nav]`: athlete, activities, missions, stadium, inventory), sub-screens show a `.back-btn`. `showScreen()` sets `body[data-screen]`, which also controls the floating "+" button (`.fab`, visible on Activities). Drawer CSS is still in the stylesheet but unused.
- Colour coding: activity types via `.t-run/.t-ride/.t-walk/.t-row/.t-strength/.t-sleep` (sets `--tint`), attributes via `.a-endurance/.a-pace/.a-strength/.a-mental/.a-discipline` (sets `--c`, see `attrClass()`).
- Components: `.card` (+ `.highlight`), `.btn-primary` (gradient), `.btn-secondary`, `.btn-danger`, `.list-btn`, `.chip-row`, `.metric-row` (segmented control), `.sheet` (bottom sheet with grab handle), `.settings-group`, `.empty` (empty state), `.badge`.
- Patterns: edit via "Edit" text button with Save/Cancel; sensitive data masked (email) and password toggle; highlights in gold, not red; chart bars live in a fixed bar area so labels never clip; flex columns in charts need `min-width: 0`; mobile first, swipe gestures preferred over extra buttons; migrations stay backward compatible.
- Avoid generic class names that collide (e.g. `.empty` is the empty state; the chart uses `.nodata`).

Naming history: "Character" -> "Athlete" (also internally), "Academy" -> "Gymnasium", "Sport" tab -> "Activities".

## Decisions and pitfalls

- Health Connect cannot be used from a PWA (on-device Android API, no web interface); Google Fit REST is being shut down in 2026. Only file export (GPX/TCX) works.
- GPX `<metadata><time>` is often the upload time; duration/start come from trackpoint times only.
- After an email change the old address is invalid immediately; login tries several candidate addresses.
- The leaderboard cleanup (`syncLeaderboard`) removes orphaned entries of the own account.
- When inserting text before a function signature with `str_replace`, make sure the signature line is not removed; the syntax check catches it.

## Open points

- Arena: see "Arena" section (next steps); tune discipline weights, luck factor, K and daily limit after real use.
- Fitness model is a first draft: tune weights/constants after real use; Stats still charts km only (FP or reps per exercise would fit better).
- Real level progression for Athleticus (replaces the manual level); level > 5 shows the level-5 image.
- Item system: earning/unlocking (everyone gets the starter set now), item effects, more item images, name the fourth slot category.
- Probably dead code: `avatarSVG`, per-athlete `week[]`; `laurelBarSVG()` now renders the plain XP bar (name kept).
- Challenge outcome is decided client-side; harden server-side if it ever matters.
- **Planned: move activities out of the user document** (before the app grows).
  - Problem: all athletes and activities of an account live in one `users/{uid}` doc. Firestore limit is 1 MB per document; one activity is ~270 bytes, so roughly 3,500 activities per account (≈ 3 years at 3 entries/day). The whole doc is also loaded on every start and rewritten on every save.
  - Target: subcollection per athlete, e.g. `users/{uid}/athletes/{athleteId}/activities/{activityId}` (or `users/{uid}/activities` with an `athleteId` field). Load only recent months on start; load older data on demand (e.g. Stats "All-time").
  - Then store training checkpoints per athlete (e.g. training points at the start of each week) and replay only from the last checkpoint; invalidate checkpoints when an activity older than the checkpoint is added/edited/deleted (incl. Garmin import).
  - Needs: one-time migration of existing data (backward compatible, keep reading the old array until migrated), Firestore rules for the new path in **both** projects, leaderboard sync unchanged (score/level only).
  - Current cost is not the reason: full training replay measured at ~2 ms for 1,000 and ~16 ms for 10,000 activities (desktop), and each client only computes its own athletes, so the number of users does not affect load time.
- Ruled out: Health Connect, automatic Garmin API sync (needs developer program + server), FIT import (needs a library), in-app GPS tracking.
