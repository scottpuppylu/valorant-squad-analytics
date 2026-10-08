import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CANDIDATE_IDS, candidateScores, percentiles, zScores } from '../src/analytics/internalStrength/candidates';
import { buildEvidenceTable, rankTierBefore, type EvidenceInput, type GroupMember, type MemberEvidence } from '../src/analytics/internalStrength/evidence';
import { evaluatePredictions, orderedMatches, runFold, spearman, splitTime } from '../src/analytics/internalStrength/holdout';
import type { RankEvidence } from '../src/analytics/rank/rankContext';
import { pairMatchesFor } from '../src/analytics/sharedMatch/pairEvidence';
import type { MatchPerformance, MatchRecord } from '../src/types/valorant';

/** TASK-SCORING-INTERNAL-STRENGTH-01 Phase A — synthetic groups only (no network, no database, no real names). */
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGENTS = ['Sova', 'Omen', 'Killjoy', 'Jett', 'Skye'];

/** Deterministic group: member k has skill ∝ k; every match has 3 members drawn round-robin (or all, when small). */
function group(size: number, matchesCount = 60, options: { mode?: (i: number) => string; perMatch?: number } = {}) {
  const matches: MatchRecord[] = [];
  const perMatch = Math.min(options.perMatch ?? 3, size);
  for (let i = 0; i < matchesCount; i += 1) {
    const seats = Array.from({ length: perMatch }, (_, s) => 1 + ((i + s * Math.max(1, Math.floor(size / perMatch))) % size));
    const unique = [...new Set(seats)];
    const performances: MatchPerformance[] = unique.map((member) => {
      const noise = ((i * 7 + member * 13) % 11) - 5;
      return { playerId: id(member), agent: AGENTS[(member + i) % AGENTS.length]!, teamGroup: 'A', teamWon: i % 2 === 0,
        kills: 10 + member * 2 + Math.round(noise / 2), deaths: 16, assists: 5, acs: 150 + member * 15 + noise * 3, adr: 100 + member * 10 + noise * 2 } as MatchPerformance;
    });
    matches.push({ id: `m${i}`, playedAt: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString(), map: 'Ascent', gameMode: options.mode?.(i) ?? 'Competitive',
      opponent: 'x', scoreFor: 13, scoreAgainst: 10, won: i % 2 === 0, durationMinutes: 40, performances });
  }
  const members: GroupMember[] = Array.from({ length: size }, (_, k) => ({ memberId: id(k + 1), accountIds: [account(k + 1)] }));
  const pairs = matches.flatMap((match) => pairMatchesFor(`ref-${match.id}`, match));
  return { members, matches, pairs, rank: [] as RankEvidence[] } satisfies EvidenceInput;
}

const rankRow = (acct: string, effectiveAt: string, tierOrdinal: number | null, kind: RankEvidence['kind'] = 'history'): RankEvidence => ({
  accountId: acct, kind, source: 'test', effectiveAt, ingestedAt: effectiveAt, seasonId: null, seasonShort: null, providerTierId: null, providerTierName: null,
  rr: null, providerElo: null, rrChange: null, matchRef: null, queue: null,
  normalized: tierOrdinal === null ? null : { key: `t${tierOrdinal}`, label: `T${tierOrdinal}`, family: 'Gold', division: 1, tierOrdinal, ranked: true },
} as RankEvidence);

const END = '2026-12-31T00:00:00.000Z';

