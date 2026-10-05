import { describe, expect, it } from 'vitest';
import { DatasetProjectionService } from '../server/dataset/datasetProjectionService';
import type { DatasetProjectionRows } from '../server/dataset/types';
import { isDatasetResponse } from '../src/dataSources/server/datasetContract';
import { aggregatePlayerStats } from '../src/utils/aggregateStats';
import { buildAnalytics } from '../src/data/analytics';
import { groupByAgent, groupByMap } from '../src/analytics/analysis';
import { buildSynergy, defaultSynergyFilters } from '../src/synergy/analytics';
import { dimensions } from '../src/scoring/versions';

// Entirely fictional rows: no production identities, queries, credentials or payloads.
function fixture(kind: 'complete' | 'self' | 'repeat' | 'dead' = 'self', count = 1, players = 1): DatasetProjectionRows {
  const rows: DatasetProjectionRows = { players: [], performances: [], rounds: [], roundParticipants: [], events: [], coverage: null, sqlQueryCount: 6, databaseMs: 0 };
  for (let p = 0; p < players; p++) rows.players.push({ internal_player_id: `player-${p}`, public_id: `public-${p}`, display_name: `Fictional ${p}`, display_tag: 'DEMO', default_emoji: '🤖' });
  for (let m = 0; m < count; m++) {
    const match = `match-${m}`, round = `round-${m}`, a = `a-${m}`, b = `b-${m}`;
    rows.rounds.push({ internal_match_id: match, internal_round_id: round, round_number: 1, winning_team: 'Blue', participants_evidence_status: 'observed', plant_status: 'absent', plant_participant_id: null, defuse_status: 'absent', defuse_participant_id: null });
    for (let p = 0; p < players; p++) rows.performances.push({
      internal_match_id: match, public_match_id: `public-match-${m}`, started_at: new Date(Date.UTC(2026, 8, 29 - m)).toISOString(), map_name: 'Ascent', queue_id: 'competitive', queue_name: 'Competitive', game_length_ms: 60000,
      internal_participant_id: p === 0 ? a : `friend-${m}`, internal_player_id: `player-${p}`, team_key: 'Blue', agent_name: 'Jett', stats_evidence_status: 'observed', kills: 1, deaths: 1, assists: 1, score: 250, damage_dealt: 150, headshots: 1, bodyshots: 1, legshots: 0,
      normalization_version: 'durable-evidence-v2', rounds_evidence_status: 'observed', kills_evidence_status: 'observed', ability_evidence_status: 'observed', ability_1_casts: 1, ability_2_casts: 1, grenade_casts: 0, ultimate_casts: 0, economy_evidence_status: 'observed', loadout_value_total: 3000, loadout_value_average: 3000, spent_total: 3000, spent_average: 3000,
      team_won: true, rounds_won: 1, rounds_lost: 0,
    });
    for (const [id, team] of [[a, 'Blue'], [b, 'Red'], ...(players > 1 ? [[`friend-${m}`, 'Blue']] : [])]) rows.roundParticipants.push({ internal_round_id: round, internal_participant_id: id!, team_key: team!, present: true });
    const pairs = kind === 'complete' ? [[a, b]] : kind === 'self' ? [[b, b]] : kind === 'repeat' ? [[a, b], [a, b]] : [[a, b], [b, a]];
    pairs.forEach(([killer, victim], index) => rows.events.push({ internal_match_id: match, internal_round_id: round, event_sequence: index, time_in_round_ms: 1000 + index * 1000, killer_participant_id: killer!, victim_participant_id: victim!, killer_team_key: killer === a ? 'Blue' : 'Red', assistant_participant_id: null }));
  }
  return rows;
}
const project = (rows: DatasetProjectionRows) => new DatasetProjectionService({ readProjectionRows: async () => rows, readHistoryPage: async () => { throw new Error('unused'); } }).read();

