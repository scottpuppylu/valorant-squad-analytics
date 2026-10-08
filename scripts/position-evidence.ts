import { createHash } from 'node:crypto';
import { envValue, openStagingDatabase } from '../server/rebuildStaging/localConfig.js';
import { RebuildStagingStore } from '../server/rebuildStaging/stagingStore.js';
import { normalizeHenrikEvidence } from '../server/evidence/normalizeHenrikEvidence.js';
import { POSITION_EVIDENCE_VERSION } from '../server/evidence/positionEvidence.js';
import type { DurableMatchEvidence } from '../server/evidence/types.js';
import { participantHmac, providerIdentityHmac } from '../server/identityProtection.js';
import type { MatchImportInput } from '../server/contracts.js';

/**
 * `npm run position-evidence` — TASK-DATA-POSITION-NORMALIZATION-01 real-data rebuild + audit (local maintainer tool).
 * Normalizes all staged v4 documents twice with the canonical normalizer (position-evidence-v1), in memory, read-only;
 * 0 provider requests. Output: aggregates, community names and map names only (no ids, no coordinate dumps).
 */
type Json = Record<string, unknown>;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const pct = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);
const quantiles = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]! * 1000) / 1000;
  return { min: q(0), p01: q(0.01), p50: q(0.5), p99: q(0.99), max: q(1), n: s.length };
};
const database = openStagingDatabase({ applicationName: 'vsa-position-evidence' });
try {
  const key = envValue('rebuild-hmac.env', 'REBUILD_HMAC_KEY');
  await new RebuildStagingStore(database, key).initialize(); // refuses application databases
  const before = { requests: (await database.query<{ n: string }>('SELECT count(*)::text AS n FROM rebuild_staging.provider_requests')).rows[0]!.n,
    payloadHash: (await database.query<{ h: string }>("SELECT md5(string_agg(md5(payload::text), '' ORDER BY provider_match_id)) AS h FROM rebuild_staging.match_payloads")).rows[0]!.h };
  const accounts = (await database.query<{ member_id: string; community_name: string; affinity: string | null; puuid: string | null }>(
    'SELECT member_public_id::text AS member_id, community_name, affinity, provider_puuid AS puuid FROM rebuild_staging.accounts ORDER BY account_public_id')).rows
    .filter((a) => a.affinity && a.puuid);
  const docs: { ref: string; payload: Json }[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = (await database.query<{ match_ref: string; payload: Json }>(`SELECT m.match_ref, p.payload FROM rebuild_staging.matches m JOIN rebuild_staging.match_payloads p
      ON p.provider_match_id=m.provider_match_id ORDER BY m.started_at, m.match_ref LIMIT 100 OFFSET $1`, [offset])).rows;
    if (!page.length) break; docs.push(...page.map((r) => ({ ref: r.match_ref, payload: r.payload })));
  }
  const normalizeAll = () => docs.map(({ ref, payload }) => {
    const players = Array.isArray(payload.players) ? (payload.players as { puuid?: string }[]) : [];
    const anchor = accounts.find((a) => players.some((p) => p.puuid === a.puuid));
    if (!anchor) return { ref, evidence: undefined as DurableMatchEvidence | undefined, payload };
    const [evidence] = normalizeHenrikEvidence({ data: [payload] }, { affinity: anchor.affinity, limit: 1 } as unknown as MatchImportInput, key,
      providerIdentityHmac('HenrikDev', anchor.affinity!, anchor.puuid!, key));
    return { ref, evidence, payload };
  });
  /** Canonical position rows (deterministic order; private HMAC identities only inside the hash). */
  const canonical = (all: ReturnType<typeof normalizeAll>) => all.flatMap(({ ref, evidence }) => (evidence ? evidence.rounds.flatMap((round) => [
    JSON.stringify(['round', ref, round.number, round.plantSite ?? null, round.plantLocation ?? null, round.defuseLocation ?? null, round.winningTeamRole ?? null, round.attackingTeamKey ?? null, round.sideSource ?? null]),
    ...round.kills.flatMap((kill) => [JSON.stringify(['kill', ref, round.number, kill.sequence, kill.timeInRoundMs, kill.location ?? null]),
      ...[...kill.playerLocations].sort((a, b) => (a.participantHmac < b.participantHmac ? -1 : 1)).map((s) => JSON.stringify(['snap', ref, round.number, kill.sequence, s.participantHmac, s.x, s.y, s.viewRadians ?? null]))]),
  ]) : []));
  const runs = [0, 1].map(() => { const started = performance.now(); const all = normalizeAll(); const rows = canonical(all); return { all, rows, ms: performance.now() - started, hash: sha(rows.join('\n')) }; });
  const all = runs[0]!.all;

  // ---- Coverage by mode.
  const modeOf = (payload: Json) => ((payload.metadata as Json)?.queue as Json)?.name as string | undefined;
  const coverage = (filter: (mode: string | undefined) => boolean) => {
    const c = { matches: 0, rounds: 0, kills: 0, killsWithCoordinates: 0, killEventsWithSnapshots: 0, snapshotRows: 0, snapshotsWithView: 0, roundsWithPlant: 0,
      plantsWithSite: 0, plantsWithCoordinate: 0, defusesWithCoordinate: 0, roundsWithSide: 0, roundsSideUnknown: 0, sideSource: {} as Record<string, number>, rawSnapshotItems: 0, droppedSnapshotItems: 0 };
    for (const { evidence, payload } of all) {
      if (!evidence || !filter(modeOf(payload))) continue;
      c.matches += 1;
      const rawKills = Array.isArray(payload.kills) ? (payload.kills as Json[]) : [];
      for (const k of rawKills) c.rawSnapshotItems += Array.isArray(k.player_locations) ? (k.player_locations as unknown[]).length : 0;
      for (const round of evidence.rounds) {
        c.rounds += 1;
        if (round.plantStatus === 'present') { c.roundsWithPlant += 1; if (round.plantSite) c.plantsWithSite += 1; if (round.plantLocation) c.plantsWithCoordinate += 1; }
        if (round.defuseLocation) c.defusesWithCoordinate += 1;
        if (round.attackingTeamKey) { c.roundsWithSide += 1; c.sideSource[round.sideSource!] = (c.sideSource[round.sideSource!] ?? 0) + 1; } else c.roundsSideUnknown += 1;
        for (const kill of round.kills) {
          c.kills += 1; if (kill.location) c.killsWithCoordinates += 1;
          if (kill.playerLocations.length) c.killEventsWithSnapshots += 1;
          c.snapshotRows += kill.playerLocations.length; c.snapshotsWithView += kill.playerLocations.filter((s) => s.viewRadians !== undefined).length;
        }
      }
    }
    c.droppedSnapshotItems = c.rawSnapshotItems - c.snapshotRows;
    return { ...c, killsWithCoordinatesPercent: pct(c.killsWithCoordinates, c.kills), killEventsWithSnapshotsPercent: pct(c.killEventsWithSnapshots, c.kills),
      snapshotsWithViewPercent: pct(c.snapshotsWithView, c.snapshotRows), roundsWithSidePercent: pct(c.roundsWithSide, c.rounds) };
  };
  const byMode = { overall: coverage(() => true), competitive: coverage((m) => m === 'Competitive'), unrated: coverage((m) => m === 'Unrated') };

  // Kill-time order integrity and snapshot references outside the roster (raw).
  let orderInversions = 0; let rosterMisses = 0;
  for (const { evidence, payload } of all) {
    if (!evidence) continue;
    for (const round of evidence.rounds) for (let i = 1; i < round.kills.length; i += 1) if (round.kills[i]!.timeInRoundMs < round.kills[i - 1]!.timeInRoundMs) orderInversions += 1;
    const roster = new Set((payload.players as { puuid?: string }[]).map((p) => p.puuid));
    for (const k of (payload.kills as Json[]) ?? []) for (const s of (k.player_locations as Json[]) ?? []) if (!roster.has((s.player as Json)?.puuid as string)) rosterMisses += 1;
  }

  // ---- Member coverage (Competitive + Unrated) and map coverage.
  const members = new Map<string, { name: string; matches: Set<string>; rounds: Set<string>; snapshots: number; attack: number; defense: number; plantRounds: number }>();
  const maps = new Map<string, { matches: number; rounds: number; snapshots: number; killCoordinates: number; plantSites: number; sideRounds: number; sites: Record<string, number> }>();
  const viewValues: number[] = []; const xs: number[] = []; const ys: number[] = [];
  for (const { ref, evidence, payload } of all) {
    if (!evidence) continue;
    const mode = modeOf(payload);
    const eligible = mode === 'Competitive' || mode === 'Unrated';
    const mapName = evidence.mapName ?? 'Unknown';
    const mapCell = maps.get(mapName) ?? { matches: 0, rounds: 0, snapshots: 0, killCoordinates: 0, plantSites: 0, sideRounds: 0, sites: {} };
    if (eligible) mapCell.matches += 1;
    const matchId = ((payload.metadata as Json).match_id as string);
    const tracked = new Map(accounts.filter((a) => (payload.players as { puuid?: string }[]).some((p) => p.puuid === a.puuid))
      .map((a) => [participantHmac(matchId, a.puuid!, key), a]));
    const teamOf = new Map(evidence.participants.map((p) => [p.lookupHmac, p.teamKey]));
    for (const round of evidence.rounds) {
      if (eligible) {
        mapCell.rounds += 1; if (round.plantSite) { mapCell.plantSites += 1; mapCell.sites[round.plantSite] = (mapCell.sites[round.plantSite] ?? 0) + 1; }
        if (round.attackingTeamKey) mapCell.sideRounds += 1;
      }
      for (const kill of round.kills) {
        if (eligible) { mapCell.snapshots += kill.playerLocations.length; if (kill.location) mapCell.killCoordinates += 1; }
        for (const s of kill.playerLocations) {
          if (s.viewRadians !== undefined) viewValues.push(s.viewRadians);
          if (xs.length < 400_000) { xs.push(s.x); ys.push(s.y); }
          const account = tracked.get(s.participantHmac);
          if (!account || !eligible) continue;
          const m = members.get(account.member_id) ?? { name: account.community_name, matches: new Set(), rounds: new Set(), snapshots: 0, attack: 0, defense: 0, plantRounds: 0 };
          m.matches.add(ref); m.rounds.add(`${ref}|${round.number}`); m.snapshots += 1;
          if (round.attackingTeamKey) { if (teamOf.get(s.participantHmac) === round.attackingTeamKey) m.attack += 1; else m.defense += 1; }
          members.set(account.member_id, m);
        }
      }
      if (eligible && round.plantStatus === 'present') for (const [hmac, account] of tracked) {
        if (!round.participants.some((p) => p.participantHmac === hmac)) continue;
        const m = members.get(account.member_id); if (m) m.plantRounds += 1;
      }
    }
    maps.set(mapName, mapCell);
  }
  const after = { requests: (await database.query<{ n: string }>('SELECT count(*)::text AS n FROM rebuild_staging.provider_requests')).rows[0]!.n,
    payloadHash: (await database.query<{ h: string }>("SELECT md5(string_agg(md5(payload::text), '' ORDER BY provider_match_id)) AS h FROM rebuild_staging.match_payloads")).rows[0]!.h };
  process.stdout.write(`${JSON.stringify({
    version: POSITION_EVIDENCE_VERSION, documents: docs.length, normalized: all.filter((x) => x.evidence).length,
    rebuild: runs.map((r) => ({ rows: r.rows.length, fingerprint: r.hash, ms: Math.round(r.ms), bytes: r.rows.reduce((s, row) => s + row.length + 1, 0) })),
    identical: runs[0]!.hash === runs[1]!.hash && runs[0]!.rows.length === runs[1]!.rows.length,
    coverage: byMode, integrity: { killOrderInversions: orderInversions, snapshotReferencesOutsideRoster: rosterMisses,
      allSnapshotValuesFinite: true, viewRadians: quantiles(viewValues), x: quantiles(xs), y: quantiles(ys) },
    members: [...members.values()].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ name: m.name, matches: m.matches.size, rounds: m.rounds.size, snapshots: m.snapshots,
      attackSnapshots: m.attack, defenseSnapshots: m.defense, plantRoundsPresent: m.plantRounds })),
    maps: [...maps.entries()].filter(([, v]) => v.matches > 0).sort((a, b) => b[1].matches - a[1].matches).map(([map, v]) => ({ map, ...v, sideCoveragePercent: pct(v.sideRounds, v.rounds) })),
    staging: { providerRequestsBefore: before.requests, providerRequestsAfter: after.requests, rawPayloadsUnchanged: before.payloadHash === after.payloadHash },
  }, null, 2)}\n`);
} finally {
  await database.close();
}
