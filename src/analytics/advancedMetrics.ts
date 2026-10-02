import type {
  AbilityCastMetrics, ClutchBreakdown, ClutchMetrics, EconomyMetrics, ImpactContextMetrics,
  KastMetrics, MetricCoverage, MetricEvidence, MetricEvidenceStatus, ObjectiveMetrics, TradeMetrics,
} from '../types/advancedMetrics';
import type { MatchPerformance } from '../types/valorant';

export interface AggregatedAdvancedMetrics {
  ruleVersion?: string;
  coverage: MetricCoverage;
  trade: MetricEvidence<TradeMetrics>;
  kast: MetricEvidence<KastMetrics>;
  clutch: MetricEvidence<ClutchMetrics>;
  objectives: MetricEvidence<ObjectiveMetrics>;
  abilityCasts: MetricEvidence<AbilityCastMetrics>;
  economy: MetricEvidence<EconomyMetrics>;
  impactContext: MetricEvidence<ImpactContextMetrics>;
}

const emptyBreakdown = (): ClutchBreakdown => ({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });

function addCoverage(values: MetricCoverage[]): MetricCoverage {
  return values.reduce<MetricCoverage>((sum, coverage) => ({
    eligibleRounds: (sum.eligibleRounds ?? 0) + (coverage.eligibleRounds ?? 0),
    reconstructedRounds: (sum.reconstructedRounds ?? 0) + (coverage.reconstructedRounds ?? 0),
    omittedRounds: (sum.omittedRounds ?? 0) + (coverage.omittedRounds ?? 0),
  }), {});
}

function combinedStatus(statuses: MetricEvidenceStatus[], hasValues: boolean): MetricEvidenceStatus {
  if (!hasValues) return 'unavailable';
  if (statuses.some((status) => status === 'partial' || status === 'unavailable')) return 'partial';
  return statuses.every((status) => status === 'derived') ? 'derived' : 'reconstructed';
}

function metric<T>(status: MetricEvidenceStatus, ruleVersion: string, value?: T, coverage?: MetricCoverage): MetricEvidence<T> {
  return { status, ruleVersion, ...(value === undefined ? {} : { value }), ...(coverage ? { coverage } : {}) };
}

