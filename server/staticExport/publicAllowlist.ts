/**
 * TASK-INFRA-STATIC-DATA-PUBLISH-01 PUBLIC EXPORT ALLOWLIST (`public-export-allowlist-v1`).
 *
 * The ONLY key paths a public static artifact may contain, per artifact kind. Anything else fails the
 * export (fail closed), including new server fields, until it is reviewed and added here. Every entry is a
 * field of an existing public `/api/valorant/dataset` contract; nothing here is a database row.
 *
 * Syntax: `.`-separated keys; `[]` = array element; `*` = a dynamic key that is itself public data
 * (a map name, a role name, a clutch opponent count). Ids that appear are PUBLIC ids only: member
 * public id (`players[].id`, `playerId`, `memberId`), public account id (`accounts[].id`, `accountId`) and
 * public match id (`matches[].id`, `matchId`, window match ids). Riot `gameName`/`tag` are the consented,
 * already-public account labels.
 */
export const PUBLIC_EXPORT_ALLOWLIST_VERSION = 'public-export-allowlist-v1' as const;

export type PublicArtifactKind = 'dataset' | 'analytics' | 'history' | 'analysis' | 'weapons' | 'index'
  | 'factsMeta' | 'factsSkeletons' | 'factsMatches' | 'factsWeapons';

const under = (prefix: string, fragment: readonly string[]) => fragment.map((path) => `${prefix}.${path}`);
const fields = (prefix: string, names: string) => names.split(/\s+/u).filter(Boolean).map((name) => (prefix ? `${prefix}.${name}` : name));

const account = fields('', 'id gameName tag isPrimary label');
const player = [
  ...fields('', 'id handle displayName nameSource nickname role accent tagline playstyle defaultEmoji'),
  'agents.[]', ...under('accounts.[]', account),
];
const advancedMetrics = [
  ...fields('', 'ruleVersion'),
  ...fields('coverage', 'eligibleRounds reconstructedRounds omittedRounds'),
  ...fields('evidence', 'trade clutch objectives abilityCasts economy impactContext roleValueInputs'),
  ...fields('trade', 'tradeKills tradedDeaths tradeAssists deathsEligibleForTrade tradeKillEvents'),
  ...fields('clutch', 'clutchAttempts clutchWins'), 'clutch.attemptsByOpponents.*', 'clutch.winsByOpponents.*',
  ...fields('objectives', 'plants defuses'),
  ...fields('abilityCasts', 'ability1Casts ability2Casts grenadeCasts ultimateCasts'),
  ...fields('economy', 'loadoutValueTotal loadoutValueAverage spentTotal spentAverage damage kills damagePer1000SpentStatus damagePer1000Spent killsPer1000SpentStatus killsPer1000Spent'),
  ...fields('impactContext', 'openingKills tradeKills manDisadvantageKills clutchStateKills multiKillRounds twoKillRounds threePlusKillRounds roundWonKills'),
];
const performance = [
  ...fields('', 'playerId accountId teamGroup teamWon teamRoundsWon teamRoundsLost agent kills deaths assists acs adr kast headshotPercentage firstKills firstDeaths clutchAttempts clutchWins'),
  ...fields('eventEvidence', 'kast opening'),
  ...under('advancedMetrics', advancedMetrics),
];
const match = [
  ...fields('', 'id playedAt map gameMode opponent scoreFor scoreAgainst won durationMinutes seasonKey'),
  ...under('performances.[]', performance),
  ...fields('synergyEvidence', 'ruleVersion status reconstructedRounds'), 'synergyEvidence.pairs.[].[]',
];
const dataset = [...fields('', 'sourceId isDemo mode'), ...under('players.[]', player), ...under('matches.[]', match)];
const evidence = fields('', 'acs adr headshotPercentage kast firstKills firstDeaths');

