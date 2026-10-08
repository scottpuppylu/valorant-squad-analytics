import type { MatchRecord, Player } from '../../types/valorant.js';
import type { ScopeStatus } from '../../analytics/scope/types.js';
import type { PublicWeaponFact } from '../../analytics/weapons/weaponQuery.js';

/**
 * TASK-INFRA-STATIC-QUERY-PARITY-01 PUBLIC FACT MODEL (`public-facts-v1`).
 *
 * The minimum public-safe inputs that let the browser run the SHARED analysis core
 * (src/analytics/analysisCore.ts) and the SHARED weapon query (src/analytics/weapons/weaponQuery.ts) for ANY
 * normal filter combination, exactly like the server:
 *
 *   meta.json          players (projection members), phase-1 members, population evidence, tracked count,
 *                      chunk directory, weapon members / observed Acts
 *   skeletons-NNNN     phase-1 skeletons of ALL eligible history (identity/agent/time/map/mode/Act/score)
 *   matches-NNNN       full public MatchRecords (the same records the API already ships) + per-match evidence
 *                      flags, chunked by (playedAt, id) ascending — only chunks holding selected matches load
 *   weapons-NNNN       one member's weapon participations (rounds/kills as the weapon SQL sees them)
 *
 * Every field is a field of an existing public contract or the exact input of a shared function; no
 * database row, internal id, HMAC, consent, cursor or credential exists here. Encodings below are positional
 * (to keep files small) and decode to the exact objects the shared code consumes; the exporter verifies a
 * lossless round trip for every record.
 */
export const PUBLIC_FACT_SCHEMA_VERSION = 'public-facts-v1' as const;
export const FACT_MATCHES_PER_CHUNK = 200;
export const FACT_SKELETONS_PER_CHUNK = 4000;
/** Weapon participations per file (a member may span several files; keeps files under ~1 MiB at scale). */
export const FACT_WEAPON_FACTS_PER_CHUNK = 1000;

export interface FactsMeta {
  factSchemaVersion: typeof PUBLIC_FACT_SCHEMA_VERSION;
  trackedMatchCount: number;
  populationEvidence: { acts: string[]; seasonStatus: ScopeStatus; rankStatus: ScopeStatus };
  /** Members as the analysis payload ships them (agents from all durable history). */
  players: Player[];
  /** Members as phase-1 resolution sees them (no agent history). */
  skeletonPlayers: Player[];
  skeletonFiles: string[];
  /** Ascending, disjoint (playedAt, id) ranges. */
  matchChunks: { file: string; first: [string, string]; last: [string, string]; count: number }[];
  /** Evidence flags of assembled matches that have no full record (no visible performance). */
  evidenceOnly: [string, 0 | 1, 0 | 1][];
  /** `files`: [memberId, file] — a member may have several files (in participation order). */
  weapons: { memberIds: string[]; observedActs: string[]; files: [string, string][] };
}

/** [id, playedAt, map, gameMode, opponent, scoreFor, scoreAgainst, won, durationMinutes, seasonKey|null, [[playerId, agent]…]] */
export type SkeletonTuple = [string, string, string, string, string, number, number, 0 | 1, number, string | null, [string, string][]];
export interface SkeletonChunk { skeletons: SkeletonTuple[] }
export interface MatchChunk { matches: MatchRecord[]; flags: [0 | 1, 0 | 1][] }

const zeroStats = { kills: 0, deaths: 0, assists: 0, acs: 0, adr: 0 } as const;

export function encodeSkeleton(match: MatchRecord): SkeletonTuple {
  return [match.id, match.playedAt, match.map, match.gameMode, match.opponent, match.scoreFor, match.scoreAgainst, match.won ? 1 : 0,
    match.durationMinutes, match.seasonKey ?? null, match.performances.map((performance) => [performance.playerId, performance.agent])];
}

/** Exactly the skeleton MatchRecord the server's phase 1 builds (stats are zero; never scored). */
export function decodeSkeleton([id, playedAt, map, gameMode, opponent, scoreFor, scoreAgainst, won, durationMinutes, seasonKey, performances]: SkeletonTuple): MatchRecord {
  return {
    id, playedAt, map, gameMode, opponent, scoreFor, scoreAgainst, won: won === 1, durationMinutes,
    ...(seasonKey ? { seasonKey } : {}),
    performances: performances.map(([playerId, agent]) => ({ playerId, agent, ...zeroStats })),
  };
}

type Status = 'observed' | 'missing' | 'unavailable';
const statusCode: Record<Status, 'o' | 'm' | 'u'> = { observed: 'o', missing: 'm', unavailable: 'u' };
const statusOf: Record<'o' | 'm' | 'u', Status> = { o: 'observed', m: 'missing', u: 'unavailable' };

