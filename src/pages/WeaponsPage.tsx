import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, LoadingPanel } from '../components/EmptyState';
import { MemberNickname } from '../components/MemberNickname';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { SectionHeading } from '../components/SectionHeading';
import { useDataset } from '../hooks/useDataset';
import { useWeaponAnalytics } from '../hooks/useWeaponAnalytics';
import { weaponEvidenceLabels, weaponReasonLabels, weaponScopeLabels } from '../analytics/presentation';
import { weaponCategoryLabels } from '../analytics/weapons/catalog';
import type { MemberWeaponSummary, WeaponBreakdownRow, WeaponCoverage, WeaponMetrics, WeaponScopeMode } from '../analytics/weapons/engine';
import { actOptionLabel, compareSeasonKeysDesc, seasonLabel } from '../analytics/scope/season';
import type { Player } from '../types/valorant';
import { formatCount, formatPer100, formatPercent } from '../utils/format';

const inputClass = 'mt-2 block w-full min-w-0 rounded-lg border border-white/10 bg-slate-900 p-2 text-slate-200';
const pct = (value: number | undefined) => (value === undefined ? '—' : formatPercent(value));

function CoverageLine({ coverage }: { coverage: WeaponCoverage }) {
  return <p className="text-xs text-slate-400">
    回合武器證據 {pct(coverage.roundWeapon.coverage)}（{coverage.roundWeapon.observed}/{coverage.roundWeapon.eligible} 回合）·
    擊殺武器證據 {pct(coverage.killWeapon.coverage)}（{coverage.killWeapon.weaponLabeledKills}/{coverage.killWeapon.eligibleKillEvents} 擊殺）·
    經濟證據 {pct(coverage.loadout.coverage)}
  </p>;
}

