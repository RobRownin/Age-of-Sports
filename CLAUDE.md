# Age of Sports – notes for Claude

Read `docs/KNOWLEDGE.md` first: architecture, Firebase data model and rules, workflow, image pipeline, design system, pitfalls, open points.

Essentials:
- Chat with the owner in **German**; app UI, code comments, console messages and commit messages in **English**.
- Single-file app: all code in `index.html`. After every change: syntax-check both script blocks with `node --check`, test headless with jsdom, then commit and push to `main` (push = deploy via GitHub Pages).
- Bump `AVATAR_VERSION` whenever an image changes.
- New Firestore collections or doc-ID changes need a rules update in the Firebase Console (owner does this; provide the rule text).
- Never write tokens or secrets into the repo.
