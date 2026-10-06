# TASK-SECURITY-02 — dependency audit drift reassessment (evidence record)

SDD STRICT, 2026-10-06. Starting HEAD `9cc51d9464ae64ffffb62dad05390b4444f6a752`; checkpoint
`checkpoint-before-security-02`. Outcome: **COMPLETE / SECURITY DISPOSITION ACCEPTED**.
- One high advisory was FIXED by a lockfile-only compatible patch (`d021e5e`).
- One moderate advisory is TEMPORARILY ACCEPTED under the new **SEC-2026-002**.
- The original braces advisory remains under **SEC-2026-001 (original subset only)**.
- Production audit: 0. V1 is not released.

## Audit reproduction (before → after the patch)

| Audit | critical | high | moderate | low | info | total |
|---|---:|---:|---:|---:|---:|---:|
| Full, before | 0 | 6 | 2 | 0 | 0 | **8** |
| Full, after `d021e5e` | 0 | 5 | 2 | 0 | 0 | **7** |
| Production (`--omit=dev`), before and after | 0 | 0 | 0 | 0 | 0 | **0** |

**Unique underlying advisories.** 3 before the patch, 2 after. Verified against the GitHub
Advisory Database API on 2026-10-06; none is withdrawn.

| Advisory | CVE | Package · vulnerable range · patched | Severity (CVSS) | npm findings it propagates to |
|---|---|---|---|---|
| GHSA-vfj7-8cjw-p6xm | CVE-2026-93687 | braces `<=3.0.3` · patched **none** | high (7.5), CWE-674 stack exhaustion | braces, chokidar, micromatch, fast-glob, tailwindcss (5 high). Unchanged since SEC-2026-001 |
| GHSA-68fv-2mgg-jv7q | CVE-2026-93749 | source-map-js `>=1.0.0 <1.2.2` · patched **1.2.2** | high (7.5), CWE-1284 | source-map-js (1 high). **FIXED** |
| GHSA-rj75-hqrm-r3gf | CVE-2026-104844 | postcss-selector-parser `<7.1.6` · patched **7.1.6** (the `legacy-v6` tag is still unpatched 6.1.4) | moderate (5.9), CWE-400/407 quadratic selector parsing | postcss-selector-parser, postcss-nested (2 moderate). Also contributes to the tailwindcss row |

## Exact finding table (after the patch)

All seven findings are dev/build only (lockfile `dev: true`).

| Package | Installed | Severity | Advisory | npm range | Path from root | Type | fixAvailable |
|---|---|---|---|---|---|---|---|
| tailwindcss | 3.4.19 | high | via braces chain + postcss-selector-parser | `0.5.0–3.4.19` | root devDependency | **direct** | tailwindcss@4.3.3 (SemVer major) |
| chokidar | 3.6.0 | high | GHSA-vfj7 (via braces) | `2.0.0–3.6.0` | tailwindcss → chokidar | transitive | tailwindcss@4.3.3 (major) |
| braces | 3.0.3 | high | GHSA-vfj7 | `*` | tailwindcss → chokidar/micromatch → braces | transitive | tailwindcss@4.3.3 (major) |
| micromatch | 4.0.8 | high | GHSA-vfj7 (via braces) | `>=0.2.0` | tailwindcss → micromatch; → fast-glob → micromatch | transitive | tailwindcss@4.3.3 (major) |
| fast-glob | 3.3.3 | high | GHSA-vfj7 (via micromatch) | `*` | tailwindcss → fast-glob | transitive | yes, through its parent |
| postcss-selector-parser | 6.1.4 | moderate | GHSA-rj75 | `<7.1.6` | tailwindcss → postcss-selector-parser; → postcss-nested → postcss-selector-parser | transitive | tailwindcss@4.3.3 (major) |
| postcss-nested | 6.2.0 | moderate | GHSA-rj75 (via postcss-selector-parser) | `2.0.3–6.2.0` | tailwindcss → postcss-nested | transitive | yes, through its parent (8.x needs selector-parser 7) |

**Removed by the patch:** source-map-js 1.2.1 → 1.2.2 (postcss 8.5.28 → source-map-js; postcss
declares `^1.2.1`).

**Note on a misleading local signal:** a stale `node_modules/.package-lock.json` made `npm ls`
report 1.2.2 while the committed lockfile and the files on disk were 1.2.1. The committed lockfile
is authoritative, and `npm ci` re-synced it.

## Advisory research (new since SEC-2026-001)

**GHSA-68fv-2mgg-jv7q — source-map-js.**
- Flaw: unvalidated per-section offset lines in *indexed* source maps block the event loop.
- Attacker input needed: a crafted source map consumed by the build toolchain.
- This project: production build has source maps off; no runtime code parses source maps; nothing
  in api/server/shared/src/scripts imports it.
- Fix: patched 1.2.2 is within postcss's declared range, so a lockfile-only update.
- **FIXED.**

