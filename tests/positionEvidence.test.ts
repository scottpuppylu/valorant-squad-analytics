import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeHenrikEvidence } from '../server/evidence/normalizeHenrikEvidence';
import { deriveRoundSide, plantSiteLabel, POSITION_EVIDENCE_VERSION } from '../server/evidence/positionEvidence';
import { participantHmac, providerIdentityHmac } from '../server/identityProtection';
import { DurableEvidenceService } from '../server/persistence/durableEvidenceService';
import { PUBLIC_DATASET_PRIVACY_VERSION } from '../shared/privacyPolicy';
import type { MatchImportInput } from '../server/contracts';
import { benchDatabase, type BenchDatabase } from './support/analysisBenchFixture';
import { exportFrom } from './support/staticSnapshotFixture';

/** TASK-DATA-POSITION-NORMALIZATION-01 — fictional v4 documents in the OBSERVED provider shape; no network. */
const KEY = 'test-position-evidence-hmac-key-32-bytes!!';
const blue = ['fx-a', 'fx-b', 'fx-c', 'fx-d', 'fx-e']; const red = ['fx-r1', 'fx-r2', 'fx-r3', 'fx-r4', 'fx-r5'];
const team = (puuid: string) => (blue.includes(puuid) ? 'Blue' : 'Red');
const ref = (puuid: string) => ({ puuid, name: `N-${puuid}`, tag: 'TW', team: team(puuid) });
const snap = (puuid: string, x: number, y: number, view?: number) => ({ player: ref(puuid), location: { x, y }, ...(view === undefined ? {} : { view_radians: view }) });
interface RoundSpec { winner: 'Blue' | 'Red'; role?: string | null; plant?: { site?: string; by: string; x?: number; y?: number }; defuse?: { by: string }; kills: { killer: string; victim: string; t: number; x?: number; y?: number; snaps?: unknown[] }[] }
function v4(id: number, rounds: RoundSpec[], queue = 'competitive') {
  const all = [...blue, ...red];
  return {
    metadata: { match_id: `fictional-position-${id}`, started_at: new Date(Date.UTC(2026, 8, 1) + id * 86_400_000).toISOString(), game_length_in_ms: 1_800_000,
      map: { id: 'm', name: 'Ascent' }, queue: { id: queue, name: queue === 'unrated' ? 'Unrated' : 'Competitive' }, season: { id: '0a1b2c3d-0000-4000-8000-000000000001', short: 'e11a5' } },
    players: all.map((p) => ({ puuid: p, name: `N-${p}`, tag: 'TW', team_id: team(p), agent: { id: 'a', name: 'Sova' },
      stats: { kills: 1, deaths: 1, assists: 0, score: 3000, headshots: 1, bodyshots: 3, legshots: 0, damage: { dealt: 2000, received: 1500 } } })),
    teams: [{ team_id: 'Blue', won: true, rounds: { won: 7, lost: 6 } }, { team_id: 'Red', won: false, rounds: { won: 6, lost: 7 } }],
    rounds: rounds.map((r, i) => ({ id: i + 1, winning_team: r.winner, result: 'Eliminated', ...(r.role !== undefined ? { winning_team_role: r.role } : {}),
      plant: r.plant ? { site: r.plant.site, player: ref(r.plant.by), round_time_in_ms: 40_000, ...(r.plant.x !== undefined ? { location: { x: r.plant.x, y: r.plant.y } } : {}), player_locations: [] } : null,
      defuse: r.defuse ? { player: ref(r.defuse.by), round_time_in_ms: 80_000, location: { x: 1, y: 2 }, player_locations: [] } : null,
      stats: all.map((p) => ({ player: { puuid: p }, stats: { kills: 0, score: 200 } })) })),
    kills: rounds.flatMap((r, i) => r.kills.map((k) => ({ round: i + 1, time_in_round_in_ms: k.t, time_in_match_in_ms: k.t, killer: ref(k.killer), victim: ref(k.victim),
      assistants: [], weapon: { id: 'w', name: 'Vandal' }, ...(k.x !== undefined ? { location: { x: k.x, y: k.y } } : {}), player_locations: k.snaps ?? [] }))),
  };
}
const input = (puuid = 'fx-a') => ({ gameName: `N-${puuid}`, tag: 'TW', affinity: 'ap', limit: 10, consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION }) as unknown as MatchImportInput;
const normalize = (doc: unknown) => normalizeHenrikEvidence({ data: [doc] }, input(), KEY, providerIdentityHmac('HenrikDev', 'ap', 'fx-a', KEY))[0]!;
const hmac = (doc: { metadata: { match_id: string } }, puuid: string) => participantHmac(doc.metadata.match_id, puuid, KEY);

