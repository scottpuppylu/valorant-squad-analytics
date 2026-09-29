# Development tasks

## Task 000 — repository and Codex setup

- [x] Initialize a Git repository with `main` as the default branch.
- [x] Add README, Node ignore rules, line-ending rules, project brief, and roadmap.
- [x] Add repository-level Codex instructions.
- [x] Add conservative project-scoped Codex defaults.
- [ ] Create and connect the public GitHub repository.
- [ ] Push the initial commit.

## Task 001 — application scaffold

Create the V1 application skeleton with React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.

Required outcomes:

- Establish the folder structure described in `docs/PROJECT_BRIEF.md`.
- Create realistic demo data for eight fictional players and at least thirty matches.
- Implement responsive navigation, a first dashboard, and a first leaderboard.
- Add placeholder routes for all planned V1 pages.
- Add `docs/SCORING.md` and `docs/DATA_MODEL.md`.
- Configure linting, unit tests, CI, and GitHub Pages deployment.
- Ensure the Vite base path works under `/valorant-squad-analytics/`.
- Verify `npm run lint`, `npm test`, and `npm run build`.

Do not implement the full scoring engine during this task. Use clearly labeled initial calculations or fixtures and leave advanced scoring for Task 002.

## Later roadmap

- Task 002: transparent, role-aware eight-dimension scoring engine
- Task 003: cross-ranking filters, player comparison, and computed badges
- Task 004: teammate synergy matrix and Duo Synergy page
- Task 005: impact kills and trade analysis
- Task 006: clutch engine
- Task 007: economy analysis
- Task 008: advanced UI refinement
- Task 009: CSV and JSON import
- Task 010: GitHub Pages v1.0 release
- Task 011+: official Riot API and RSO evaluation