function WeaponTable({ weapons, selected, onSelect }: { weapons: WeaponMetrics[]; selected?: string; onSelect(key: string): void }) {
  if (weapons.length === 0) return <p className="text-sm text-slate-400">此範圍沒有可用的武器證據（缺少證據不等於 0）。</p>;
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="武器統計表，可水平捲動">
    <table className="comparison-table" aria-label="武器統計">
      <thead><tr><th scope="col">武器</th><th scope="col">類別</th><th scope="col">觀測武器回合</th><th scope="col">使用占比</th><th scope="col">武器擊殺</th>
        <th scope="col">擊殺占比</th><th scope="col">每100回合武器擊殺</th><th scope="col">觀測該武器回合勝率</th><th scope="col">證據</th></tr></thead>
      <tbody>{weapons.map((weapon) => <tr key={weapon.weaponKey} aria-selected={weapon.weaponKey === selected}>
        <th scope="row"><button type="button" className="text-left font-semibold text-white underline-offset-2 hover:underline" onClick={() => onSelect(weapon.weaponKey)}>{weapon.weaponName}</button></th>
        <td>{weaponCategoryLabels[weapon.category]}</td>
        <td>{formatCount(weapon.observedWeaponRounds)}</td><td>{pct(weapon.observedWeaponRoundShare)}</td>
        <td>{formatCount(weapon.weaponKills)}</td><td>{pct(weapon.weaponKillShare)}</td><td>{formatPer100(weapon.weaponKillsPer100PlayedRounds)}</td>
        <td>{pct(weapon.roundWinRateWhenObserved)}</td>
        <td><span title={weapon.reasons.map((reason) => weaponReasonLabels[reason] ?? reason).join('、')}>{weaponEvidenceLabels[weapon.status]}</span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function BreakdownTable({ title, rows, weaponKey, label }: { title: string; rows: WeaponBreakdownRow[]; weaponKey: string; label(value: string): string }) {
  return <article className="surface-card p-4">
    <h3 className="mb-2 text-white">{title}</h3>
    {rows.length === 0 ? <p className="text-sm text-slate-400">沒有資料</p> : <div className="table-scroll" tabIndex={0} role="region" aria-label={`${title}，可水平捲動`}>
      <table className="comparison-table" aria-label={title}><thead><tr><th scope="col">{title.replace('分布', '')}</th><th scope="col">觀測武器回合</th><th scope="col">使用占比</th><th scope="col">武器擊殺</th><th scope="col">擊殺占比</th><th scope="col">每100回合武器擊殺</th><th scope="col">證據</th></tr></thead>
        <tbody>{rows.map((row) => { const w = row.weapons.find((item) => item.weaponKey === weaponKey); return <tr key={row.value}>
          <th scope="row">{label(row.value)}</th><td>{w ? formatCount(w.observedWeaponRounds) : 0}</td><td>{pct(w?.observedWeaponRoundShare ?? (row.coverage.roundWeapon.observed > 0 ? 0 : undefined))}</td>
          <td>{w ? formatCount(w.weaponKills) : 0}</td><td>{pct(w?.weaponKillShare ?? (row.coverage.killWeapon.weaponLabeledKills > 0 ? 0 : undefined))}</td>
          <td>{formatPer100(w?.weaponKillsPer100PlayedRounds ?? (row.playedRounds > 0 ? 0 : undefined))}</td>
          <td>{row.status === 'available' ? `${row.playedRounds} 回合` : `${row.playedRounds} 回合（樣本少）`}</td></tr>; })}</tbody></table>
    </div>}
  </article>;
}

function CohortTable({ members, players, weaponKey, weaponName }: { members: MemberWeaponSummary[]; players: Player[]; weaponKey: string; weaponName: string }) {
  const byId = new Map(players.map((player) => [player.id, player]));
  const rows = members.map((member) => ({ member, player: byId.get(member.memberId), weapon: member.weapons.find((w) => w.weaponKey === weaponKey) }))
    .filter((row) => row.player).sort((a, b) => (b.weapon?.observedWeaponRoundShare ?? -1) - (a.weapon?.observedWeaponRoundShare ?? -1) || a.player!.handle.localeCompare(b.player!.handle));
  return <div className="table-scroll" tabIndex={0} role="region" aria-label="成員武器比較，可水平捲動">
    <table className="comparison-table" aria-label={`${weaponName} 成員比較`}><caption className="p-3 text-left text-sm">描述性比較，不是排名、不影響戰力分數。</caption>
      <thead><tr><th scope="col">成員</th><th scope="col">使用占比</th><th scope="col">武器擊殺</th><th scope="col">擊殺占比</th><th scope="col">每100回合武器擊殺</th><th scope="col">回合武器證據</th></tr></thead>
      <tbody>{rows.map(({ member, player, weapon }) => <tr key={member.memberId}>
        <th scope="row"><span className="flex items-center gap-2"><PlayerAvatar player={player!} /><span><strong>{player!.handle}</strong><MemberNickname player={player!} className="block text-xs text-slate-400" /></span></span></th>
        <td>{pct(weapon?.observedWeaponRoundShare ?? (member.coverage.roundWeapon.observed > 0 ? 0 : undefined))}</td><td>{weapon ? formatCount(weapon.weaponKills) : 0}</td>
        <td>{pct(weapon?.weaponKillShare ?? (member.coverage.killWeapon.weaponLabeledKills > 0 ? 0 : undefined))}</td>
        <td>{formatPer100(weapon?.weaponKillsPer100PlayedRounds ?? (member.playedRounds > 0 ? 0 : undefined))}</td><td>{pct(member.coverage.roundWeapon.coverage)}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function WeaponExplanation() {
  return <details className="surface-card p-4 text-sm text-slate-300">
    <summary className="cursor-pointer font-semibold text-white">數據怎麼算？</summary>
    <ul className="mt-3 list-disc space-y-1 pl-5">
      <li>「觀測武器回合」來自回合武器證據（資料來源記錄的該回合裝備武器），不代表該回合碰過的所有武器。</li>
      <li>「武器擊殺」來自每次擊殺事件記錄的武器／方式；技能或無法分類的方式列為「其他／未知方式」。</li>
      <li>兩種證據分開計算；不發布「武器擊殺 ÷ 觀測武器回合」這類跨證據效率。</li>
      <li>缺少證據不當作 0：缺少武器的回合不算使用，缺少武器標記的擊殺只計入覆蓋率。</li>
      <li>「每100回合武器擊殺」的分母是該成員在範圍內實際在場的回合，衡量貢獻頻率，不是武器效率。</li>
      <li>「觀測該武器回合勝率」只是相關描述，不代表武器造成勝負。</li>
      <li>同一成員的小帳會先合併證據再計算；已撤回或刪除的帳號不納入。</li>
      <li>資料來自目前已保存的已追蹤戰績，並非完整生涯。</li>
      <li>目前沒有逐武器的命中部位、傷害或開槍數證據，因此不提供每把槍的 HS%、ADR、傷害、準確度；也沒有攻守方證據，不提供攻守拆分。</li>
    </ul>
  </details>;
}

export function WeaponsPage() {
  const { dataset, analytics: { activeDataset, availableAgents, availableMaps, population } } = useDataset();
  const [params, setParams] = useSearchParams();
  const players = activeDataset.players;
  const player = params.get('player') && players.some((p) => p.id === params.get('player')) ? params.get('player')! : players[0]?.id;
  const scope = (['all', 'current', 'act'].includes(params.get('scope') ?? '') ? params.get('scope') : 'all') as WeaponScopeMode;
  const acts = [...population.seasonKeys].sort(compareSeasonKeysDesc);
  const act = scope === 'act' ? (params.get('act') && acts.includes(params.get('act')!) ? params.get('act')! : acts[0]) : undefined;
  const map = params.get('map') ?? 'all';
  const agent = params.get('agent') ?? 'all';
  const mode = params.get('mode') ?? 'Competitive';
  const update = (patch: Record<string, string | undefined>) => setParams((current) => {
    const next = new URLSearchParams(current);
    for (const [key, value] of Object.entries(patch)) if (value === undefined) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const { status, result } = useWeaponAnalytics({ player: player ?? 'all', scope, ...(act ? { act } : {}), map, agent, mode });
  if (!player) return <EmptyState page title="沒有可分析的成員" description="目前資料集沒有公開成員。" />;
  const member = result?.member;
  const selectedKey = params.get('weapon') && member?.weapons.some((w) => w.weaponKey === params.get('weapon')) ? params.get('weapon')! : member?.mostUsed ?? member?.weapons[0]?.weaponKey;
  const selected = member?.weapons.find((w) => w.weaponKey === selectedKey);
  const name = (key?: string) => member?.weapons.find((w) => w.weaponKey === key)?.weaponName;
  const memberPlayer = players.find((p) => p.id === player)!;
  return <div className="space-y-8">
    <SectionHeading eyebrow="weapon-analytics-v2" title="武器分析" description={`${dataset.isDemo ? '虛構示範資料。' : '依已保存的已追蹤戰績彙整；'}成員層級（小帳合併），不是完整生涯，也不影響戰力分數。`} />
    <section className="surface-card grid gap-3 p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="武器分析條件">
      <label>成員<select aria-label="成員" className={inputClass} value={player} onChange={(e) => update({ player: e.target.value, weapon: undefined })}>{players.map((p) => <option key={p.id} value={p.id}>{p.handle}</option>)}</select></label>
      <label>範圍<select aria-label="範圍" className={inputClass} value={scope} onChange={(e) => update({ scope: e.target.value, act: undefined })}>{(['all', 'current', 'act'] as const).map((value) => <option key={value} value={value} disabled={value === 'act' && acts.length === 0}>{weaponScopeLabels[value]}</option>)}</select></label>
      {scope === 'act' ? <label>Act<select aria-label="Act" className={inputClass} value={act} onChange={(e) => update({ act: e.target.value })}>{acts.map((key, index) => <option key={key} value={key}>{actOptionLabel(key, index)}</option>)}</select></label> : null}
      <label>地圖<select aria-label="地圖" className={inputClass} value={map} onChange={(e) => update({ map: e.target.value === 'all' ? undefined : e.target.value })}><option value="all">全部地圖</option>{availableMaps.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>特務<select aria-label="特務" className={inputClass} value={agent} onChange={(e) => update({ agent: e.target.value === 'all' ? undefined : e.target.value })}><option value="all">全部特務</option>{availableAgents.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>模式<select aria-label="模式" className={inputClass} value={mode} onChange={(e) => update({ mode: e.target.value === 'Competitive' ? undefined : e.target.value })}><option value="Competitive">排位（武器戰力分析固定）</option>{mode !== 'Competitive' ? <option value={mode} disabled>{mode === 'all' ? '全部模式' : mode}（僅限排位）</option> : null}</select></label>
    </section>
    {status === 'loading' ? <LoadingPanel title="正在由伺服器彙整武器證據" /> : null}
    {status === 'error' || status === 'unavailable' ? <EmptyState title="武器分析暫時無法取得" description="不會改用快照、其他範圍或示範資料代替。請稍後再試。" /> : null}
    {member ? <>
      <section className="grid gap-4 md:grid-cols-3" aria-label="武器摘要">
        <article className="surface-card p-4"><p className="metric-label">最常使用</p><strong className="text-2xl text-white">{name(member.mostUsed) ?? '資料不足'}</strong><p className="text-xs text-slate-400">依觀測武器回合占比；需足夠樣本</p></article>
        <article className="surface-card p-4"><p className="metric-label">最多擊殺</p><strong className="text-2xl text-white">{name(member.mostKills) ?? '資料不足'}</strong><p className="text-xs text-slate-400">依武器擊殺數；擊殺多不等於效率高</p></article>
        <article className="surface-card p-4"><p className="metric-label">證據覆蓋率</p><strong className="text-2xl text-white">{pct(member.coverage.roundWeapon.coverage)}</strong><CoverageLine coverage={member.coverage} /></article>
      </section>
      <p className="text-xs text-slate-400">{memberPlayer.handle} · {weaponScopeLabels[scope]}{act ? `（${seasonLabel(act)}）` : ''} · {member.matches} 場／{member.playedRounds} 回合 · 範圍狀態：{weaponEvidenceLabels[result!.scope.status]}{result!.scope.reasons.length ? `（${result!.scope.reasons.map((reason) => weaponReasonLabels[reason] ?? reason).join('、')}）` : ''}</p>
      <WeaponTable weapons={member.weapons} selected={selectedKey} onSelect={(key) => update({ weapon: key })} />
      {selected ? <section className="space-y-4" aria-label="武器細節">
        <SectionHeading eyebrow={weaponCategoryLabels[selected.category]} title={`${memberPlayer.handle} / ${selected.weaponName}`} description={`觀測武器回合 ${selected.observedWeaponRounds} · 使用占比 ${pct(selected.observedWeaponRoundShare)} · 武器擊殺 ${selected.weaponKills} · 擊殺占比 ${pct(selected.weaponKillShare)} · 每100回合武器擊殺 ${formatPer100(selected.weaponKillsPer100PlayedRounds)}`} />
        <div className="grid gap-4 xl:grid-cols-3">
          <BreakdownTable title="地圖分布" rows={member.breakdowns.maps} weaponKey={selected.weaponKey} label={(value) => value} />
          <BreakdownTable title="特務分布" rows={member.breakdowns.agents} weaponKey={selected.weaponKey} label={(value) => value} />
          <BreakdownTable title="Act 分布" rows={member.breakdowns.acts} weaponKey={selected.weaponKey} label={(value) => (value === 'unknown' ? '未知 Act' : seasonLabel(value))} />
        </div>
        {member.accounts.length > 1 ? <p className="text-xs text-slate-400">證據來源帳號：{member.accounts.map((account) => { const info = memberPlayer.accounts?.find((item) => item.id === account.accountId); return `${info ? `${info.gameName}#${info.tag}` : '帳號'} ${account.playedRounds} 回合`; }).join('、')}（已合併計算）</p> : null}
        <SectionHeading title={`${selected.weaponName} 成員比較`} />
        <CohortTable members={result!.members} players={players} weaponKey={selected.weaponKey} weaponName={selected.weaponName} />
      </section> : null}
    </> : null}
    <WeaponExplanation />
    <p className="text-sm"><Link className="text-link" to={`/players/${player}`}>← 回到 {memberPlayer.handle} 的個人頁</Link></p>
  </div>;
}