**GHSA-rj75-hqrm-r3gf — postcss-selector-parser.**
- Flaw: an O(n²) parse of a very long flat selector (for example `.a.a.a…`, about 400 KB ≈ 34 s CPU).
- Attacker input needed: attacker-controlled CSS selectors parsed by Tailwind/PostCSS at build time.
- This project: PostCSS/Tailwind run only in `vite build`/dev over `src/index.css` and the Tailwind
  content globs `./index.html`, `./src/**/*.{js,ts,jsx,tsx}`, which are reviewed repository files.
  `postcss.config.js` and `tailwind.config.js` are static.
- Fix: patched only in 7.x.
  - tailwindcss 3.4.19 (the final `v3-lts`) declares `^6.1.2`, and postcss-nested 6.2.0 (required
    `^6.2.0` by Tailwind) declares `^6.1.1`.
  - A compatible update is therefore impossible.
  - Forcing 7.x through an `overrides` entry would violate Tailwind's declared semver range (not
    authorized).
  - Tailwind 4 is the only parent path.
- **TEMPORARILY ACCEPTED (SEC-2026-002).**

## Boundary evidence (re-verified after the patch)

**Physical production install.** A disposable directory with only `package.json` and the patched
`package-lock.json`:
- `npm ci --omit=dev --ignore-scripts` added 49 packages (38 top-level directories).
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm ls` and directory checks: braces, chokidar, micromatch, fast-glob, tailwindcss,
  postcss-selector-parser, postcss-nested, source-map-js and postcss are all **absent**.

**Browser bundle closure** (Vite `build.write:false`, every chunk's module inventory): 23 chunks,
**496 module records, 0 affected-package records**. Generated CSS is output only; the Tailwind
compiler does not ship.

**API closure** (esbuild, every `api/**/*.ts` entry, `platform=node`, `bundle`, `metafile`,
`write:false`): 12 entries, **65 unique input modules, 0 affected**, 0 unresolved non-`node:`
externals. This is local application closure; remote Vercel function bytes are **NOT VERIFIED**.

**Source reachability.** Searching api, server, shared, src and scripts found no import or use of
postcss, tailwind, source-map, micromatch, braces, chokidar, fast-glob or picomatch, and no
`child_process`, `eval`, `new Function` or non-literal dynamic import.

**Runtime data never reaches build tooling.** Riot names, tags, member names, nicknames, weapon
names, query parameters and DB content are runtime JSON rendered as React text nodes. They never
reach CSS, selector, PostCSS or glob processing.

**Build output.** `dist` is byte-identical before and after the patch (25 files, SHA-256).

## CI / PR threat boundary

- `ci.yml` runs on `push`/`pull_request` to `main` with `permissions: contents: read`. It
  references no secrets; GitHub does not pass secrets to fork PRs.
- `deploy-pages.yml` runs only on push to `main` and `workflow_dispatch`.
- Build tooling therefore processes reviewed repository content. A malicious PR could make CI
  burn CPU, but it reaches no privileged credentials in GitHub Actions.
- **NOT VERIFIED (not broadened here):** Vercel preview builds of untrusted PRs and which
  environment variables they receive. `db:migrate:vercel` skips outside Production. Review this
  in a separate CI/CD hardening task if fork PRs are ever accepted.

## Compatible fix search and isolated trials

| Trial | Where | Result |
|---|---|---|
| `npm update source-map-js` | Disposable git worktree | Lockfile diff of 3 lines; full audit 8 → 7; production audit 0; lint/test (559)/build/db:validate all pass; dist byte-identical. **Applied** |
| `tailwindcss@4.3.3` | Disposable package-only copy, lockfile only | Audit **0** in the resolved tree. Not built and not migrated. v4 changes the PostCSS/Vite plugin (`@tailwindcss/postcss` or `@tailwindcss/vite`), config loading (CSS-first or `@config`) and utility defaults, which is a frontend/build migration |

No `npm audit fix --force`, no override, no `node_modules` patching, no vendoring.

**Tailwind 4: REQUIRED** to clear GHSA-vfj7 and GHSA-rj75. NOT required for the source-map-js
fix, and NOT authorized here (→ TASK-SECURITY-03).

## CI gate decision

No CI change.
- `npm audit` depends on the network and the live advisory feed. A new advisory published anytime
  would turn unrelated commits red, so it is not deterministic per commit.
- A scheduled or release-only production-audit job could be added in a separate task.
- The release gate remains the manual `npm audit --omit=dev` = 0, plus an honest full audit reviewed
  against the exact SEC records.
- There is no suppression, no `--audit-level` hiding and no ignore list.

## Gates (final worktree)

| Check | Result |
|---|---|
| Lint | clean |
| Tests | 41 files / 559 passed (including the source secret boundary) |
| Build | 739 modules; dist secret boundary passed |
| `db:validate` | 17/17 |
| `git diff --check` | clean |
| Full audit | 7 (5 high, 2 moderate) |
| Production audit | 0 |

0 provider calls, 0 production writes, no migration, no product change.
