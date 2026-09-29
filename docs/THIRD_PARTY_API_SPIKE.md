# Third-party VALORANT data spike

Research and probe date: 2026-09-29

## Decision

HenrikDev VALORANT API v4 is the selected short-lived spike source because its provider documentation publishes match-history and match-detail schemas at player, team, round and kill-event grain. It is unofficial, key-gated and explicitly consent-sensitive. It is not approved as a production dependency.

Primary sources:

- [HenrikDev authentication documentation](https://docs.henrikdev.xyz/general/auth)
- [HenrikDev v4 match-history schema](https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4)
- [HenrikDev project policy and rate-limit notes](https://github.com/Henrik-3/unofficial-valorant-api)
- [Riot VALORANT developer policy](https://developer.riotgames.com/docs/valorant)

The provider requires an API key, asks developers to obtain player consent, and says large analytics projects are not allowed. Riot also requires opt-in for products displaying identifiable player statistics. This spike therefore has a narrower boundary than the future official integration.

## Baseline before TASK-002A.1

- Git: clean `main`, tracking `origin/main`, HEAD `37e335f`.
- `npm run lint`: exit 0.
- `npm test`: exit 0; 2 files and 18 tests passed in 852 ms.
- `npm run build`: exit 0; Vite 7.3.6 transformed 664 modules and built in 2.91 s.
- `npm audit`: exit 0; 0 vulnerabilities.

## Live access probe

A credential-free request was sent to the documented v4 match-history route with a deliberately fictional Riot ID. The service returned HTTP 401 with `Unauthorized`. No real player was queried, no credential was available in the worktree/process environment, and no response was saved.

This confirms the live host and authentication gate, but it does **not** validate real player data. TASK-002A.1 remains incomplete until a consenting player and a locally supplied key produce one successful, non-identifying coverage summary.

## Published v4 evidence coverage

| Evidence | Published v4 field shape | Analytics decision before live verification |
|---|---|---|
| Match context | metadata, map, queue, season, start and duration | Candidate for cohorts and recency |
| Player totals | score, kills, deaths, assists, damage and hit locations | Candidate for ACS, ADR, K/D, KPR, APR and HS% |
| Agent/team/outcome | agent, team ID, team round totals and win | Candidate for agent, role and result splits |
| Kill timeline | round, killer, victim, assistants and timestamps | Candidate for first kills/deaths, trades and alive-state reconstruction |
| Round evidence | player stats, damage events, economy and ability casts | Candidate for round impact, economy and limited utility volume |
| Objective events | plant/defuse player, time, site and location | Candidate for objective context |
| Explicit trade/KAST/clutch labels | not published as authoritative labels | Must remain product-defined reconstructions with coverage |
| Communication/space creation/utility outcome | not established by the schema | Not supportable from this source alone |

Schema documentation establishes possibility, not correctness. A live response must still verify nullability, queue/mode variation, incomplete matches, remakes, overtime, round counts, hidden identities and field consistency.

## Local probe contract

Run only for a player who explicitly agreed to this project using their data. Do not paste a key into chat, source files, shell history or npm arguments. Copy `.env.example` to ignored `.env.local`, then set these values there (or in the process environment):

```text
HENRIK_API_KEY
VALORANT_RIOT_NAME
VALORANT_RIOT_TAG
VALORANT_DATA_CONSENT_CONFIRMED=true
VALORANT_AFFINITY=ap            # optional, defaults to ap
VALORANT_PLATFORM=pc            # optional, defaults to pc
VALORANT_MATCH_LIMIT=3          # optional, clamped to 1..10
```

Then run:

```text
npm run spike:henrik
```

The script sends the key only in the HTTPS `Authorization` header. It prints counts and Boolean field-coverage flags; it does not print Riot IDs, PUUIDs, match IDs or raw payloads and does not write files.

## Gate before TASK-002B

After one consented successful run, record only:

- query timestamp, provider/version, affinity/platform and match count;
- HTTP success and rate-limit metadata if available;
- non-identifying field coverage and observed null/mode caveats;
- whether K/D/A, ACS candidate, ADR, HS%, opening events, economy, trades, KAST and clutch can be calculated honestly;
- fields that remain unavailable or too ambiguous.

Do not import the real player into the public demo, calibrate benchmarks from one player, call this MMR/Elo, or begin TASK-002B until the evidence decision is recorded.