describe('approved basic / advanced evidence decoupling', () => {
  it.each(['self', 'repeat', 'dead'] as const)('retains basic stats with %s topology without inventing event values', async (kind) => {
    const { payload } = await project(fixture(kind));
    expect(payload.state).toBe('ready');
    expect(isDatasetResponse(payload)).toBe(true);
    const p = payload.dataset.matches[0]!.performances[0]!;
    expect(p).toMatchObject({ kills: 1, deaths: 1, assists: 1, acs: 250, adr: 150, headshotPercentage: .5, eventEvidence: { kast: 'partial', opening: 'partial' } });
    for (const key of ['kast', 'firstKills', 'firstDeaths']) expect(p).not.toHaveProperty(key);
    expect(p.advancedMetrics?.evidence).toMatchObject({ trade: 'unavailable', clutch: 'partial', impactContext: 'partial', economy: 'derived', abilityCasts: 'derived' });
    expect(p.advancedMetrics?.economy?.spentTotal).toBe(3000);
    expect(payload.evidence).toMatchObject({ kast: 'partial', firstKills: 'partial', firstDeaths: 'partial' });
  });
  it.each(['kills', 'deaths', 'assists', 'score', 'damage_dealt'] as const)('still omits missing required %s', async (key) => {
    const rows = fixture(); rows.performances[0]![key] = null;
    expect((await project(rows)).payload.dataset.matches).toHaveLength(0);
  });
  it('does not let duplicate presence rows conceal a missing durable round', async () => {
    const rows = fixture(); rows.rounds.push({ ...rows.rounds[0]!, internal_round_id: 'missing-round', round_number: 2 });
    rows.roundParticipants.push({ ...rows.roundParticipants[0]! });
    expect((await project(rows)).payload.dataset.matches).toHaveLength(0);
  });
  it('requires explicit true presence, not just a participant row', async () => {
    const rows = fixture(); rows.roundParticipants[0]!.present = false;
    expect((await project(rows)).payload.dataset.matches).toHaveLength(0);
  });
  it('keeps another complete visible player in the shared match', async () => {
    const rows = fixture('self', 1, 2); rows.roundParticipants = rows.roundParticipants.filter(p => p.internal_participant_id !== 'a-0');
    const result = await project(rows);
    expect(result.payload.dataset.matches[0]!.performances.map(p => p.playerId)).toEqual(['public-1']);
  });
  it('preserves complete reconstructed values and legitimate opening zero', async () => {
    const p = (await project(fixture('complete'))).payload.dataset.matches[0]!.performances[0]!;
    expect(p).toMatchObject({ kast: 1, firstKills: 1, firstDeaths: 0, eventEvidence: { kast: 'reconstructed', opening: 'reconstructed' } });
  });
  it('preserves measured zero KAST and HS with complete evidence', async () => {
    const rows = fixture('complete'); const e = rows.events[0]!; [e.killer_participant_id, e.victim_participant_id] = [e.victim_participant_id, e.killer_participant_id];
    Object.assign(rows.performances[0]!, { kills: 0, assists: 0, headshots: 0, bodyshots: 0, legshots: 0 });
    const p = (await project(rows)).payload.dataset.matches[0]!.performances[0]!;
    expect(p).toMatchObject({ kast: 0, firstKills: 0, firstDeaths: 1, headshotPercentage: 0 });
  });
  it('omits only incomplete HS and marks its evidence partial', async () => {
    const rows = fixture(); rows.performances[0]!.headshots = null;
    const result = await project(rows);
    expect(result.payload.dataset.matches[0]!.performances[0]).not.toHaveProperty('headshotPercentage');
    expect(result.payload.evidence.headshotPercentage).toBe('partial');
  });
  it('keeps simultaneous measured zero KAST, FK and FD distinct from absence', async () => {
    const rows = fixture('complete');
    rows.roundParticipants.push({ internal_round_id: 'round-0', internal_participant_id: 'other', team_key: 'Blue', present: true });
    const event = rows.events[0]!;
    rows.events = [{ ...event, killer_participant_id: 'b-0', victim_participant_id: 'other' }, { ...event, event_sequence: 1, time_in_round_ms: 2000, killer_participant_id: 'b-0', victim_participant_id: 'a-0' }];
    Object.assign(rows.performances[0]!, { kills: 0, assists: 0 });
    const p = (await project(rows)).payload.dataset.matches[0]!.performances[0]!;
    expect(p).toMatchObject({ kast: 0, firstKills: 0, firstDeaths: 0, eventEvidence: { kast: 'reconstructed', opening: 'reconstructed' } });
  });
  it('retains ten synthetic production-like matches and honest unavailable scores', async () => {
    const rows = fixture('self', 10);
    for (let i = 0; i < 10; i++) {
      const variant = fixture((['self', 'repeat', 'dead'] as const)[i % 3]!);
      rows.events = rows.events.filter(e => e.internal_match_id !== `match-${i}`);
      rows.events.push(...variant.events.map(e => ({ ...e, internal_match_id: `match-${i}`, internal_round_id: `round-${i}`, killer_participant_id: e.killer_participant_id.replace('-0', `-${i}`), victim_participant_id: e.victim_participant_id.replace('-0', `-${i}`) })));
    }
    const result = await project(rows); expect(result.payload.dataset.matches).toHaveLength(10);
    const analytics = buildAnalytics(result.payload.dataset), player = analytics.playerAnalytics[0]!;
    expect(player.stats.kast).toBeUndefined();
    expect(player.scores.firepower.status).toBe('available');
    expect(player.scores.economy.status).toBe('available');
    for (const key of ['entry', 'teamplay', 'consistency', 'roundImpact', 'clutch', 'overall'] as const) {
      expect(player.scores[key].status).toBe('unavailable'); expect(player.scores[key].value).toBeUndefined();
    }
    for (const key of dimensions) expect(player.scores[key].value === undefined || Number.isFinite(player.scores[key].value)).toBe(true);
    expect(groupByMap(analytics.performanceEntries)[0]!.kast).toBeUndefined();
    expect(groupByAgent(analytics.performanceEntries)[0]!.kast).toBeUndefined();
  });
  it('aggregates only reconstructed KAST without losing scoring coverage', async () => {
    const rows = fixture('self', 10); rows.events = rows.events.filter(e => e.internal_match_id !== 'match-0');
    rows.events.push(...fixture('complete').events);
    const { payload } = await project(rows), p = payload.dataset.players[0]!;
    expect(aggregatePlayerStats(p, payload.dataset.matches).kast).toBe(1);
    const scores = buildAnalytics(payload.dataset).playerAnalytics[0]!.scores;
    const kast = scores.teamplay.trace.components.find(c => c.metric === 'kast')!;
    expect(kast.observedCoverage).toBe(.1); expect(kast.normalizedValue).toBeUndefined();
    expect(scores.consistency.value).toBeUndefined();
  });
  it('retains same-team pair identity but not fabricated direct Trade counters', async () => {
    const { payload } = await project(fixture('self', 3, 2));
    expect(payload.dataset.matches[0]!.synergyEvidence).toMatchObject({ status: 'unavailable', pairs: [[0, 1]] });
    const pair = buildSynergy(payload.dataset, defaultSynergyFilters)[0]!;
    expect(pair).toBeDefined(); expect(pair.value).toBeUndefined();
    expect(pair.playerA.paired.kast).toBeUndefined();
  });
  it('changes snapshot content when basic-only performance survives', async () => {
    const rows = fixture(); const retained = (await project(rows)).payload.snapshot.version;
    rows.roundParticipants = [];
    expect((await project(rows)).payload.snapshot.version).not.toBe(retained);
  });
  it.each(['kast', 'opening'] as const)('rejects %s partial status with a fabricated numeric value', async (domain) => {
    const { payload } = await project(fixture()); const p = payload.dataset.matches[0]!.performances[0]!;
    if (domain === 'kast') p.kast = 0; else { p.firstKills = 0; p.firstDeaths = 0; }
    expect(isDatasetResponse(payload)).toBe(false);
  });
  it.each([3, 2, 1])('rejects old schema %i', async (schemaVersion) => {
    const { payload } = await project(fixture()); expect(isDatasetResponse({ ...payload, schemaVersion })).toBe(false);
  });
  it('rejects missing REAL eventEvidence and nonfinite basic/optional values', async () => {
    const { payload } = await project(fixture()); const p = payload.dataset.matches[0]!.performances[0]!;
    delete p.eventEvidence; expect(isDatasetResponse(payload)).toBe(false);
    p.eventEvidence = { kast: 'partial', opening: 'partial' }; p.acs = NaN; expect(isDatasetResponse(payload)).toBe(false);
    p.acs = 250; p.firstKills = Infinity; expect(isDatasetResponse(payload)).toBe(false);
  });
});
