import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { matchesForSelection, selectPerformances } from '../analytics/filters';
import { gameModeLabels } from '../analytics/presentation';
import { AnalysisFilterBar } from '../components/AnalysisFilterBar';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useDataset } from '../hooks/useDataset';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { formatAcs, formatAdr, formatPercent } from '../utils/format';

const pageSize = 8;

export function MatchesPage() {
  const { analytics: { activeDataset, availableAgents, availableGameModes, availableMaps, performanceEntries } } = useDataset();
  const { filters, update, reset, params, setParams } = useAnalysisFilters();
  const selection = useMemo(() => selectPerformances(performanceEntries, filters), [filters, performanceEntries]);
  const matches = useMemo(() => matchesForSelection(activeDataset.matches, selection), [activeDataset.matches, selection]);
  const requestedPage = Math.max(1, Number(params.get('page')) || 1);
  const pageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  const page = Math.min(requestedPage, pageCount);
  const visible = matches.slice((page - 1) * pageSize, page * pageSize);
  const playerById = new Map(activeDataset.players.map((player) => [player.id, player]));

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
    <AnalysisFilterBar filters={filters} onChange={changeFilters} onReset={reset} players={activeDataset.players} maps={availableMaps} agents={availableAgents} gameModes={availableGameModes} includeSamples={false} />
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