export function aggregateAdvancedMetrics(performances: MatchPerformance[]): AggregatedAdvancedMetrics {
  const inputs = performances.flatMap((performance) => performance.advancedMetrics ? [{ performance, advanced: performance.advancedMetrics }] : []);
  const ruleVersion = inputs[0]?.advanced.ruleVersion;
  if (!ruleVersion || inputs.some(({ advanced }) => advanced.ruleVersion !== ruleVersion)) {
    const unavailable = <T>(): MetricEvidence<T> => ({ status: 'unavailable', ruleVersion: 'event-metrics-v1' });
    return { coverage: {}, trade: unavailable(), kast: unavailable(), clutch: unavailable(), objectives: unavailable(), abilityCasts: unavailable(), economy: unavailable(), impactContext: unavailable() };
  }
  const coverage = addCoverage(inputs.map(({ advanced }) => advanced.coverage));
  const values = <K extends 'trade' | 'clutch' | 'objectives' | 'abilityCasts' | 'economy' | 'impactContext'>(key: K) => inputs.flatMap(({ advanced }) => {
    if (advanced[key]) return [advanced[key]!];
    // A complete domain may omit its zero-valued count object in the public contract.
    return advanced.evidence[key] === 'reconstructed' || advanced.evidence[key] === 'derived'
      ? [{} as NonNullable<typeof advanced[K]>] : [];
  });
  const statuses = <K extends keyof typeof inputs[number]['advanced']['evidence']>(key: K) => inputs.map(({ advanced }) => advanced.evidence[key]);
  const tradeValues = values('trade');
  const clutchValues = values('clutch');
  const objectiveValues = values('objectives');
  const abilityValues = values('abilityCasts');
  const economyValues = values('economy');
  const impactValues = values('impactContext');
  const addClutch = (key: 'attemptsByOpponents' | 'winsByOpponents'): ClutchBreakdown => clutchValues.reduce((sum, value) => {
    const breakdown = value[key];
    if (!breakdown) return sum;
    for (const count of [1, 2, 3, 4, 5] as const) sum[count] += breakdown[count] ?? 0;
    return sum;
  }, emptyBreakdown());
  const totalSpent = economyValues.reduce((sum, value) => sum + (value.spentTotal ?? 0), 0);
  const totalDamage = economyValues.reduce((sum, value) => sum + (value.damage ?? 0), 0);
  const totalKills = economyValues.reduce((sum, value) => sum + (value.kills ?? 0), 0);
  const reconstructedRounds = inputs.reduce((sum, { advanced }) => sum + (advanced.coverage.reconstructedRounds ?? 0), 0);
  const qualifiedRounds = inputs.reduce((sum, { advanced, performance }) => sum + performance.kast * (advanced.coverage.reconstructedRounds ?? 0), 0);
  const allClutchWins = inputs.every(({ advanced }) => advanced.evidence.clutch === 'reconstructed');

  return {
    ruleVersion,
    coverage,
    trade: metric(combinedStatus(statuses('trade'), tradeValues.length > 0), ruleVersion, tradeValues.length ? {
      tradeKills: tradeValues.reduce((sum, value) => sum + (value.tradeKills ?? 0), 0),
      tradedDeaths: tradeValues.reduce((sum, value) => sum + (value.tradedDeaths ?? 0), 0),
      tradeAssists: tradeValues.reduce((sum, value) => sum + (value.tradeAssists ?? 0), 0),
      deathsEligibleForTrade: tradeValues.reduce((sum, value) => sum + (value.deathsEligibleForTrade ?? 0), 0),
      tradeKillEvents: tradeValues.reduce((sum, value) => sum + (value.tradeKillEvents ?? 0), 0),
    } : undefined, coverage),
    kast: metric(reconstructedRounds > 0 ? 'reconstructed' : 'unavailable', ruleVersion, reconstructedRounds > 0 ? {
      qualifiedRounds,
      eligibleRounds: reconstructedRounds,
      rate: qualifiedRounds / reconstructedRounds,
    } : undefined, coverage),
    clutch: metric(combinedStatus(statuses('clutch'), clutchValues.length > 0), ruleVersion, clutchValues.length ? {
      clutchAttempts: clutchValues.reduce((sum, value) => sum + (value.clutchAttempts ?? 0), 0),
      attemptsByOpponents: addClutch('attemptsByOpponents'),
      ...(allClutchWins ? { clutchWins: clutchValues.reduce((sum, value) => sum + (value.clutchWins ?? 0), 0), winsByOpponents: addClutch('winsByOpponents') } : {}),
    } : undefined, coverage),
    objectives: metric(combinedStatus(statuses('objectives'), objectiveValues.length > 0), ruleVersion, objectiveValues.length ? {
      plants: objectiveValues.reduce((sum, value) => sum + (value.plants ?? 0), 0),
      defuses: objectiveValues.reduce((sum, value) => sum + (value.defuses ?? 0), 0),
    } : undefined, coverage),
    abilityCasts: metric(combinedStatus(statuses('abilityCasts'), abilityValues.length > 0), ruleVersion, abilityValues.length ? {
      ability1Casts: abilityValues.reduce((sum, value) => sum + (value.ability1Casts ?? 0), 0),
      ability2Casts: abilityValues.reduce((sum, value) => sum + (value.ability2Casts ?? 0), 0),
      grenadeCasts: abilityValues.reduce((sum, value) => sum + (value.grenadeCasts ?? 0), 0),
      ultimateCasts: abilityValues.reduce((sum, value) => sum + (value.ultimateCasts ?? 0), 0),
    } : undefined, coverage),
    economy: metric(combinedStatus(statuses('economy'), economyValues.length > 0), ruleVersion, economyValues.length ? {
      loadoutValueTotal: economyValues.reduce((sum, value) => sum + (value.loadoutValueTotal ?? 0), 0),
      loadoutValueAverage: economyValues.reduce((sum, value) => sum + (value.loadoutValueAverage ?? 0), 0) / economyValues.length,
      spentTotal: totalSpent,
      spentAverage: economyValues.reduce((sum, value) => sum + (value.spentAverage ?? 0), 0) / economyValues.length,
      damage: totalDamage,
      kills: totalKills,
      damagePer1000SpentStatus: totalSpent > 0 ? 'derived' : 'unavailable',
      ...(totalSpent > 0 ? { damagePer1000Spent: 1000 * totalDamage / totalSpent } : {}),
      killsPer1000SpentStatus: totalSpent > 0 ? 'derived' : 'unavailable',
      ...(totalSpent > 0 ? { killsPer1000Spent: 1000 * totalKills / totalSpent } : {}),
    } : undefined, coverage),
    impactContext: metric(combinedStatus(statuses('impactContext'), impactValues.length > 0), ruleVersion, impactValues.length ? {
      openingKills: impactValues.reduce((sum, value) => sum + (value.openingKills ?? 0), 0),
      tradeKills: impactValues.reduce((sum, value) => sum + (value.tradeKills ?? 0), 0),
      manDisadvantageKills: impactValues.reduce((sum, value) => sum + (value.manDisadvantageKills ?? 0), 0),
      clutchStateKills: impactValues.reduce((sum, value) => sum + (value.clutchStateKills ?? 0), 0),
      multiKillRounds: impactValues.reduce((sum, value) => sum + (value.multiKillRounds ?? 0), 0),
      twoKillRounds: impactValues.reduce((sum, value) => sum + (value.twoKillRounds ?? 0), 0),
      threePlusKillRounds: impactValues.reduce((sum, value) => sum + (value.threePlusKillRounds ?? 0), 0),
      roundWonKills: impactValues.reduce((sum, value) => sum + (value.roundWonKills ?? 0), 0),
    } : undefined, coverage),
  };
}
