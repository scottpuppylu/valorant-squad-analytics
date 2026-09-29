# Site operator setup

Normal players do not perform these steps and must never be asked for an API key.

## One-time provider setup

1. Obtain a HenrikDev credential through HenrikDev's own dashboard and support process.
2. Open the Vercel project and go to **Settings → Environment Variables**.
3. Add a server-side variable named `HENRIK_API_KEY` for Production. Add it to Preview only when provider access is intentionally needed there.
4. Redeploy the application.
5. Open `/api/valorant/provider/status` and confirm that it reports only `usable: true` and `mode: configured`.

HenrikDev controls credential issuance. 哥布林大調查 cannot issue, rotate, recover, or authenticate HenrikDev keys.

## Rules

- Never prefix the secret with `VITE_`.
- Never paste it into source code, GitHub Actions logs, screenshots, tests, browser localStorage, support messages, or issue trackers.
- Never add the value to `.env.example`.
- Rotate the credential immediately if it is exposed, then redeploy.
- Do not ask players for Riot passwords, cookies, MFA codes, or session tokens.

## Controlled first validation

The first production setup completed a bounded consenting import and sanitized structural audit. Future re-validation must follow the same rule: record only field-level capability evidence in `docs/REAL_DATA_FIELD_AUDIT.md`; never commit the Riot ID, PUUID, provider match IDs, raw payload or credential.