describe('evidence table', () => {
  it('is deterministic and independent of input order', () => {
    const input = group(5);
    const reversed = { ...input, matches: [...input.matches].reverse(), pairs: [...input.pairs].reverse(), members: [...input.members].reverse() };
    expect(buildEvidenceTable(reversed, END)).toEqual(buildEvidenceTable(input, END));
  });
  it('never uses evidence at or after asOf (no future matches, no future rank)', () => {
    const input = group(4, 40);
    const asOf = input.matches[20]!.playedAt;
    const truncated = { ...input, matches: input.matches.slice(0, 20), pairs: input.pairs.filter((pair) => pair.playedAt < asOf) };
    const withFutureRank = { ...input, rank: [rankRow(account(1), '2026-11-01T00:00:00.000Z', 20), rankRow(account(1), '2026-11-02T00:00:00.000Z', 25, 'current')] };
    expect(buildEvidenceTable(withFutureRank, asOf)).toEqual(buildEvidenceTable(truncated, asOf));
  });
  it('rank context: latest ranked point-in-time tier strictly before asOf; peak / seasonal never used; unranked skipped', () => {
    const rows = [rankRow(account(1), '2026-02-01T00:00:00.000Z', 10), rankRow(account(1), '2026-03-01T00:00:00.000Z', null),
      rankRow(account(1), '2026-01-15T00:00:00.000Z', 24, 'peak'), rankRow(account(1), '2026-04-01T00:00:00.000Z', 12)];
    expect(rankTierBefore(rows, [account(1)], '2026-03-15T00:00:00.000Z')).toEqual({ tier: 10, observations: 1 });
    expect(rankTierBefore(rows, [account(1)], '2026-04-01T00:00:00.000Z').tier).toBe(10); // strictly before
    expect(rankTierBefore([], [account(1)], END)).toEqual({ tier: null, observations: 0 });
  });
  it('multi-account member: rank evidence of every account is merged before the member value', () => {
    const rows = [rankRow(account(1), '2026-02-01T00:00:00.000Z', 10), rankRow(account(2), '2026-03-01T00:00:00.000Z', 14)];
    expect(rankTierBefore(rows, [account(1), account(2)], END)).toEqual({ tier: 14, observations: 2 });
    const input = { ...group(3), rank: rows, members: [{ memberId: id(1), accountIds: [account(1), account(2)] }, { memberId: id(2), accountIds: [account(3)] }, { memberId: id(3), accountIds: [account(4)] }] };
    const table = buildEvidenceTable(input, END);
    expect(table).toHaveLength(3); // one row per PERSON, never one per account
    expect(table.find((row) => row.memberId === id(1))!.rank.tier).toBe(14);
  });
  it('mode policy: absolute evidence is Competitive only; Unrated feeds only Shared-Match; other modes feed nothing', () => {
    const base = group(4, 40);
    const unrated = group(4, 40, { mode: (i) => (i % 4 === 0 ? 'Unrated' : 'Competitive') });
    const deathmatch = group(4, 40, { mode: (i) => (i % 4 === 0 ? 'Deathmatch' : 'Competitive') });
    const competitiveOnly = { ...base, matches: base.matches.filter((_, i) => i % 4 !== 0) };
    const strip = (rows: MemberEvidence[]) => rows.map((row) => row.absolute);
    expect(strip(buildEvidenceTable(unrated, END))).toEqual(strip(buildEvidenceTable({ ...competitiveOnly, pairs: [] }, END)));
    expect(deathmatch.pairs.some((pair) => pair.matchRef.endsWith('m0'))).toBe(false);
    expect(buildEvidenceTable(unrated, END).some((row) => row.shared.unrated !== null)).toBe(true);
  });
});

