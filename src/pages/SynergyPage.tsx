import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { SynergyDetail } from '../components/SynergyDetail';
import { StatusBadge } from '../components/StatusBadge';
import { useDataset } from '../hooks/useDataset';
import { useSynergyDataset } from '../hooks/useScopedAnalysis';
import { buildSynergy, canonicalPair, defaultSynergyFilters } from '../synergy/analytics';
import { formatPercent, formatScore } from '../utils/format';
import { actOptionLabel, compareSeasonKeysDesc } from '../analytics/scope/season';

const dateValue = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : '';

export function SynergyPage() {
  const { dataset: snapshotDataset, analytics: { population } } = useDataset();
  const [params, setParams] = useSearchParams();
  const maps = [...new Set(snapshotDataset.matches.map((m) => m.map))].sort();
  const modes = [...new Set(snapshotDataset.matches.map((m) => m.gameMode))].sort();
  const map = maps.includes(params.get('map') ?? '') ? params.get('map')! : 'all';
  const gameMode = modes.includes(params.get('mode') ?? '') ? params.get('mode')! : 'all';
  const from = dateValue(params.get('from')); const to = dateValue(params.get('to'));
  const act = population.seasonKeys.includes(params.get('act') ?? '') ? params.get('act')! : '';
  const minimum = Number(params.get('min') ?? 0);
  const minimumShared = Number.isSafeInteger(minimum) && minimum >= 0 && minimum <= 300 ? minimum : 0;
  // DATA-03B.2B: pair sample and baselines come from the server pair context over all durable history.
  const pairPopulation = useSynergyDataset({ map, mode: gameMode, ...(act ? { act } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  const dataset = useMemo(() => ({ ...pairPopulation.dataset, players: snapshotDataset.players }), [pairPopulation.dataset, snapshotDataset.players]);
  const results = useMemo(() => buildSynergy(dataset, { ...defaultSynergyFilters, map, gameMode, from, to, ...(act ? { act } : {}) }), [dataset,map,gameMode,from,to,act]);
  const shortlist = results.filter((r) => r.sharedSample.matches >= minimumShared);
  const validId = (id: string | null) => typeof id === 'string' && dataset.players.some((p) => p.id === id) ? id : undefined;
  const a = validId(params.get('a')) ?? shortlist[0]?.pair.playerAId ?? dataset.players[0]?.id;
  const b = [validId(params.get('b')),shortlist[0]?.pair.playerBId,...dataset.players.map((p) => p.id)].find((id) => id && id !== a);
  const lookup = new Map(results.map((r) => [r.pair.key,r]));
  const selected = a && b ? lookup.get(canonicalPair(a,b).key) : undefined;
  function update(values: Record<string, string>) {
    const next = new URLSearchParams();
    for (const [key,value] of Object.entries({ a: a ?? '', b: b ?? '', act, map, mode: gameMode, from, to, min: String(minimumShared), ...values })) {
      if (value !== '' && value !== 'all') next.set(key,value);
    }
    setParams(next, { replace: true });
  }
  function choose(playerAId: string, playerBId: string) {
    update({ a:playerAId,b:playerBId });
    document.getElementById('pair-detail')?.scrollIntoView({ behavior:'smooth',block:'start' });
  }
  const inputClass = 'mt-2 block w-full min-w-0 rounded-lg border border-white/10 bg-slate-900 p-2 text-slate-200';
  return <div className="min-w-0 space-y-8">
    <header className="page-heading"><div><p className="metric-label">共同出賽的樣本內關聯</p><h1>搭檔分析</h1><p>相對於各自其他場次，觀察雙方表現與賽果的差異。</p></div></header>
    <p className="sample-warning">搭檔指數描述共同出賽時的樣本關聯，不代表因果，也不加入個人綜合表現。</p>
    {dataset.isDemo ? <p className="text-sm text-slate-400">虛構示範資料：同隊、對手與補槍證據皆為固定示範，不是真實戰績重建結果。</p> : null}
    {dataset.players.length < 2 ? <EmptyState title="至少需要兩位公開玩家才能分析搭檔" description="同隊共同出賽與雙方其他場次，都是分析所需的樣本。" actions={<Link to="/connect" className="button-secondary">了解加入方式</Link>} /> : <>
      <section className="surface-card grid min-w-0 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="搭檔篩選">
        <label>玩家 A<select aria-label="玩家 A" className={inputClass} value={a} onChange={(e) => update({a:e.target.value,b:e.target.value === b ? dataset.players.find((p) => p.id !== e.target.value)!.id : b!})}>{dataset.players.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
        <label>玩家 B<select aria-label="玩家 B" className={inputClass} value={b} onChange={(e) => update({b:e.target.value})}>{dataset.players.filter((p) => p.id !== a).map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select></label>
        <label>資料範圍<select aria-label="資料範圍" className={inputClass} value={act} onChange={(e) => update({act:e.target.value})}><option value="">全部已追蹤</option>{population.seasonKeys.length === 0 ? <option value="" disabled>指定 Act（目前沒有 Act 資料）</option> : [...population.seasonKeys].sort(compareSeasonKeysDesc).map((key, index) => <option key={key} value={key}>指定 Act：{actOptionLabel(key, index)}</option>)}</select></label>
        <label>地圖<select aria-label="地圖" className={inputClass} value={map} onChange={(e) => update({map:e.target.value})}><option value="all">全部地圖</option>{maps.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>模式<select aria-label="模式" className={inputClass} value={gameMode} onChange={(e) => update({mode:e.target.value})}><option value="all">全部模式</option>{modes.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>開始日期<input aria-label="開始日期" className={inputClass} type="date" value={from} onChange={(e) => update({from:e.target.value})} /></label>
        <label>結束日期<input aria-label="結束日期" className={inputClass} type="date" value={to} onChange={(e) => update({to:e.target.value})} /></label>
        <label>排行最少共同場次<input aria-label="排行最少共同場次" className={inputClass} type="number" min="0" max="300" value={minimumShared} onChange={(e) => update({min:e.target.value})} /></label>
        <button className="button-secondary self-end" type="button" onClick={() => setParams({})}>重設條件</button>
      </section>
      <p className="text-sm text-slate-400">資料範圍（全部已追蹤或指定 Act）、日期、地圖與模式同時套用共同場次及雙方基準（analysis-scope-v1 搭檔情境）；不使用全域特務／角色或最近 N 場篩選，避免拆散配對。</p>
      {pairPopulation.status === 'loading' ? <p className="sample-warning" role="status">正在以伺服器完整已追蹤歷史計算共同場次與雙方基準…</p>
        : pairPopulation.status === 'error' ? <p className="sample-warning" role="alert">伺服器搭檔分析暫時無法取得；為避免改用其他資料範圍，此處不顯示替代結果。</p>
        : <p className="text-sm text-slate-400">{pairPopulation.source === 'server' ? `共同場次與雙方基準由伺服器依完整已追蹤歷史（${pairPopulation.trackedMatchCount ?? '—'} 場）選取，不受瀏覽器 300 場快照限制。` : '示範資料：在瀏覽器內以固定虛構資料計算。'}</p>}
      {pairPopulation.status === 'loading' || pairPopulation.status === 'error' ? null : selected ? <SynergyDetail result={selected} /> : <div id="pair-detail"><EmptyState title="沒有共同同隊樣本" description="請選擇其他搭檔，或放寬日期、地圖與模式條件。" actions={<button type="button" className="button-secondary" onClick={() => setParams({})}>重設條件</button>} /></div>}
      <section><h2 className="mb-4 text-xl text-white">目前樣本搭檔關聯</h2><div className="grid gap-3 md:grid-cols-2">
        {shortlist.map((r) => <button key={r.pair.key} type="button" onClick={() => choose(r.pair.playerAId,r.pair.playerBId)} className="surface-card min-w-0 p-4 text-left">
          <span className="flex flex-wrap items-center gap-2"><PlayerAvatar player={r.playerA.player} /><PlayerAvatar player={r.playerB.player} /><strong>{r.playerA.player.displayName} ＋ {r.playerB.player.displayName}</strong></span>
          <span className="mt-2 flex flex-wrap items-center gap-2">{r.value === undefined ? '資料不足' : `指數 ${formatScore(r.value)}`}<StatusBadge status={r.status} />共同 {r.sharedSample.matches} 場 · 樣本信心 {formatPercent(r.confidence/100)}</span>
        </button>)}
        {!shortlist.length ? <p className="empty-panel">目前條件下沒有符合共同場次門檻的搭檔。</p> : null}
      </div></section>

      <details className="pair-matrix surface-card"><summary>查看完整矩陣</summary>      <section className="min-w-0"><h2 className="mb-4 text-xl text-white">搭檔矩陣</h2>
        <div className="surface-card max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label="可水平捲動的搭檔矩陣">
          <table className="comparison-table"><caption className="p-3 text-left text-sm">同隊共同樣本；點選查看雙向差異。對角線不適用。</caption><thead><tr><th scope="col">玩家</th>{dataset.players.map((p) => <th scope="col" key={p.id}>{p.displayName}</th>)}</tr></thead>
            <tbody>{dataset.players.map((row) => <tr key={row.id}><th scope="row">{row.displayName}</th>{dataset.players.map((column) => {
              const r = row.id === column.id ? undefined : lookup.get(canonicalPair(row.id,column.id).key);
              return <td key={column.id}>{row.id === column.id ? '不適用' : <button type="button" className="text-left" aria-label={`${row.displayName} 與 ${column.displayName}：${r?.value === undefined ? '資料不足' : formatScore(r.value)}，共同 ${r?.sharedSample.matches ?? 0} 場`} onClick={() => choose(row.id,column.id)}>
                <span className="block text-white">{r?.value === undefined ? '資料不足' : formatScore(r.value)}</span><small>{r ? <><StatusBadge status={r.status} /> · {r.sharedSample.matches} 場</> : '沒有共同同隊樣本'}</small></button>}</td>;
            })}</tr>)}</tbody></table>
        </div>
      </section>
</details>
    </>}
  </div>;
}
