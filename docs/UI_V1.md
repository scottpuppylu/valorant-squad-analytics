# TASK-UI-01 — V1 Product Refinement (SDD STANDARD)

Status: COMPLETE — SDD STANDARD. Starting HEAD 2a27f46956fd94298ac25469223dd6db236a2b84,
clean main = origin/main; checkpoint-before-ui-01 created.

## Plan and boundaries

1. Consolidate tokens, source/evidence badges and loading/empty/error presentation.
2. Six primary navigation destinations, keyboard-accessible More and mobile disclosure.
3. Compact dashboard/profile, deliberate scrolling tables, focused comparison and pair detail before matrix.
4. Dictionary groups, Traditional Chinese copy, readable consent workflow without changing any security requirement.
5. Focus/accessibility tests, four-size browser checks, 200% zoom, bundle comparison and release acceptance.

Schema 3, community-score-v2, duo-synergy-v1, event-metrics-v1, privacy policy,
provider behavior and migrations remain unchanged. No production player/data creation or Henrik calls.
TASK-RELEASE-01 is recommended only, not started. UI-01 does not declare V1 released.

## Baseline

Lint passed. 19 files / 270 tests passed in 28.58s; secret boundary passed.
Build: 706 modules, 4.39s. Main 449.24 / 141.81 kB gzip; CSS 34.08 / 7.91;
ScoreRadar 1.27 / 0.86; ComparisonRadar 16.08 / 5.68; chart dependency 339.53 / 99.68.
Audit: zero vulnerabilities. DB validation 15/15 passed in 15.90s.

## Visual conventions

Dark ink, restrained emerald, player accent and the 哥 brand remain. Shared spacing,
radius, border, muted text, table headers and focus tokens avoid page-specific styling.
Evidence status is text plus color: 完整 / 部分證據 / 資料不足. Confidence is independent.
Display precision stays in central formatters; calculation precision is untouched.

## Navigation and responsive conventions

Primary: 首頁、戰力排名、玩家、比較、搭檔分析、對戰.
More: 地圖分析、特務／角色分析、數據字典、加入調查、關於本站、隱私說明.
Every existing route remains. Desktop disclosure is click/Enter-accessible, never hover-only.
At widths below 1280 CSS px, mobile navigation has 44px targets and visible source status.
Opening focuses its first link; Escape returns focus to the trigger; navigation closes it,
focuses main and resets page scroll. No body-scroll locking. Skip link avoids hash-router conflicts.

Pages share a 1500px maximum container with 1–2rem gutters and 2rem section rhythm.
Ranking/analytical tables deliberately scroll inside focusable named regions; ranking identity
columns remain sticky. Comparison puts players in columns with score/status/sample visible;
all former raw statistics remain in a closed disclosure. Synergy keeps selected detail
before the list, with the complete matrix in 查看完整矩陣 at every size.

## Evidence, source and runtime presentation

SourceBadge is shared in header/footer: 公開真實戰績 / 虛構示範資料 / 載入中.
Refreshing stale state says 正在重新整理; retained failed-refresh snapshot says 上次成功資料,
not an ongoing refresh. Existing DatasetProvider states/messages are consumed unchanged.
StatusBadge uses text plus color: 完整 / 部分證據 / 資料不足; partial coverage is explicit.
樣本信心 stays independent from performance. Display formatting does not round calculations.

REAL empty: 目前尚無可分析的真實對戰 with 加入調查 / 查看資料說明 / refresh actions.
One-player Synergy, no shared sample, invalid player link, insufficient comparison and filtered
emptiness explain the next action. Loading panels contain no fake numbers. Stale keeps valid
previous data visible. Errors hide server internals and offer refresh; route-chunk failures
offer a full reload. No schema or fallback behavior changed.

## Page hierarchy

- Dashboard: source, sample, current leader, next actions, ranking snapshot, dimensions,
  selected radar and recent activity. REAL does not use the removed Demo storytelling block.
- Profile: identity/role/agents, Overall and confidence; compact emoji editing; eight dimensions
  with status/coverage/sample and closed 評分依據. Raw metrics group by combat, team/round, opening.
- Compare: compact native 2–4 selector, radar with external wrapping-safe legend, score/core
  table and expandable long-tail detail. Full long names remain accessible.
- Matches: date/map/mode/outcome plus visible player names and count; expanded performances
  are a deliberate scrolling table, not an event timeline.
- Maps/Agents: sample-aware context descriptions, not causal claims.
- Connect: explicit steps/current state including syncing/paused/complete/deletion states.
  All request handlers, consent/privacy/security paragraphs and authorization gates are preserved.
- Dictionary: five meaningful groups plus All, search and existing availability/type filters;
  no metric capability is upgraded. One obsolete task-number note and one Traditional Chinese
  typo were corrected; no formula, metadata availability or reconstruction changed.
- About is concise; Privacy paragraphs/policy version are unchanged, with clearer headings.

## Accessibility and frontend decisions

Native buttons/links/checkboxes/selects/details; associated labels, named buttons and
aria-expanded/pressed, table scopes, focusable scroll regions, visible focus and non-color status.
Muted text contrast was increased against dark surfaces. Reduced-motion disables smooth CSS
scroll and transitions; radar animation remains disabled. No focus trap/custom keyboard system.
This is a scoped accessibility pass, not a WCAG certification or a screen-reader certification.