const benchmark = fields('', 'metric context poor strong direction version');
const component = [...fields('', 'metric rawValue normalizedValue configuredWeight usedWeight evidenceStatus denominator observedCoverage selectedRole omissionReason'), ...under('benchmark', benchmark)];
const score = [
  ...fields('', 'status value confidence ruleVersion benchmarkVersion'),
  ...fields('coverage', 'availableWeight requiredWeight ratio observedRatio'),
  ...fields('sample', 'matches rounds relevantEvents'),
  ...fields('trace', 'dimension selectedRole profileVersion omissionReason'), 'trace.roles.*',
  ...under('trace.components.[]', component),
  ...fields('trace.prior', 'mean strength wins attempts rawConversion shrunkConversion'),
  ...fields('trace.context', 'abilityCasts positiveSpendObservations'),
  ...fields('trace.dimensions.[]', 'dimension configuredWeight usedWeight status value coverage'),
];
const scoreCategories = ['overall', 'firepower', 'roundImpact', 'entry', 'teamplay', 'clutch', 'economy', 'consistency', 'roleValue'];
const stats = fields('', 'playerId matches rounds wins kills deaths assists acs adr kd kpr apr kast headshotPercentage firstKills firstDeaths fkFd clutchAttempts clutchWins');
const recent = [...fields('', 'matchId playedAt map opponent agent won scoreFor scoreAgainst'), ...under('performance', performance)];
const playerAnalytics = [
  ...under('player', player), ...under('stats', stats), 'scores.confidence',
  ...scoreCategories.flatMap((category) => under(`scores.${category}`, score)), ...under('recent.[]', recent),
];
const group = fields('', 'id label appearances players matches rounds wins winRate acs adr kd kast');
const summary = [
  ...fields('', 'summaryVersion entryCount'), ...under('analytics.[]', playerAnalytics),
  ...['maps', 'agents', 'roles'].flatMap((name) => under(`groups.${name}.[]`, group)), 'mapTopDimension.*',
  'players.[].playerId', ...under('players.[].maps.[]', [...group, 'overall']), ...under('players.[].agents.[]', group),
  ...fields('players.[].accounts.[]', 'accountId appearances'),
];
const sample = [...fields('', 'matches rounds minutes activeDays spanDays from to'), 'seasons.[]'];
const window = [
  ...fields('', 'ruleVersion purpose status'), 'reasons.[]', 'currentMatchIds.[]', 'baselineMatchIds.[]',
  ...under('current', sample), ...under('baseline', [...sample, 'status']),
  ...fields('boundaries', 'seasonCrossed seasonEvidence rankBoundaryUsed rankEvidence'),
  ...fields('confidence', 'sample temporal evidence overall'),
];
const scope = [
  ...fields('', 'scopeRuleVersion featurePolicyVersion modeEligibilityPolicyVersion feature kind status seasonKey fallbackUsed'),
  'queues', 'queues.[]', 'reasons.[]', ...under('sample', sample),
  ...fields('players.[]', 'playerId status'), 'players.[].reasons.[]', ...under('players.[].sample', sample), ...under('players.[].window', window),
];
const pairWindow = [...fields('', 'matches rounds kast kastStatus winRate winRateStatus'), ...under('overall', score)];
const pairMember = [...under('player', player), ...under('paired', pairWindow), ...under('baseline', pairWindow), ...fields('', 'overallLift kastLift agent role')];
const synergyComponent = fields('', 'key status rawDelta shrunkDelta normalized configuredWeight usedWeight range omission');
const synergyIndex = [...fields('', 'status value confidence coverage shrinkFactor'), 'omissions.[]', ...under('components.[]', synergyComponent)];
const synergy = [
  ...synergyIndex, ...fields('', 'ruleVersion benchmarkVersion'),
  ...fields('pair', 'key playerAId playerBId'),
  ...fields('sharedSample', 'matches rounds wins winRate opponentMatches'),
  ...under('playerA', pairMember), ...under('playerB', pairMember),
  ...fields('tradeEvidence', 'status reconstructedRounds aTradedBDeaths bTradedADeaths directPairTrades rate'),
  ...fields('trace', 'sharedMatches baselineA baselineB baselineWinRate priorStrength componentWeightGate'), ...under('trace.index', synergyIndex),
];

const weaponCoverage = [
  ...fields('roundWeapon', 'observed eligible coverage status'), ...fields('killWeapon', 'weaponLabeledKills eligibleKillEvents coverage status'),
  ...fields('loadout', 'observed eligible coverage status'), 'lifetimeComplete',
];
const weaponMetrics = [
  ...fields('', 'weaponKey weaponName category isFirearm observedWeaponRounds observedWeaponRoundShare matchesWithWeaponObservation roundWinsWhenWeaponObserved'),
  ...fields('', 'roundLossesWhenWeaponObserved roundWinRateWhenObserved avgRoundScoreWhenObserved avgLoadoutValueWhenObserved weaponKills weaponKillShare'),
  ...fields('', 'matchesWithWeaponKill weaponKillsPer100PlayedRounds status'), 'reasons.[]',
];
const weaponGroup = [...fields('', 'playedRounds matches'), ...under('coverage', weaponCoverage), ...under('weapons.[]', weaponMetrics)];
const memberWeapons = [...weaponGroup, ...fields('', 'memberId mostUsed mostKills firstAt lastAt')];
const breakdown = [...weaponGroup, ...fields('', 'value status')];

