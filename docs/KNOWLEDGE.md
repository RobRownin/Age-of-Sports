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
- Navigation: hamburger drawer; screens `athlete`, `inventory`, `activities`, `sleep`, `stats`, `gymnasium`, `stadium`, `leaderboard`, `account`. `showScreen(name)`; last screen kept in `localStorage` (`aos_lastScreen`).

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
| `leaderboard` | `{uid}_{athleteId}` | name, level, score per athlete |
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
- Base points: assigned once per athlete in `ensureBaseAttrs` (22–38 each), deterministic from the athlete id (seeded PRNG) so all devices agree; stored as `baseAttrs`, migrated on load.
- Training points: not stored, replayed from the activity history in `computeTrainingPoints` (consistent across devices, editing old activities recalculates). Each activity gives a stimulus per attribute = FP parts × weights (`TYPE_TRAINING` per activity type, `EXERCISES[].train` per exercise). Gain = (max − current) · (1 − e^(−stimulus/2000)), max = 1.5 × base, i.e. fast at first and asymptotically slower. Decay: 10 % of the training points per week, applied continuously between activities and up to now. Constants in `TRAINING`.
- Reference: daily 50 push-ups + three 5 km runs per week, base 30 (max 45): strength training ≈ 6 after 1 week, 15 after 4, 20 after 8 weeks; after a 4-week break ≈ 13.
- UI: bar shows base (muted) + training (colour) and a tick at the maximum; training points are shown with one decimal (a single session often adds < 1); after saving a new activity a toast shows the FP and training gains (`showToast`); the activity view lists which attributes an activity trains.

Challenge: `creatorUid/AthleteId/AthleteName/Username/Roll`, `status` (`open|completed`), then `opponent*` fields and `winner` (`creator|opponent|tie`).

Migrations run on load: single-athlete -> `athletes[]`; per-athlete inventory -> account inventory; new catalog items backfilled (`backfillNewCatalogItems`); Athleticus added once (`ensureAthleticus`); old leaderboard docs keyed by uid removed.

## Features

- **Athlete:** portrait, level, 5 attribute bars, 4 labeled equip slots; name dropdown switches the active athlete (renaming only in Gymnasium).
- **Inventory:** account-wide; shows which athlete wears an item. An item can be worn by one athlete at a time.
- **Activities / Sleep:** day-grouped lists, add/edit/delete, read-only detail sheet with points breakdown, prev/next via buttons and swipe.
- **Garmin import:** GPX and/or TCX, selectable together. TCX only knows `Running/Biking/Other` as sport, GPX has `<type>` (e.g. `rowing_v2`) but no trackpoints for indoor activities, so `mergeGarminResults` takes type from GPX and distance/duration/HR from TCX.
- **Stats:** type filter x period filter (Week/Month/Year/All-time), prev/next via buttons and swipe, Monday-Sunday week buckets in month view (month total counts calendar-month days only), current bucket highlighted.
- **Gymnasium:** roster with attribute bars; dialog to rename and pick portrait; create new athlete.
- **Stadium:** create a challenge (rolls 1-100 immediately), another account joins and rolls, higher roll wins, tie possible.
- **Leaderboard:** one entry per athlete of all accounts; own marked "(You)".
- **Athleticus:** fixed test athlete, name/portrait locked, portrait follows level 1-5 (`athlete-level-N.png`), level set manually in the Gymnasium dialog for now.
- **Items:** `ITEM_CATALOG` (clothing, equipment, supplies, slot4); items may have a real image (`image`), otherwise an emoji. Only `lion_sandals` has an image so far.
- **Gestures:** swipe right opens the drawer, left closes it; disabled on Stats and in open dialogs to avoid conflicts.

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
- Icons: inline SVG sprite at the top of `<body>` (`<symbol id="i-…">`, used as `<svg class="i"><use href="#i-…"/></svg>`), line style. `#i-laurel` is the logo. Activity types and items still use emojis (stored in data).
- Navigation: bottom nav (`.nav-item[data-nav]`: athlete, activities, stats, stadium, more). "More" opens the drawer with all screens; screens without their own tab highlight "More". `showScreen()` sets `body[data-screen]`, which also controls the floating "+" button (`.fab`, visible on Activities and Sleep).
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

- Stadium: more rules to come (currently pure dice, no effect on level/score/attributes); attributes could now influence duels.
- Fitness model is a first draft: tune weights/constants after real use; Stats still charts km only (FP or reps per exercise would fit better).
- Real level progression for Athleticus (replaces the manual level); level > 5 shows the level-5 image.
- Item system: earning/unlocking (everyone gets the starter set now), item effects, more item images, name the fourth slot category.
- Probably dead code: `avatarSVG`, per-athlete `week[]`; `laurelBarSVG()` now renders the plain XP bar (name kept).
- Challenge outcome is decided client-side; harden server-side if it ever matters.
- Ruled out: Health Connect, automatic Garmin API sync (needs developer program + server), FIT import (needs a library), in-app GPS tracking.
