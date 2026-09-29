# Development tasks

## Task 000 — repository and Codex setup

- [x] Initialize a Git repository with `main` as the default branch.
- [x] Add README, Node ignore rules, line-ending rules, project brief, and roadmap.
- [x] Add repository-level Codex instructions.
- [x] Add conservative project-scoped Codex defaults.
- [x] Create and connect the public GitHub repository.
- [x] Push the initial commit.

## Task 001 — application scaffold

Create the V1 application skeleton with React, TypeScript, Vite, Tailwind CSS, Recharts, Vitest, and npm.

Required outcomes:

- [x] Establish the folder structure described in `docs/PROJECT_BRIEF.md`.
- [x] Create realistic demo data for eight fictional players and at least thirty matches.
- [x] Implement responsive navigation, a first dashboard, and a first leaderboard.
- [x] Add placeholder routes for all planned V1 pages.
- [x] Add `docs/SCORING.md` and `docs/DATA_MODEL.md`.
- [x] Configure linting, unit tests, CI, and GitHub Pages deployment.
- [x] Ensure the Vite base path works under `/valorant-squad-analytics/`.
- [x] Verify `npm run lint`, `npm test`, and `npm run build`.

Do not implement the full scoring engine during this task. Use clearly labeled initial calculations or fixtures and leave advanced scoring for Task 002.

## Task 002A — usability and official API readiness

- [x] Convert user-facing application text to Taiwan Traditional Chinese.
- [x] Add browser-local avatar upload, resize, preview, persistence and reset.
- [x] Add a typed, searchable and filterable metric dictionary.
- [x] Research official VALORANT endpoints and DTO capabilities.
- [x] Add About, Privacy and disabled Connect Riot readiness flows.
- [x] Add Demo/Riot data-source boundaries without network requests or credentials.

## Task 002B — evidence-aware scoring correctness

The next scoring task must address all audit findings before adding new dimensions:

- missing category evidence currently becomes the numeric score 50 and is indistinguishable from measured neutral performance;
- optional first-kill/death and clutch totals can use partial observations while their derived denominators still cover all rounds/matches;
- one observed match can produce a perfect Consistency score because measured dispersion is zero;
- tiny clutch samples can produce overly strong scores without shrinkage or a minimum sample rule;
- score results do not provide component-level calculation traces;
- role benchmarks are prototype constants without a versioned calibration source;
- aggregate values are rounded before scoring, losing precision;
- Teamplay currently includes a significant 25% Win Rate contribution.

Required outcome: a transparent, role-aware, evidence-coverage-aware eight-dimension engine for Firepower, Round Impact, Entry, Teamplay, Clutch, Economy, Consistency and Role Value. Confidence remains separate from performance.

## Later roadmap

- Task 003: cross-ranking filters, player comparison, map, agent and match views
- Task 004: teammate synergy matrix and Duo Synergy page
- Task 005: impact kills and trade analysis
- Task 006: clutch engine
- Task 007: economy analysis
- Task 008: advanced UI refinement
- Task 009: CSV and JSON import
- Task 010: GitHub Pages v1.0 release
- Official Riot integration: application readiness is now documented early, but live player data remains dependent on Production API approval, RSO access and a secure backend.