describe('candidates', () => {
  const table = buildEvidenceTable(group(6, 80), END);
  it('every candidate is deterministic and group-relative (z / percentiles need no fixed group size)', () => {
    for (const candidate of CANDIDATE_IDS) expect([...candidateScores([...table].reverse(), candidate)]).toEqual([...candidateScores(table, candidate)]);
    const z = zScores(table, (row) => row.absolute.acs);
    expect([...z.values()].reduce((sum, value) => sum! + (value ?? 0), 0)).toBeCloseTo(0);
    expect([...percentiles(table, (row) => row.absolute.acs).values()].sort()).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('works for 3-, 5- and 20-member groups, fully connected or sparse', () => {
    for (const size of [3, 5, 20]) {
      const rows = buildEvidenceTable(group(size, size * 12), END);
      expect(rows).toHaveLength(size);
      expect(candidateScores(rows, 'SM').size).toBe(size);
    }
    const sparse = group(20, 60, { perMatch: 2 }); // most of the 190 pairs never share a match
    // Member 21 plays only solo-tracked matches: absolute evidence, no shared-match evidence at all.
    const solo = Array.from({ length: 8 }, (_, i) => ({ ...sparse.matches[i]!, id: `solo${i}`,
      performances: [{ ...sparse.matches[i]!.performances[0]!, playerId: id(21) }] }));
    const rows = buildEvidenceTable({ ...sparse, matches: [...sparse.matches, ...solo], members: [...sparse.members, { memberId: id(21), accountIds: [account(21)] }] }, END);
    expect(rows.filter((row) => row.shared.rating === null).length).toBeGreaterThan(0);
    // A member without Shared-Match evidence is placed by the absolute prior instead of a fabricated 50.
    const scored = candidateScores(rows, 'A_SM_PRIOR_FP');
    const isolated = rows.find((row) => row.memberId === id(21))!;
    expect(isolated.shared.rating).toBeNull();
    expect(isolated.absolute.matches).toBe(8);
    expect(scored.get(id(21)) ?? null).toBe(isolated.absolute.firepower === null ? null : scored.get(id(21)));
    expect(candidateScores(rows, 'SM').get(id(21))).toBeNull();
  });
  it('new member: the empirical-Bayes blend leans on the prior when shared evidence is small (w = n/(n+8))', () => {
    const rows = table.map((row, index) => (index === 0 ? { ...row, shared: { ...row.shared, matches: 2, outperformShare: 1, rating: 60 } } : row));
    const blended = candidateScores(rows, 'A_SM_PRIOR_FP').get(rows[0]!.memberId)!;
    const priorOnly = candidateScores(rows.map((row, index) => (index === 0 ? { ...row, shared: { ...row.shared, matches: 0 } } : row)), 'A_SM_PRIOR_FP').get(rows[0]!.memberId)!;
    // w = 2/10: a 2-match perfect record moves the estimate only 20 % of the way from the prior toward 1.
    expect(blended - priorOnly).toBeCloseTo(0.2 * (1 - priorOnly), 10);
  });
  it('rank ablation: only rank-using candidates react to rank; rank never multiplies a performance value', () => {
    const ranked = table.map((row, index) => ({ ...row, rank: { tier: 25 - index * 3, observations: 5 } }));
    const unranked = table.map((row) => ({ ...row, rank: { tier: null, observations: 0 } }));
    for (const candidate of ['SM', 'FP', 'A_SM_PRIOR_FP', 'C_CONSENSUS_SM_FP', 'SM_RECENT'] as const) expect(candidateScores(ranked, candidate)).toEqual(candidateScores(unranked, candidate));
    expect(candidateScores(ranked, 'B_NO_SM_FP_RANK')).not.toEqual(candidateScores(unranked, 'B_NO_SM_FP_RANK'));
    // Missing rank never blocks a family-consensus score: it is computed from the remaining families.
    expect([...candidateScores(unranked, 'C_CONSENSUS_SM_FP_RANK').values()].every((value) => value !== null)).toBe(true);
    expect([...candidateScores(unranked, 'RANK').values()].every((value) => value === null)).toBe(true);
  });
  it('shared-match and recency ablations change only the candidates that use them', () => {
    const noShared = table.map((row) => ({ ...row, shared: { ...row.shared, rating: null, outperformShare: null, recent: null, competitive: null, unrated: null, matches: 0 } }));
    expect(candidateScores(noShared, 'FP')).toEqual(candidateScores(table, 'FP'));
    expect([...candidateScores(noShared, 'SM').values()].every((value) => value === null)).toBe(true);
    const noRecent = table.map((row) => ({ ...row, absolute: { ...row.absolute, currentFirepower: null }, shared: { ...row.shared, recent: null } }));
    expect(candidateScores(noRecent, 'SM')).toEqual(candidateScores(table, 'SM'));
    expect(candidateScores(noRecent, 'FP')).toEqual(candidateScores(table, 'FP'));
    expect(candidateScores(noRecent, 'A_SM_PRIOR_FP')).toEqual(candidateScores(table, 'A_SM_PRIOR_FP'));
  });
});

describe('holdout', () => {
  const input = group(5, 90);
  it('splits by MATCH time: every unit of one match is on one side, no leakage', () => {
    const split = splitTime(input.pairs, 0.7);
    const sides = new Map<string, Set<boolean>>();
    for (const pair of input.pairs) sides.set(pair.matchRef, (sides.get(pair.matchRef) ?? new Set()).add(pair.playedAt < split));
    expect([...sides.values()].every((set) => set.size === 1)).toBe(true);
    expect(orderedMatches([...input.pairs].reverse())).toEqual(orderedMatches(input.pairs));
  });
  it('training evidence never sees test matches; results are deterministic', () => {
    const split = splitTime(input.pairs, 0.7);
    const fold = { train: split, testFrom: split, testTo: null };
    const result = runFold(input, fold, ['SM', 'FP', 'RANK']);
    expect(result.evidence).toEqual(buildEvidenceTable({ ...input, matches: input.matches.filter((m) => m.playedAt < split), pairs: input.pairs.filter((p) => p.playedAt < split) }, split));
    expect(runFold({ ...input, pairs: [...input.pairs].reverse() }, fold, ['SM', 'FP', 'RANK']).evaluations).toEqual(result.evaluations);
    expect(result.trainMatches + result.testMatches).toBe(orderedMatches(input.pairs).length);
  });
  it('a consistent skill gradient is predicted well out of sample (sanity, synthetic)', () => {
    const split = splitTime(input.pairs, 0.6);
    const result = runFold(input, { train: split, testFrom: split, testTo: null }, ['SM', 'FP']);
    for (const evaluation of result.evaluations) expect(evaluation.accuracy!).toBeGreaterThan(0.7);
  });
  it('neutral targets are reported but never counted as hits or misses; abstentions lower coverage only', () => {
    const split = splitTime(input.pairs, 0.7);
    const result = runFold(input, { train: split, testFrom: split, testTo: null }, ['SM']);
    const predictions = result.predictions.get('SM')!;
    const neutralised = predictions.map((item) => ({ ...item, unit: { ...item.unit, outcome: 'NEUTRAL' as const } }));
    expect(evaluatePredictions('SM', neutralised)).toMatchObject({ decisiveUnits: 0, predicted: 0, accuracy: null });
    const abstain = predictions.map((item) => ({ ...item, predicted: null }));
    expect(evaluatePredictions('SM', abstain)).toMatchObject({ predicted: 0, coverage: 0, accuracy: null });
  });
  it('spearman is order independent and null below three members', () => {
    const x = new Map([['a', 1], ['b', 2], ['c', 3]]); const y = new Map([['c', 30], ['a', 10], ['b', 20]]);
    expect(spearman(x, y)).toBeCloseTo(1);
    expect(spearman(new Map([['a', 1], ['b', 2]]), new Map([['a', 1], ['b', 2]]))).toBeNull();
  });
});

describe('architecture boundary', () => {
  async function files(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
  }
  it('no hard-coded member names, group size, rank multiplier or MMR estimate', async () => {
    for (const file of await files(resolve('src/analytics/internalStrength'))) {
      const source = await readFile(file, 'utf8');
      expect(source, file).not.toMatch(/jack|走路|魔王|滑鏟|天堂|加分|夏天|滑板車|小麻花/u);
      expect(source, file).not.toMatch(/RANK_MULTIPLIER|rankMultiplier|tierOrdinal\s*\*|\*\s*tierOrdinal|MMR_ESTIMATE|ELO_ESTIMATE|\b9\b\s*members/u);
    }
  });
});