describe('raw contract parsing (position-evidence-v1)', () => {
  const doc = v4(1, [
    { winner: 'Blue', role: 'Attacker', plant: { site: 'B', by: 'fx-c', x: 1234.5, y: -987.25 },
      kills: [{ killer: 'fx-a', victim: 'fx-r1', t: 1000, x: 10.5, y: -20.25, snaps: [snap('fx-a', 1, 2, 1.25), snap('fx-b', 3, 4), snap('fx-a', 99, 99, 0)] },
        { killer: 'fx-r2', victim: 'fx-b', t: 3000, x: 5, y: 6, snaps: [snap('fx-r2', 7, 8, -2.5), { player: { name: 'no-id' }, location: { x: 1, y: 1 } }, { player: ref('fx-c'), location: { x: 'bad', y: 1 } }] }] },
    { winner: 'Red', role: null, kills: [{ killer: 'fx-r3', victim: 'fx-d', t: 500, snaps: [] }] },
  ]);
  const e = normalize(doc);
  it('reads nested player_locations: identity under player, x/y under location, view_radians at the item', () => {
    expect(e.rounds[0]!.kills[0]!.playerLocations).toEqual([
      { participantHmac: hmac(doc, 'fx-a'), x: 1, y: 2, viewRadians: 1.25 },
      { participantHmac: hmac(doc, 'fx-b'), x: 3, y: 4 }, // missing view direction stays absent
    ]); // duplicate snapshot of the same player in one event: first occurrence wins
  });
  it('drops snapshots without identity or finite coordinates; keeps one row per player per event and the same player across events', () => {
    expect(e.rounds[0]!.kills[1]!.playerLocations).toEqual([{ participantHmac: hmac(doc, 'fx-r2'), x: 7, y: 8, viewRadians: -2.5 }]);
    expect(e.rounds[1]!.kills[0]!.playerLocations).toEqual([]);
  });
  it('keeps the kill-event location separate from player snapshots; missing location stays absent', () => {
    expect(e.rounds[0]!.kills[0]!.location).toEqual({ x: 10.5, y: -20.25 });
    expect(e.rounds[1]!.kills[0]!.location).toBeUndefined();
  });
  it('plant site = provider label, plant coordinate losslessly; no plant → nothing', () => {
    expect(e.rounds[0]).toMatchObject({ plantSite: 'B', plantLocation: { x: 1234.5, y: -987.25 } });
    expect(e.rounds[1]!.plantSite).toBeUndefined();
    expect(e.rounds[1]!.plantLocation).toBeUndefined();
    expect(plantSiteLabel('  C ')).toBe('C');
    expect(plantSiteLabel('')).toBeUndefined();
  });
  it('round side from explicit evidence; unknown when none; version stamped', () => {
    expect(e.rounds[0]).toMatchObject({ winningTeamRole: 'Attacker', attackingTeamKey: 'Blue', sideSource: 'winning_team_role' });
    expect(e.rounds[1]!.attackingTeamKey).toBeUndefined();
    expect(e.positionEvidenceVersion).toBe(POSITION_EVIDENCE_VERSION);
  });
  it('is deterministic regardless of snapshot order inside other events and repeated normalization', () => {
    expect(normalize(structuredClone(doc))).toEqual(e);
  });
});

describe('round side derivation', () => {
  const teams = ['Blue', 'Red'];
  it('Defender role → the other team attacks; plant → planter attacks; defuse → defuser defends', () => {
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Blue', winningTeamRole: 'Defender' })).toMatchObject({ attackingTeamKey: 'Red', sideSource: 'winning_team_role' });
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Red', winningTeamRole: null, planterTeam: 'Blue' })).toMatchObject({ attackingTeamKey: 'Blue', sideSource: 'plant' });
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Red', defuserTeam: 'Red' })).toMatchObject({ attackingTeamKey: 'Blue', sideSource: 'defuse' });
  });
  it('never from the winner alone; conflicting evidence or a non-two-team match stays unknown', () => {
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Blue' }).attackingTeamKey).toBeUndefined();
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Blue', winningTeamRole: 'Attacker', planterTeam: 'Red' })).toMatchObject({ conflict: true });
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Blue', winningTeamRole: 'Attacker', planterTeam: 'Red' }).attackingTeamKey).toBeUndefined();
    expect(deriveRoundSide({ teamKeys: ['t1', 't2', 't3'], winningTeam: 't1', winningTeamRole: 'Attacker' }).attackingTeamKey).toBeUndefined();
    expect(deriveRoundSide({ teamKeys: teams, winningTeam: 'Blue', winningTeamRole: 'None' }).winningTeamRole).toBeUndefined();
  });
});