export const PUBLIC_EXPORT_ALLOWLIST: Record<PublicArtifactKind, readonly string[]> = {
  dataset: [
    ...fields('', 'ok schemaVersion state'),
    ...fields('snapshot', 'version generation source projectionVersion identityVersion'),
    ...fields('coverage', 'from to lastSyncedAt completeForProviderWindow boundedMatchLimit lifetimeComplete'),
    ...under('evidence', evidence), ...under('dataset', dataset),
  ],
  analytics: [
    ...fields('', 'ok schemaVersion view analyticsVersion scopeRuleVersion featurePolicyVersion adaptiveWindowVersion'),
    ...fields('population', 'trackedMatchCount snapshotWindow snapshotCoversTrackedHistory lifetimeComplete'),
    ...fields('facets.maps.[]', 'map matches'), 'facets.agents.[]', 'facets.gameModes.[]',
    ...fields('facets.teamOutcome', 'matches wins'), ...fields('facets.competitiveTeamOutcome', 'matches wins'),
    ...fields('modeEligibility', 'policyVersion competitiveMatches unratedMatches otherMatches'),
    ...fields('evidence.season', 'status matchesWithSeasonId matchesWithSeasonShort matchesWithAct matchesWithoutAct seasonIdWithoutPublicAct unrecognizedSeasonCodes currentActKnown latestRecordedAct'),
    ...fields('evidence.season.acts.[]', 'key label matches'),
    ...fields('evidence.duration', 'status matchesWithDuration matchesWithoutDuration'),
    ...fields('evidence.queues.[]', 'gameMode matches'),
    ...fields('evidence.rank', 'status observations reason'),
    ...fields('policies.[]', 'feature horizon queues implementation'), 'policies.[].queues.[]',
  ],
  history: [
    ...fields('', 'ok schemaVersion view historyVersion projectionVersion identityVersion state'),
    // nextCursor is a STATIC page token (`page:0002`); see the semantic exception in privacy.ts.
    ...fields('page', 'limit traversedMatchCount withheldMatchCount from to hasMore nextCursor'),
    ...fields('tracked', 'trackedMatchCount earliestTrackedAt latestTrackedAt lastSyncedAt lifetimeComplete'),
    ...under('evidence', evidence), ...under('dataset', dataset),
  ],
  analysis: [
    ...fields('', 'ok schemaVersion view analysisVersion scopeRuleVersion featurePolicyVersion modeEligibilityPolicyVersion adaptiveWindowVersion scoreVersion synergyVersion feature status improvementVersion'),
    'reasons.[]',
    ...fields('coverage', 'trackedMatchCount populationComplete populationMatches serverHistoryUsed transportSnapshotUsed populationLimit lifetimeComplete'),
    ...fields('population', 'anchor floor seasonStatus rankStatus'), 'population.seasonKeys.[]',
    ...under('scope', scope), ...under('summary', summary), ...under('synergy.[]', synergy),
    'forms.[].playerId', ...under('forms.[].window', window),
    ...fields('progress.[]', 'playerId actPolicy'), ...under('progress.[].window', window),
    ...under('evidence', evidence), ...under('dataset', dataset),
  ],
  weapons: [
    ...fields('', 'ok schemaVersion view feature weaponAnalyticsVersion weaponCatalogVersion modeEligibilityPolicyVersion'),
    ...fields('scope', 'mode status act'), 'scope.reasons.[]', ...fields('scope.context', 'map agent mode'),
    ...under('members.[]', memberWeapons),
    ...under('member', memberWeapons), ...['maps', 'agents', 'acts'].flatMap((name) => under(`member.breakdowns.${name}.[]`, breakdown)),
    ...fields('member.accounts.[]', 'accountId playedRounds weaponObservedRounds weaponLabeledKills'),
    ...['weaponHeadshotPercentage', 'weaponADR', 'weaponDamage', 'weaponAccuracy', 'attackDefenseSplit', 'weaponKillsPerObservedWeaponRound'].flatMap((name) => fields(`unsupported.${name}`, 'status reason')),
    ...fields('calibration', 'usageLabelMinWeaponRounds usageLabelMinMemberRounds killLabelMinWeaponKills killLabelMinMemberKills breakdownMinPlayedRounds weaponMinRounds weaponMinKills fullCoverage'),
  ],
  index: [
    ...fields('', 'schemaVersion snapshotVersion catalogVersion snapshotId dataVersion tier'),
    ...fields('files', 'dataset analytics'), ...fields('history', 'pageSize pages before'), 'facts',
    'analysis.*', 'weapons.*',
  ],
  // public-facts-v1 (src/dataSources/static/publicFacts.ts documents every field and positional tuple).
  factsMeta: [
    ...fields('', 'factSchemaVersion trackedMatchCount'), 'populationEvidence.acts.[]', ...fields('populationEvidence', 'seasonStatus rankStatus'),
    ...under('players.[]', player), ...under('skeletonPlayers.[]', player), 'skeletonFiles.[]',
    ...fields('matchChunks.[]', 'file count'), 'matchChunks.[].first.[]', 'matchChunks.[].last.[]', 'evidenceOnly.[].[]',
    'weapons.memberIds.[]', 'weapons.observedActs.[]', 'weapons.files.[].[]',
  ],
  /** SkeletonTuple: [id, playedAt, map, gameMode, opponent, scoreFor, scoreAgainst, won, durationMinutes, seasonKey, [[memberId, agent]]] */
  factsSkeletons: ['skeletons.[].[].[].[]'],
  /** Full public MatchRecords (the same fragment as every dataset payload) + [roundEvidence, headshotEvidence] flags. */
  factsMatches: [...under('matches.[]', match), 'flags.[].[]'],
  /**
   * WeaponChunk: member public id, [weaponId, weaponName] dictionary, WeaponFactTuple facts with WeaponRoundTuple rounds.
   * weaponId = Riot static weapon content id: non-personal, public-safe (SDD-approved); never a player/account/internal id.
   */
  factsWeapons: ['memberId', 'weapons.[].[]', 'facts.[].[].[].[]'],
};
