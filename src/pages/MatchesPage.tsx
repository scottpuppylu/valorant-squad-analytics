import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { createPerformanceEntries, matchesForSelection, selectPerformances } from '../analytics/filters';
import { gameModeLabels } from '../analytics/presentation';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { useTrackedHistory, type TrackedHistory } from '../hooks/useTrackedHistory';
import { formatAcs, formatAdr, formatCount, formatDateTime, formatFullDate, formatPercent } from '../utils/format';

const pageSize = 8;

export function MatchesPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries, population }, loadHistory, snapshot } = useDataset();
  const history = useTrackedHistory({ loadHistory, snapshotMatches: activeDataset.matches, snapshotVersion: snapshot?.version });
  // DATA-03B.1: older tracked matches are browse-only; analytics keep the bounded snapshot.
  const browseDataset = useMemo(() => (history.matches.length === 0 ? activeDataset : {
    ...activeDataset,
    players: [...new Map([...history.players, ...activeDataset.players].map((player) => [player.id, player])).values()],
    matches: [...activeDataset.matches, ...history.matches],
  }), [activeDataset, history.matches, history.players]);
  const browseEntries = useMemo(() => (browseDataset === activeDataset ? performanceEntries : createPerformanceEntries(browseDataset)), [activeDataset, browseDataset, performanceEntries]);
  const browseOptions = useMemo(() => (browseDataset === activeDataset ? { maps: availableMaps, agents: availableAgents, gameModes: availableGameModes } : {
    maps: [...new Set(browseDataset.matches.map((match) => match.map))].sort(),
    agents: [...new Set(browseDataset.matches.flatMap((match) => match.performances.map((performance) => performance.agent)))].sort(),
    gameModes: [...new Set(browseDataset.matches.map((match) => match.gameMode))].sort(),
  }), [activeDataset, availableAgents, availableGameModes, availableMaps, browseDataset]);
  const { filters, update, reset, params, setParams } = useAnalysisFilters();
  // Browse-only: population facts come from the analytics snapshot, never from loaded history pages.
  const selection = useMemo(() => selectPerformances(browseEntries, filters.period === 'current' ? { ...filters, period: 'all' } : filters, { population, lifetimeFeature: 'matchHistory' }), [filters, browseEntries, population]);
  const matches = useMemo(() => matchesForSelection(browseDataset.matches, selection), [browseDataset.matches, selection]);
  const requestedPage = Math.max(1, Number(params.get('page')) || 1);
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const visible = matches.slice((page - 1) * pageSize, page * pageSize);
  const playerById = new Map(browseDataset.players.map((player) => [player.id, player]));

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(params);
    if (nextPage <= 1) next.delete('page'); else next.set('page', String(nextPage));
    setParams(next, { replace: true });
  }

  function changeFilters(patch: Parameters<typeof update>[0]) {
    update(patch);
  }

  return <div className="space-y-9">
    <header className="page-heading"><div><p className="metric-label">出賽紀錄</p><h1>對戰紀錄</h1><p>依日期、地圖、模式與玩家篩選；展開後只呈現資料集確實擁有的玩家表現。</p></div><div className="data-pill"><span /> {matches.length} 場符合</div></header>
    {history.status === 'unavailable' ? null : <HistoryScope history={history} snapshotCount={activeDataset.matches.length} />}
    <AnalysisFilterBar filters={filters} onChange={changeFilters} onReset={reset} players={browseDataset.players} maps={browseOptions.maps} agents={browseOptions.agents} gameModes={browseOptions.gameModes} includeSamples={false} periods={['all', 'act', 'recent10', 'recent30', 'custom']} seasonKeys={population.seasonKeys} />
    {visible.length === 0 ? <div className="empty-panel surface-card">無符合條件的對戰。請調整篩選器。</div> : <section className="match-history" aria-label="對戰清單">
      {visible.map((match) => <details className="surface-card match-detail" key={match.id}>
        <summary>
          <span className={`result-pill ${match.won ? 'result-pill--win' : 'result-pill--loss'}`}>{match.won ? '勝' : '負'}</span>
          <span><strong>{match.map}</strong><small>{new Date(match.playedAt).toLocaleDateString('zh-TW')} · {gameModeLabels[match.gameMode]}</small></span>
          <span><strong>{match.scoreFor}：{match.scoreAgainst}</strong><small>對 {match.opponent} · {match.durationMinutes} 分鐘</small></span>
          <span className="match-expand">查看 {match.performances.length} 位玩家 · {match.performances.slice(0, 2).map((p) => playerById.get(p.playerId)?.handle).filter(Boolean).join("、")}</span>
        </summary>
        <div className="match-roster"><div className="table-scroll" tabIndex={0} role="region" aria-label="對戰玩家表現，可水平捲動"><table className="analysis-summary-table"><thead><tr><th scope="col">玩家</th><th scope="col">特務</th><th scope="col">K / D / A</th><th scope="col">ACS</th><th scope="col">ADR</th><th scope="col">KAST</th><th scope="col">HS%</th><th scope="col">FK / FD</th></tr></thead><tbody>{[...match.performances].sort((a, b) => b.acs - a.acs).map((performance) => { const player = playerById.get(performance.playerId); return player ? <tr key={performance.playerId}><td><Link to={`/players/${player.id}`} className="flex items-center gap-2"><PlayerAvatar player={player} /><strong>{player.handle}</strong></Link></td><td>{performance.agent}</td><td>{performance.kills} / {performance.deaths} / {performance.assists}</td><td>{formatAcs(performance.acs)}</td><td>{formatAdr(performance.adr)}</td><td>{(performance.kast === undefined ? '—' : formatPercent(performance.kast))}</td><td>{performance.headshotPercentage === undefined ? '—' : formatPercent(performance.headshotPercentage)}</td><td>{performance.firstKills ?? '—'} / {performance.firstDeaths ?? '—'}</td></tr> : null; })}</tbody></table></div></div>
      </details>)}
    </section>}
    <nav className="pagination" aria-label="對戰分頁"><button type="button" disabled={page <= 1} onClick={() => goToPage(page - 1)}>上一頁</button><span>第 {page} / {pageCount} 頁</span><button type="button" disabled={page >= pageCount} onClick={() => goToPage(page + 1)}>下一頁</button></nav>
    <p className="sample-warning">此頁沒有虛構逐回合事件、技能或經濟細節；未提供的證據不會補造。</p>
  </div>;
}

