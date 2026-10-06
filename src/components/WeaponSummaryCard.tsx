import { Link } from 'react-router-dom';
import { weaponEvidenceLabels } from '../analytics/presentation';
import { useWeaponAnalytics } from '../hooks/useWeaponAnalytics';
import type { Player } from '../types/valorant';
import { formatCount, formatPercent } from '../utils/format';

/** TASK-WEAPON-01 compact Profile card: all tracked, Competitive, member-level (alt accounts merged). */
export function WeaponSummaryCard({ player }: { player: Player }) {
  const { status, result } = useWeaponAnalytics({ player: player.id, scope: 'all', map: 'all', agent: 'all', mode: 'Competitive' });
  const member = result?.member;
  const name = (key?: string) => member?.weapons.find((weapon) => weapon.weaponKey === key)?.weaponName;
  return <section aria-label="武器" className="surface-card p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-lg font-semibold text-white">武器</h2>
      <Link className="text-link text-sm" to={`/weapons?player=${encodeURIComponent(player.id)}`}>查看完整武器分析</Link>
    </div>
    {status === 'loading' ? <p className="mt-2 text-sm text-slate-400">正在彙整已追蹤武器資料…</p> : null}
    {status === 'error' || status === 'unavailable' ? <p className="mt-2 text-sm text-slate-400">武器分析暫時無法取得。</p> : null}
    {member ? <>
      <p className="mt-2 text-sm text-slate-300">最常使用：<strong className="text-white">{name(member.mostUsed) ?? '資料不足'}</strong> · 最多擊殺：<strong className="text-white">{name(member.mostKills) ?? '資料不足'}</strong></p>
      {member.weapons.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {member.weapons.slice(0, 5).map((weapon) => <li key={weapon.weaponKey} className="rounded-lg border border-white/10 p-2 text-xs text-slate-300">
          <strong className="block text-sm text-white">{weapon.weaponName}</strong>
          使用占比 {weapon.observedWeaponRoundShare === undefined ? '—' : formatPercent(weapon.observedWeaponRoundShare)} · 武器擊殺 {formatCount(weapon.weaponKills)}
        </li>)}
      </ul> : <p className="mt-2 text-sm text-slate-400">目前沒有可用的武器證據（缺少證據不等於 0）。</p>}
      <p className="mt-2 text-xs text-slate-400">全部已追蹤 · 競技 · 回合武器證據 {member.coverage.roundWeapon.coverage === undefined ? '—' : formatPercent(member.coverage.roundWeapon.coverage)}（{weaponEvidenceLabels[member.coverage.roundWeapon.status]}）· 非完整生涯</p>
    </> : null}
  </section>;
}
