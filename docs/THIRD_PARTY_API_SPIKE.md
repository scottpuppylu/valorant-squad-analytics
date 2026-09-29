# Third-party VALORANT data spike

Decision date: 2026-09-29

## Current status

TASK-002A.1 is **PARTIALLY COMPLETE / CLOSED FOR NOW**.

Completed:

- emoji player identity and browser-local preferences;
- a typed provider response summarizer;
- a dormant consent/key-gated probe script;
- provider, normalization and proxy boundary preparation.

Deferred to `TASK-API-01`:

- a Henrik API key and consenting real account;
- latest-match retrieval;
- normalization of observed real responses;
- a real-data field and nullability audit;
- comparison of documented and observed analytics capability.

No live player-data capability has been verified. This is an intentional deferral, not a task failure. The public application does not require `.env.local`, credentials, consent configuration, a real Riot ID, or network access to HenrikDev.

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
- `scripts/probe-henrik-api.mjs` is a dormant local diagnostic scaffold. It is not imported by the application, is not executed by normal development/build commands, and does not write raw responses.
- Scoring and React components do not import provider DTOs.
- The deployed GitHub Pages application uses only deterministic fictional fixtures.

The repository contains no API key, real Riot ID, consent value, raw response archive, or normalized real-player record.

## Capability status

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

## Future TASK-API-01 gate

Only when TASK-API-01 is explicitly started should the team obtain a provider key, use an explicitly consenting player, retrieve a small latest-match sample and record a non-identifying capability audit. That future task must still avoid committing secrets, identifiers or raw private payloads.

TASK-002B does not wait for this gate. It may proceed using demo evidence while marking unavailable evidence explicitly and keeping every formula transparent.
