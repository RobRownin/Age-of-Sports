# Age of Sports – notes for Claude

Read `docs/KNOWLEDGE.md` first: architecture, Firebase data model and rules, workflow, image pipeline, design system, pitfalls, open points.

Essentials:
- Chat with the owner in **German**; app UI, code comments, console messages and commit messages in **English**.
- Single-file app: all code in `index.html`. After every change: syntax-check both script blocks with `node --check`, test headless with jsdom, then commit and push to `staging` (deploys to `/staging/`, separate Firebase project). Merge into `main` (= production) only after the owner has tested and approved.
- Bump `AVATAR_VERSION` whenever an image changes.
- New Firestore collections or doc-ID changes need a rules update in the Firebase Console of **both** projects (owner does this; provide the rule text).
- Never write tokens or secrets into the repo.
- Whitepaper (`whitepaper.html`, public): update it at every **production release** (merge to `main`), token-efficiently:
  1. `node tools/whitepaper-sync.js --fix` – regenerates all numbers (`data-sync`) and tables (`sync:` blocks) from `index.html` and lists the app commits since the last sync.
  2. Read only those commit messages; for each, check the section map in `docs/KNOWLEDGE.md` ("Whitepaper") and edit only the affected prose sections (each section's HTML comment names the systems it depends on). Update the roadmap.
  3. Retake screenshots only if the UI changed noticeably; bump the whitepaper version; run `--check` (must report up to date).