/** Round: [won 1|0|null, weaponStatus, weapon#, loadoutStatus, loadoutValue|null, statsStatus, score|null] */
export type WeaponRoundTuple = [1 | 0 | null, 'o' | 'm' | 'u', number, 'o' | 'm' | 'u', number | null, 'o' | 'm' | 'u', number | null];
/** Fact: [accountId, matchId, map, agent, act|null, startedAt, gameMode, nullFlags(1=map,2=agent), rounds, kill weapon#s] */
export type WeaponFactTuple = [string, string, string, string, string | null, string, string, number, WeaponRoundTuple[], number[]];
/**
 * `weapons`: the [weaponId, weaponName] dictionary of the chunk.
 *
 * weaponId = Riot STATIC weapon / game-content identifier (the same value for every player; a game asset id).
 * Non-personal and public-safe (SDD-approved, TASK-INFRA-STATIC-PUBLICATION-CHANNEL-01). It must NEVER carry a
 * player, account, provider-account or internal database identity — the exporter fails closed when a weapon id
 * equals any member / account / match public id, and the database cross-check rejects internal row ids.
 */
export interface WeaponChunk { memberId: string; weapons: [string | null, string | null][]; facts: WeaponFactTuple[] }

/** Throws when a weapon content id collides with a public member / account / match identity. */
export function assertWeaponIdsAreContentIds(chunk: WeaponChunk, publicIdentities: ReadonlySet<string>) {
  for (const [weaponId] of chunk.weapons) {
    if (weaponId !== null && publicIdentities.has(weaponId.toLowerCase())) throw new Error('weaponId must be a static weapon content id, never a member, account or match identity.');
  }
}

export function encodeWeaponFacts(memberId: string, facts: PublicWeaponFact[]): WeaponChunk {
  const weapons: [string | null, string | null][] = [];
  const index = new Map<string, number>();
  const ref = (id: string | null | undefined, name: string | null | undefined) => {
    const key = JSON.stringify([id ?? null, name ?? null]);
    let position = index.get(key);
    if (position === undefined) { position = weapons.length; weapons.push([id ?? null, name ?? null]); index.set(key, position); }
    return position;
  };
  return {
    memberId, weapons,
    facts: facts.map((fact): WeaponFactTuple => {
      if (fact.memberId !== memberId) throw new Error('weapon fact member mismatch');
      return [fact.accountId, fact.matchId, fact.map, fact.agent, fact.act ?? null, fact.startedAt, fact.gameMode, (fact.mapNull ? 1 : 0) | (fact.agentNull ? 2 : 0),
        fact.rounds.map((round): WeaponRoundTuple => [round.won === null ? null : round.won ? 1 : 0, statusCode[round.weaponStatus], ref(round.weaponId, round.weaponName),
          statusCode[round.loadoutStatus], round.loadoutValue ?? null, statusCode[round.statsStatus], round.score ?? null]),
        fact.kills.map((kill) => ref(kill.weaponId, kill.weaponName))];
    }),
  };
}

export function decodeWeaponFacts(chunk: WeaponChunk): PublicWeaponFact[] {
  const weapon = (position: number) => {
    const pair = chunk.weapons[position];
    if (!pair) throw new Error('weapon reference out of range');
    return pair;
  };
  return chunk.facts.map(([accountId, matchId, map, agent, act, startedAt, gameMode, nulls, rounds, kills]): PublicWeaponFact => ({
    memberId: chunk.memberId, accountId, matchId, map, agent, ...(act !== null ? { act } : {}), startedAt,
    rounds: rounds.map(([won, weaponStatus, ref, loadoutStatus, loadoutValue, statsStatus, score]) => {
      const [weaponId, weaponName] = weapon(ref);
      return { won: won === null ? null : won === 1, weaponStatus: statusOf[weaponStatus], weaponId, weaponName, loadoutStatus: statusOf[loadoutStatus], loadoutValue, statsStatus: statusOf[statsStatus], score };
    }),
    kills: kills.map((ref) => { const [weaponId, weaponName] = weapon(ref); return { weaponId, weaponName }; }),
    gameMode, ...(nulls & 1 ? { mapNull: true as const } : {}), ...(nulls & 2 ? { agentNull: true as const } : {}),
  }));
}

/** Binary search: the chunk whose (playedAt, id) range holds the key, if any. */
export function chunkFor(chunks: FactsMeta['matchChunks'], playedAt: string, id: string): FactsMeta['matchChunks'][number] | undefined {
  const before = (a: [string, string], b: [string, string]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const chunk = chunks[middle]!;
    if (before([playedAt, id], chunk.first)) high = middle - 1;
    else if (before(chunk.last, [playedAt, id])) low = middle + 1;
    else return chunk;
  }
  return undefined;
}