function HistoryScope({ history, snapshotCount }: { history: TrackedHistory; snapshotCount: number }) {
  const loaded = snapshotCount + history.matches.length;
  const tracked = history.tracked;
  return <section className="surface-card space-y-3 p-5" aria-label="戰績資料範圍">
    <dl className="grid gap-3 text-sm sm:grid-cols-3">
      <div><dt className="metric-label">分析範圍</dt><dd>最新 {formatCount(snapshotCount)} 場<small className="block text-slate-500">排行榜、評分與搭檔分析只使用此範圍</small></dd></div>
      <div><dt className="metric-label">目前載入範圍</dt><dd>已載入 {formatCount(loaded)} 場<small className="block text-slate-500">最早已載入：{formatFullDate(history.oldestLoadedAt ?? tracked?.earliestTrackedAt)}</small></dd></div>
      <div><dt className="metric-label">已追蹤戰績</dt><dd>{tracked ? `${formatCount(tracked.trackedMatchCount)} 場` : '—'}<small className="block text-slate-500">最早已保存紀錄：{formatFullDate(tracked?.earliestTrackedAt)} · 最近同步時間：{formatDateTime(tracked?.lastSyncedAt)}</small></dd></div>
    </dl>
    <p className="text-sm" role="status">{history.status === 'loading' ? '正在載入較舊戰績…' : history.status === 'error' ? '較舊戰績暫時無法載入；目前顯示的資料不受影響。' : history.hasMore ? '仍有更舊資料可載入。' : '已載入全部已追蹤戰績。'}</p>
    {history.withheldMatchCount > 0 ? <p className="text-sm text-slate-500">有 {formatCount(history.withheldMatchCount)} 場已追蹤戰績因核心證據不完整而未顯示。</p> : null}
    <p className="sample-warning">已追蹤戰績不是完整生涯紀錄；歷史資料持續補齊中。較舊戰績僅供瀏覽，不會改變分析範圍內的分數。</p>
    {history.hasMore || history.status === 'error' ? <button type="button" className="button-secondary" disabled={history.status === 'loading' || !history.nextCursor} onClick={history.loadMore}>載入較舊戰績</button> : null}
  </section>;
}
