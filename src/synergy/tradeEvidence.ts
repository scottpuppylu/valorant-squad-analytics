import type { MatchRecord, PairTradeEvidence } from '../types/valorant.js';

/** Expand only in memory; IDs and common coverage are not duplicated on the wire. */
export function pairTradeEvidence(match: MatchRecord): PairTradeEvidence[] {
  const evidence = match.synergyEvidence;
  if (!evidence) return [];
  return evidence.pairs.flatMap(([a,b,aTradedBDeaths,bTradedADeaths]) => {
    const playerAId = match.performances[a]?.playerId; const playerBId = match.performances[b]?.playerId;
    return playerAId && playerBId ? [{playerAId,playerBId,ruleVersion:evidence.ruleVersion,status:evidence.status,
      reconstructedRounds:evidence.reconstructedRounds,aTradedBDeaths,bTradedADeaths}] : [];
  });
}
