# Project brief

## Goal

Create a static web application for a private group of friends who play VALORANT together. It should explain player performance from several perspectives instead of reducing players to kills or K/D.

This is a transparent community analytics dashboard. It is not an MMR, Elo, official rank, or replacement for Riot's ranked system.

## V1 stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Recharts
- Vitest
- npm
- GitHub Actions and GitHub Pages

V1 must not require a backend or API key. Start with realistic fictional JSON data; later add CSV and JSON import. TASK-002A brings official API capability research and public opt-in/privacy flow prototypes earlier, while live Riot player-data integration remains a later phase requiring Production API approval, RSO and a secure backend.

## Planned pages

1. Dashboard
2. Overall Leaderboard
3. Player Profile
4. Player Comparison
5. Map Analysis
6. Agent and Role Analysis
7. Duo Synergy
8. Match History
9. Data Import
10. Scoring Settings

## Ranking dimensions

- Firepower
- Round Impact
- Entry
- Teamplay
- Clutch
- Economy
- Consistency
- Role Value

## Base statistics

- ACS, ADR, K/D, KPR, APR, KAST, and HS%
- First kills, first deaths, and FK/FD
- Clutch attempts and wins
- Kills, deaths, assists, and rounds played

## Design principles

- Adjust comparisons for role so raw fragging does not dominate every ranking.
- Recognize assists, KAST, trades, survival, utility, entry impact, clutch difficulty, and economy efficiency when data supports them.
- Make overall weights adjustable.
- Show formulas, missing-data behavior, minimum sample rules, and confidence explicitly.
- Keep the interface responsive, dark, and esports-inspired without copying protected visual assets.

## Initial architecture target

```text
src/
  components/
  pages/
  data/
  scoring/
  types/
tests/
docs/
.github/workflows/
```
