const required = [
  'HENRIK_API_KEY',
  'VALORANT_RIOT_NAME',
  'VALORANT_RIOT_TAG',
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function summarize(matches) {
  const players = matches.flatMap((match) => Array.isArray(match.players) ? match.players : []);
  const rounds = matches.flatMap((match) => Array.isArray(match.rounds) ? match.rounds : []);
  const kills = matches.flatMap((match) => Array.isArray(match.kills) ? match.kills : []);
  const roundStats = rounds.flatMap((round) => Array.isArray(round.stats) ? round.stats : []);

  return {
    provider: 'HenrikDev VALORANT API v4',
    queriedAt: new Date().toISOString(),
    matchCount: matches.length,
    playerRows: players.length,
    roundCount: rounds.length,
    killEvents: kills.length,
    coverage: {
      combatTotals: players.some((player) => player?.stats && ['score', 'kills', 'deaths', 'assists'].every((key) => Number.isFinite(player.stats[key]))),
      damageTotals: players.some((player) => Number.isFinite(player?.stats?.damage?.dealt)),
      hitLocations: players.some((player) => ['headshots', 'bodyshots', 'legshots'].every((key) => Number.isFinite(player?.stats?.[key]))),
      abilityCasts: players.some((player) => player?.ability_casts && typeof player.ability_casts === 'object'),
      roundPlayerStats: roundStats.length > 0,
      roundEconomy: roundStats.some((row) => Number.isFinite(row?.economy?.loadout_value)),
      objectiveEvents: rounds.some((round) => round?.plant || round?.defuse),
      killTimeline: kills.length > 0,
    },
  };
}

if (process.env.VALORANT_DATA_CONSENT_CONFIRMED !== 'true') {
  fail('拒絕查詢：請只對已明確同意的玩家執行，並設定 VALORANT_DATA_CONSENT_CONFIRMED=true。');
} else {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    fail(`缺少必要環境變數：${missing.join(', ')}。請勿把 API key 寫入 repository 或命令列參數。`);
  } else {
    const affinity = process.env.VALORANT_AFFINITY || 'ap';
    const platform = process.env.VALORANT_PLATFORM || 'pc';
    const size = Math.min(10, Math.max(1, Number.parseInt(process.env.VALORANT_MATCH_LIMIT || '3', 10) || 3));
    const endpoint = new URL([
      'https://api.henrikdev.xyz/valorant/v4/matches',
      encodeURIComponent(affinity),
      encodeURIComponent(platform),
      encodeURIComponent(process.env.VALORANT_RIOT_NAME),
      encodeURIComponent(process.env.VALORANT_RIOT_TAG),
    ].join('/'));
    endpoint.searchParams.set('size', String(size));

    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: process.env.HENRIK_API_KEY,
          'User-Agent': 'valorant-squad-analytics-data-spike/0.1',
        },
      });
      const payload = await response.json();
      if (!response.ok) {
        const providerMessage = payload?.errors?.[0]?.message || `HTTP ${response.status}`;
        throw new Error(`HenrikDev 查詢失敗：${providerMessage}`);
      }
      if (!Array.isArray(payload?.data)) throw new Error('HenrikDev 回應缺少 data 陣列。');
      console.log(JSON.stringify(summarize(payload.data), null, 2));
    } catch (error) {
      fail(error instanceof Error ? error.message : 'HenrikDev 查詢失敗。');
    }
  }
}