React best-practices review guided module-level lazy imports, static dictionary group lookup,
derived display-only state and small shared components. No data-fetch library/framework added.
Removed confidently unused ambient-glow classes; flatter surfaces and smaller heroes reduce noise.
Remaining historical CSS was not wholesale rewritten.

## Performance decision

All secondary pages are module-level lazy routes; Dashboard stays eager. Suspense and a safe
reload boundary cover chunk loads. Recharts remains lazy only on pages that render a radar.
The custom comparison legend avoids the built-in large legend import and protects long names.
No API payload, external asset, dependency, font pack or tracking script added.
Final bundle measurements and public release acceptance are recorded below after verification.

## Browser verification

Local Chrome: all eight key routes at 390 / 768 / 1024 / 1440 CSS px; no page-level overflow.
Mobile navigation open/Escape/return-focus and route-close/main-focus; desktop More Enter/Escape
were exercised. Four-player comparison selection disables additional unchecked players.
Temporary ignored local-only fixture with long handles/tags/display names/map names exercised
Dashboard, ranking, profile, comparison, Synergy and matches; no page overflow at 390 CSS px.
It is not shipped or committed. Long-name testing found and fixed selector/chart-legend overflow.

Actual 200% desktop zoom was manually set with user assistance: normal devicePixelRatio 1.25
became 2.5, CSS viewport 2048 became 1024. All eight key routes loaded without overflow;
mobile disclosure, route change and two-player comparison stayed usable. This was actual
browser zoom, not a CSS transform. Temporary viewport overrides are reset after QA.
No Connect submit, revoke, deletion continuation, provider lookup/import/sync or production
data creation is part of UI acceptance. Non-empty production analytics remain NOT YET EXERCISED.

## Verification / deployment

Final implementation worktree gates: lint exit 0; 20 files / 292 tests passed in 22.89s
(22 new UI tests, prior 270 cases retained); source secret boundary passed.
Build exit 0: 710 modules, 2.91s; dist secret boundary passed. npm audit zero vulnerabilities.
DB validation: 1 file / 15 passed in 15.37s (disposable tests, not production validation).

| Artifact | Before kB / gzip | After kB / gzip |
|---|---:|---:|
| Main | 449.24 / 141.81 | 361.72 / 116.15 |
| CSS | 34.08 / 7.91 | 40.17 / 9.15 |
| ScoreRadar | 1.27 / 0.86 | 1.25 / 0.86 |
| ComparisonRadar | 16.08 / 5.68 | 1.63 / 0.96 |
| Shared chart dependency | 339.53 / 99.68 | 339.21 / 99.53 |

Main JS fell 19.48% (gzip 18.09%); CSS added 6.09 kB / 1.24 kB gzip for responsive,
focus and shared status rules. No >10% initial-JS regression.
Route chunks kB / gzip: Compare 6.81 / 2.89; Synergy 19.16 / 7.01;
Profile 13.03 / 4.87; Dictionary 5.53 / 2.32; Connect 18.18 / 6.22.
Chart dependency is still sizeable but stays lazy; no risky bundler optimization.

Implementation release f986f0a200427b69f51a0a4cb147dccaf42c89f8 was pushed with
checkpoint-before-ui-01. Acceptance:

- CI success: https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37076123365
  (workflow start to completion 127s; verify job 86s).
- Pages success: https://github.com/scottpuppylu/valorant-squad-analytics/actions/runs/37076123390
  (100s; build 83s, deploy 8s).
- Vercel Ready / Production / matching commit, 3m32s:
  https://vercel.com/scottpuppys-projects/valorant-squad-analytics/F2H7snwiUYwJvi5YBpJTdcWLwopu
- Pages https://scottpuppylu.github.io/valorant-squad-analytics/: eight key routes at
  all four requested CSS widths (32 combinations), no page overflow, Demo badge,
  console errors 0. Repository base path and lazy assets work.
- Pages secondary routes maps/agents/about/privacy checked at 390; dictionary group +
  search + formula disclosure and mobile matrix expansion verified.
- Vercel https://valorant-squad-analytics.vercel.app/: eight key routes at all four
  widths (32 combinations), no page overflow, REAL badge, no Demo player, console errors 0.
  Actual public analytical content is empty or one-player Synergy, not non-empty metrics.
- Read-only production dataset HTTP 200: schema 3, mode REAL, isDemo false,
  state empty, 1 visible player / 0 matches, Cache-Control no-store.
- Privacy paragraphs compared to starting HEAD: unchanged. No new unsafe HTML/script,
  secret exposure, package or migration. Existing deployment guard reports database up to date.
- Live Connect/import/sync/revocation flows, non-empty production scores, advanced metrics,
  Synergy and server-runtime log scan: NOT VERIFIED in UI-01. No production mutation performed.

This closure is documentation-only. Its final CI/deployment checks are reported at handoff;
it does not change accepted frontend artifacts. TASK-RELEASE-01 remains NOT STARTED.
