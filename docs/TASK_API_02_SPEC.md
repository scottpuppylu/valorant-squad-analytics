# TASK-API-02 specification

Status: **PRODUCTION SCAFFOLD DEPLOYED — LIVE VALIDATION BLOCKED ON OPERATOR CREDENTIAL**

Governance: **SDD STRICT**

## Product outcome

A player opens 哥布林大調查, enters a Riot Game Name and Tag, explicitly consents, resolves the account through the application backend, and imports a bounded recent-match sample. The player never supplies or sees the provider credential and is never asked for a Riot password, cookie, MFA code, session token, or developer account.

## Functional requirements

1. Provide a public `#/connect` page in Taiwan Traditional Chinese.
2. Require `gameName`, `tag`, `affinity`, and `consent: true` before account lookup.
3. Default affinity to `ap`; allow `ap`, `eu`, `na`, `kr`, `latam`, and `br`.
4. Resolve the account through `POST /api/valorant/account/resolve` and return only a sanitized profile.
5. Import 10 matches by default and allow 10, 20, or 30. The backend additionally accepts 3 only for the first controlled production validation.
6. Normalize provider responses before they cross into analytics code. Henrik DTOs must not be imported by React or scoring modules.
7. Keep demo and real datasets separate. Persist only the sanitized normalized real dataset in the browser for phase 1.
8. Let the player remove the browser-local real dataset and return to demo mode.
9. Expose `GET /api/valorant/provider/status` with only a usable/unusable result.
10. Preserve every existing TASK-003 route and keep GitHub Pages available as a rollback deployment.

## Security requirements

- `HENRIK_API_KEY` exists only in the server runtime environment.
- Browser code, responses, fixtures, logs, screenshots, and Git must not contain the credential.
- The browser calls only same-origin `/api/*` routes and never calls HenrikDev directly.
- All mutating/provider routes reject missing consent, wrong methods, malformed JSON, invalid identifiers, and unsupported affinity or limits.
- Provider calls have an abort timeout, one bounded retry for transient server/timeout failures, explicit 429 handling, and best-effort per-instance rate limiting.
- Concurrent duplicate imports are rejected while one import for the same caller/account is active.
- Provider and internal errors return a stable public error code and user-safe Chinese message without raw payloads or stack traces.
- Automated tests use injected mock fetch functions and never call a live provider.

## Privacy requirements

- Submitted: Riot Game Name, Tag, selected affinity, and explicit consent.
- Retrieved: the provider account profile and a bounded number of recent matches.
- Returned/stored: sanitized public profile plus normalized analytics fields; no PUUID or raw provider payload.
- Phase 1 retention: browser localStorage only, until the player removes it or clears site data. The server has no database and no durable player-data store.
- Match identifiers returned to the browser are one-way opaque hashes, not provider match IDs.

## Deployment acceptance

The selected production target is Vercel full deployment. GitHub Pages remains active until all of these are verified on Vercel:

- frontend and every current analytical route load;
- provider status endpoint works;
- `HENRIK_API_KEY` is configured through Vercel environment settings and absent from the client bundle;
- one consenting test account resolves;
- three recent matches import and normalize successfully;
- desktop/mobile browser checks and console checks pass.

Without an operator credential, the architecture may be shipped in an honest `API 尚未設定` state. The current production deployment is configured and completed the later bounded audit; this paragraph remains the original rollout rule, not current status.

Current production evidence: the Vercel frontend, analytical routes, mobile layout, same-origin function boundary, configured status and consenting bounded import have been verified at <https://valorant-squad-analytics.vercel.app/>. Sanitized provider evidence is recorded in `docs/REAL_DATA_FIELD_AUDIT.md`; lifetime completeness, a durable database and scheduled synchronization remain unverified or unimplemented.

## Non-goals

- No Henrik key issuance or OAuth flow.
- No Riot passwords, credentials, cookies, or MFA.
- No database in phase 1.
- No lifetime-history import.
- No TASK-002B scoring rewrite, Synergy work, or mixing demo and real rankings.

## Verification plan

- Unit: validation, consent, sanitization, malformed provider payloads, 429, timeout, retry, normalization, storage fallback, and duplicate-import guard.
- Static security: fail if `HENRIK_API_KEY` appears under `src/` or built browser assets.
- Repository: lint, tests, production build, and npm audit.
- Browser: desktop and mobile connect states, consent gate, unavailable provider, loading, sanitized errors, persistence/removal, existing routes, and zero console errors.
- Production: Vercel URL, status function, secret boundary, one account, three matches, and field audit. Live production checks remain opt-in and are never part of `npm test` or CI.
