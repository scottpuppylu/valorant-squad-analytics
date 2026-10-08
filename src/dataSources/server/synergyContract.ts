import type { MatchRecord } from '../../types/valorant.js';
import { isEventMetricRuleVersion } from '../../types/advancedMetrics.js';

const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalInteger = (value: unknown) => value === undefined || integer(value);
const performanceKeys = new Set(['playerId','agent','kills','deaths','assists','acs','adr','kast','eventEvidence','headshotPercentage','firstKills','firstDeaths','clutchAttempts','clutchWins','advancedMetrics','teamGroup','teamWon','teamRoundsWon','teamRoundsLost','accountId']);
const pairKeys = new Set(['ruleVersion','status','reconstructedRounds','pairs']);

/** Reject, rather than retain, malformed identity/topology at the new public boundary. */
export function validSynergyContract(match: MatchRecord, publicPlayerIds: Set<string>): boolean {
  const ids = new Set<string>();
  for (const p of match.performances) {
    if (Object.keys(p).some((key) => !performanceKeys.has(key)) || !publicPlayerIds.has(p.playerId) || ids.has(p.playerId)
      || (p.accountId !== undefined && (typeof p.accountId !== 'string' || p.accountId.length === 0))) return false;
    ids.add(p.playerId);
    if (p.teamGroup !== undefined && p.teamGroup !== 'A' && p.teamGroup !== 'B') return false;
    if (p.teamWon !== undefined && typeof p.teamWon !== 'boolean') return false;
    if (!optionalInteger(p.teamRoundsWon) || !optionalInteger(p.teamRoundsLost)) return false;
    if (typeof p.agent !== 'string' || !p.agent || ![p.kills,p.deaths,p.assists,p.acs,p.adr].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return false;
    if (p.kast !== undefined && (typeof p.kast !== 'number' || !Number.isFinite(p.kast) || p.kast < 0 || p.kast > 1)) return false;
    if (!optionalInteger(p.firstKills) || !optionalInteger(p.firstDeaths)) return false;
    if (p.headshotPercentage !== undefined && (typeof p.headshotPercentage !== 'number' || !Number.isFinite(p.headshotPercentage) || p.headshotPercentage < 0 || p.headshotPercentage > 1)) return false;
  }
  if (match.synergyEvidence === undefined) return true;
  const evidence = match.synergyEvidence;
  if (typeof evidence !== 'object' || evidence === null || Object.keys(evidence).some((key) => !pairKeys.has(key)) || !Array.isArray(evidence.pairs)) return false;
  if (!isEventMetricRuleVersion(evidence.ruleVersion) || !['reconstructed','partial','unavailable'].includes(evidence.status) || !integer(evidence.reconstructedRounds)) return false;
  if (evidence.status === 'reconstructed' && evidence.reconstructedRounds <= 0 || evidence.status === 'unavailable' && evidence.reconstructedRounds !== 0) return false;
  const seen = new Set<string>();
  for (const pair of evidence.pairs) {
    if (!Array.isArray(pair) || ![2,4].includes(pair.length) || !pair.every(integer)) return false;
    const [ai,bi] = pair;
    if (ai >= bi) return false;
    const key = JSON.stringify([ai,bi]);
    if (seen.has(key)) return false;
    seen.add(key);
    const a = match.performances[ai]; const b = match.performances[bi];
    if (!a?.teamGroup || a.teamGroup !== b?.teamGroup) return false;
    if (evidence.status === 'reconstructed' && pair.length !== 4 || evidence.status === 'unavailable' && pair.length !== 2) return false;
  }
  return true;
}