describe('durable write path (PGlite = real PostgreSQL)', () => {
  const open: BenchDatabase[] = [];
  afterEach(async () => { while (open.length) await open.pop()!.close(); });
  const doc = v4(7, [
    { winner: 'Blue', role: 'Attacker', plant: { site: 'A', by: 'fx-b', x: 100, y: 200 },
      kills: [{ killer: 'fx-a', victim: 'fx-r1', t: 1000, x: 1, y: 2, snaps: [snap('fx-a', 1, 2, 0.5), snap('fx-r2', 5, 6, 3)] },
        { killer: 'fx-a', victim: 'fx-r2', t: 2000, x: 3, y: 4, snaps: [snap('fx-a', 9, 9, 0.75), snap('fx-ghost-not-in-match', 0, 0, 0)] }] },
    { winner: 'Red', role: 'Attacker', defuse: undefined, kills: [{ killer: 'fx-r1', victim: 'fx-a', t: 900, x: 0, y: 0, snaps: [] }] },
  ]);
  async function persisted() {
    const db = await benchDatabase(); open.push(db);
    const durable = new DurableEvidenceService(db, KEY);
    const connection = { gameName: 'N-fx-a', tag: 'TW', affinity: 'ap', consent: true, privacyVersion: PUBLIC_DATASET_PRIVACY_VERSION } as const;
    const a = await durable.persistConnection(connection, 'fx-a', '2026-08-01T00:00:00.000Z');
    const write = () => durable.persistMatches({ ...connection, playerId: a.publicPlayerId!, limit: 10 }, { status: 200, data: [doc] });
    await write();
    return { db, write };
  }
  const snapshotRows = (db: BenchDatabase) => db.query<Record<string, unknown>>(`SELECT k.event_sequence, k.time_in_round_ms, l.location_x::text AS x, l.location_y::text AS y, l.view_radians::text AS view,
    mp.participant_lookup_hmac AS who FROM event_player_locations l JOIN kill_events k ON k.id=l.kill_event_id JOIN match_participants mp ON mp.id=l.match_participant_id
    ORDER BY k.time_in_round_ms, mp.participant_lookup_hmac`);
  it('persists snapshots with view direction, plant site / coordinate, side and version; drops a reference to an unknown player', async () => {
    const { db } = await persisted();
    const rows = (await snapshotRows(db)).rows;
    expect(rows).toHaveLength(3); // the ghost reference is dropped; the same player appears in two events
    expect(rows.map((r) => [r.x, r.y, r.view])).toEqual(expect.arrayContaining([['1', '2', '0.5'], ['5', '6', '3'], ['9', '9', '0.75']]));
    const rounds = (await db.query<Record<string, unknown>>(`SELECT round_number, plant_site, plant_location_x::text AS px, plant_location_y::text AS py, winning_team_role, attacking_team_key, side_source
      FROM rounds ORDER BY round_number`)).rows;
    expect(rounds).toEqual([
      { round_number: 1, plant_site: 'A', px: '100', py: '200', winning_team_role: 'Attacker', attacking_team_key: 'Blue', side_source: 'winning_team_role' },
      { round_number: 2, plant_site: null, px: null, py: null, winning_team_role: 'Attacker', attacking_team_key: 'Red', side_source: 'winning_team_role' },
    ]);
    expect((await db.query<{ v: string }>('SELECT position_evidence_version AS v FROM source_matches')).rows[0]!.v).toBe(POSITION_EVIDENCE_VERSION);
  });
  it('re-importing the same raw match is idempotent (same logical rows, no duplicates)', async () => {
    const { db, write } = await persisted();
    const first = JSON.stringify((await snapshotRows(db)).rows);
    await write();
    expect(JSON.stringify((await snapshotRows(db)).rows)).toBe(first);
    expect(Number((await db.query<{ n: string }>('SELECT count(*)::text AS n FROM rounds')).rows[0]!.n)).toBe(2);
  });
  it('no coordinate, view direction, site or side reaches the public static export', async () => {
    const { db } = await persisted();
    const work = await mkdtemp(join(tmpdir(), 'position-export-'));
    try {
      const exported = await exportFrom(db, join(work, 'export'));
      const files = await readdir(exported.directory, { recursive: true });
      const text = (await Promise.all(files.filter((f) => f.endsWith('.json')).map((f) => readFile(join(exported.directory, f), 'utf8')))).join('\n');
      // The consenting member's public Riot name (N-fx-a) is an allowed public field; raw PUUIDs and other players are not.
      expect(text).not.toMatch(/view_radians|viewRadians|location_x|plant_site|plantSite|attacking_team|winning_team_role|player_locations|"fx-[a-z0-9]+"|N-fx-r|fx-ghost/u);
    } finally { await rm(work, { recursive: true, force: true }); }
  }, 120_000);
});
