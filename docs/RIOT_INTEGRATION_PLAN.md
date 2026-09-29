# Official Riot integration plan

Research date: 2026-09-29

This plan describes readiness only. TASK-002A does not connect accounts, request private player data, or add credentials.

## Official prerequisites

According to Riot's [VALORANT developer documentation](https://developer.riotgames.com/docs/valorant) and [Developer Portal FAQ](https://developer.riotgames.com/docs/faqs):

- Personal API keys are not offered for VALORANT.
- A functioning or substantially testable public product and understandable user flow are expected for a Production key application.
- Player-stat products require each player to opt in.
- VALORANT opt-in uses Riot Sign On (RSO), and RSO access is available only after Production-level approval.
- The public product needs an opt-in disclaimer explaining that linked player data becomes visible in the product's ecosystem.
- Opponent scouting and real-time assistance that changes immediate in-game behavior are not approved use cases.

Riot also requires API keys to remain secret. A public GitHub Pages JavaScript bundle cannot hold a Production key, RSO client secret, refresh token, or access token safely.

## Product position

VALORANT Squad Analytics is an unofficial community performance application. Participating players explicitly opt in to share their own statistics with a friend group/community. Its transparent community scores are not Riot MMR, Elo, official rank, or a matchmaking replacement.

The product must not become:

- opponent scouting before a match;
- a real-time tactical overlay;
- an official-ranking lookalike;
- a way to publish statistics for people who did not opt in.

## Prototype user flow

1. A visitor can understand the product through `#/about`, the demo dashboard and the metric dictionary.
2. The unfinished public connection placeholder remains hidden until an approved integration provides user value.
3. A future approved user chooses **Connect Riot**, leaves the app for official RSO, and returns through a server-side OAuth callback.
4. The server resolves the authenticated account using the official RSO account endpoint and stores the minimum identity link.
5. The player reviews what the friend group can see and explicitly opts in.
6. The server obtains official match data, validates it, converts Riot DTOs into the internal normalized model, and records evidence coverage.
7. The player can unlink/revoke. Future synchronization stops and retention/deletion behavior follows the published privacy policy.

No step may expose credentials or tokens to the GitHub Pages bundle.

## Required future backend

The static frontend must be paired with a secure server-side component that provides:

- HTTPS RSO authorization-code callback and CSRF/state validation;
- secure client-secret and Production API key storage;
- encrypted token storage, rotation, expiry and revocation handling;
- opted-in player identity and visibility records;
- rate-limited Riot API requests, caching and retry policy;
- schema validation and Riot-to-normalized-model adapters;
- consent audit trail, unlink and deletion workflows;
- an authenticated frontend API that returns only data the viewer is allowed to see;
- monitoring for Riot policy/schema changes without silently changing scoring meaning.

GitHub Pages can remain the static presentation tier, but it cannot safely perform these server responsibilities.

## Application-readiness checklist

- [x] Working public demo with fictional data.
- [x] About page with accurate use case and non-affiliation statement.
- [x] Privacy page covering local data and future opt-in/unlink concepts.
- [x] Intended RSO flow documented without exposing an unfinished connection page or fake login in public navigation.
- [x] Transparent metric dictionary and current formula limitations.
- [x] Official endpoint and DTO capability matrix.
- [ ] Production API application and Riot approval.
- [ ] RSO client approval and redirect configuration.
- [ ] Public Terms of Service and finalized Privacy Policy reviewed for the production service.
- [ ] Secure backend, domain, consent store and deletion workflow.
- [ ] Live integration security/privacy review.

Live work remains blocked by official approval, Production API access and RSO. It must not begin as a frontend-only shortcut.

The TASK-002A.1 HenrikDev scaffold is not a replacement for this plan. Live use is deferred to TASK-API-01; it must not become the deployed player-data path or weaken RSO opt-in requirements.
