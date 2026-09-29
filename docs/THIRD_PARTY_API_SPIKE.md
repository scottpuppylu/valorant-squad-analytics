# Third-party VALORANT data spike

Decision date: 2026-09-29

## Historical spike status

TASK-002A.1 is **PARTIALLY COMPLETE / CLOSED FOR NOW**.

Completed:

- emoji player identity and browser-local preferences;
- a typed provider response summarizer;
- a dormant consent/key-gated probe script;
- provider, normalization and proxy boundary preparation.

Moved to the production architecture task `TASK-API-02`:

- a Henrik API key and consenting real account;
- latest-match retrieval;
- normalization of observed real responses;
- a real-data field and nullability audit;
- comparison of documented and observed analytics capability.

This section records the pre-live TASK-002A.1 conclusion. TASK-API-02.1 later completed a bounded consenting structural audit; current observed evidence and limitations now live in `docs/REAL_DATA_FIELD_AUDIT.md`. Normal players still do not need `.env.local`, developer credentials or HenrikDev accounts, and GitHub Pages remains Demo-only.

## Architecture decision

HenrikDev VALORANT API v4 remains the selected candidate for a future, short-lived validation spike because its published documentation describes match-history and match-detail shapes at player, team, round and kill-event grain. It is unofficial, key-gated and consent-sensitive. It is not approved as a production dependency.

Primary documentation retained for future review:

- [HenrikDev authentication documentation](https://docs.henrikdev.xyz/general/auth)
- [HenrikDev v4 match-history schema](https://docs.henrikdev.xyz/api-reference/valorant/get-matches-by-name-v4)
- [HenrikDev project policy and rate-limit notes](https://github.com/Henrik-3/unofficial-valorant-api)
- [Riot VALORANT developer policy](https://developer.riotgames.com/docs/valorant)

Published schemas establish candidates only. They do not verify field presence, nullability, queue variation, remakes, overtime, hidden identities, or whether reconstructed analytics are honest.

## Prepared code boundary

- `src/dataSources/thirdParty/henrikV4.ts` validates provider-shaped envelopes and emits only non-identifying field-coverage counts.
- The retired local probe is no longer part of the active workflow. `server/HenrikDataProvider` is the only live provider client and is reachable only through same-origin Vercel API routes.
- Scoring and React components do not import provider DTOs.
- GitHub Pages uses only deterministic fictional fixtures because it has no server functions. The selected Vercel architecture will host both frontend and backend.

The repository contains no API key, real Riot ID, consent value, raw response archive, or normalized real-player record.

## Capability status at spike time

The `NOT VERIFIED` labels below are retained as historical evidence of what had not yet been tested during this spike. They are superseded for the observed HenrikDev 4.6.0 sample by `docs/REAL_DATA_FIELD_AUDIT.md` and must not be read as current repository status.

| Evidence | Published schema suggests | Current validation status |
|---|---|---|
| Match context | map, queue, season, start and duration | NOT VERIFIED |
| Player combat totals | score, kills, deaths, assists and damage | NOT VERIFIED |
| Hit locations | head, body and leg hits | NOT VERIFIED |
| Team and outcome | team identity, rounds and win state | NOT VERIFIED |
| Kill timeline | round, killer, victim, assists and timestamps | NOT VERIFIED |
| Round economy | loadout and economy values | NOT VERIFIED |
| Objective events | plant and defuse context | NOT VERIFIED |
| Ability casts | cast counts | NOT VERIFIED |
| Trades, KAST and clutch | product-defined reconstruction would be required | NOT VERIFIED |
| Communication, space creation and utility outcome | not established by published schema | NOT AVAILABLE FROM CURRENT EVIDENCE |

The historical credential-free reachability check only returned HTTP 401 for a fictional identifier. It did not retrieve real match data and is not evidence that any analytics field is usable.

## TASK-API-02 production gate

The site operator obtains one provider key externally and configures it only in Vercel. A player then explicitly consents in `#/connect`; the first controlled test resolves one account and imports exactly three matches. Only sanitized evidence may enter `docs/REAL_DATA_FIELD_AUDIT.md`; secrets, Riot IDs, PUUIDs, provider match IDs and raw payloads remain uncommitted.

TASK-002B does not wait for this gate. It may proceed using demo evidence while marking unavailable evidence explicitly and keeping every formula transparent.
