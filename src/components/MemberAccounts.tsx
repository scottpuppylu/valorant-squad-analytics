import { accountMatchCounts, memberAccounts } from '../analytics/identity';
import type { MatchRecord, Player } from '../types/valorant';

/** TASK-IDENTITY-01: the Riot accounts behind a member. Compact for a single account. */
/** `counts` = per-account appearances of the page's server population (REAL); otherwise counted from `matches` (Demo). */
export function MemberAccounts({ player, matches, counts: trackedCounts }: { player: Player; matches: MatchRecord[]; counts?: Map<string, number> }) {
  const accounts = memberAccounts(player);
  if (accounts.length === 0) return null;
  const legacyName = player.nameSource === 'legacy_account';
  if (accounts.length === 1) {
    const account = accounts[0]!;
    return <p aria-label="遊戲帳號" className="text-sm text-slate-400">
      遊戲帳號 <span className="font-mono text-slate-200">{account.gameName}#{account.tag}</span>
      {legacyName ? <span className="ml-2 text-xs">（成員名稱暫用遊戲名稱）</span> : null}
    </p>;
  }
  const counts = trackedCounts ?? accountMatchCounts(matches, player.id);
  return <section aria-label="遊戲帳號" className="surface-card p-4 text-sm">
    <p className="metric-label">遊戲帳號（{accounts.length} 個，分析合併計算）</p>
    <ul className="mt-2 space-y-1">
      {accounts.map((account) => <li className="flex flex-wrap items-center gap-2" key={account.id}>
        <span className="role-chip">{account.roleLabel}</span>
        <span className="font-mono text-slate-200">{account.gameName}#{account.tag}</span>
        <span className="text-xs text-slate-400">{trackedCounts ? '目前條件' : '目前資料'} {counts.get(account.id) ?? 0} 場</span>
      </li>)}
    </ul>
    {legacyName ? <p className="mt-2 text-xs text-slate-400">成員名稱暫用遊戲名稱，尚未設定社群暱稱。</p> : null}
  </section>;
}
