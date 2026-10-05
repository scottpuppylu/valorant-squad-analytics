import { MemberNickname } from './MemberNickname';
import { StatusBadge } from './StatusBadge';
import type { DuoSynergyResult, PairMember } from '../synergy/types';
import { formatCount, formatPercent, formatRatio, formatScore } from '../utils/format';
import { PlayerAvatar } from './PlayerAvatar';
import { zhTW } from '../i18n/zhTW';


const percent = (value?: number) => value === undefined ? '資料不足' : formatPercent(value);

function MemberDetail({ member }: { member: PairMember }) {
  return <article className="surface-card min-w-0 p-5">
    <h3 className="mb-3 flex items-center gap-2 text-white"><PlayerAvatar player={member.player} />{member.player.displayName}<MemberNickname player={member.player} /></h3>
    <p className="mb-4 text-sm text-slate-400">共同場次常用：{member.agent ?? '無資料'}／{member.role ? zhTW.roles[member.role] : '無資料'}（僅描述組成）</p>
    <dl className="space-y-3 text-sm">
      <div><dt>共同出賽／各自其他場次</dt><dd>{member.paired.matches} 場／{member.baseline.matches} 場</dd></div>
      <div><dt>綜合表現：共同／基準</dt><dd>{formatScore(member.paired.overall)}／{formatScore(member.baseline.overall)}</dd></div>
      <div><dt>綜合表現差異</dt><dd className="text-lg text-white">{formatScore(member.overallLift)} 分</dd></div>
      <div><dt>KAST：共同／基準</dt><dd>{percent(member.paired.kast)}／{percent(member.baseline.kast)}</dd></div>
      <div><dt>KAST 差異</dt><dd>{percent(member.kastLift)}（百分點差異）</dd></div>
    </dl>
  </article>;
}

export function SynergyDetail({ result }: { result: DuoSynergyResult }) {
  const trade = result.tradeEvidence;
  return <section id="pair-detail" className="space-y-4" aria-label="搭檔詳情">
    <h2 className="text-xl font-semibold text-white">{result.playerA.player.displayName} ＋ {result.playerB.player.displayName}</h2>
    <div className="surface-card grid gap-5 p-5 sm:grid-cols-4">
      <div><p>搭檔指數</p><strong className="text-3xl text-white">{result.value === undefined ? '資料不足' : formatScore(result.value)}</strong><div><StatusBadge status={result.status} coverage={result.coverage} /></div></div>
      <div><p>獨立樣本信心</p><strong>{formatPercent(result.confidence / 100)}</strong></div>
      <div><p>共同同隊樣本</p><strong>{formatCount(result.sharedSample.matches)} 場／{formatCount(result.sharedSample.rounds)} 回合</strong></div>
      <div><p>已排除對手場次</p><strong>{formatCount(result.sharedSample.opponentMatches)} 場</strong></div>
    </div>
    <div className="grid gap-4 md:grid-cols-2"><MemberDetail member={result.playerA} /><MemberDetail member={result.playerB} /></div>
    <div className="surface-card grid gap-5 p-5 sm:grid-cols-2">
      <div><h3 className="text-white">共同賽果關聯</h3><p>共同勝率 {percent(result.sharedSample.winRate)} · 雙方基準平均 {percent(result.trace.baselineWinRate)}</p><p>賽果不等同個人因果價值。</p></div>
      <div><h3 className="text-white">直接互補槍證據</h3><p><StatusBadge status={trade.status} /> · 重建 {trade.reconstructedRounds} 回合</p>
        <p>{result.playerA.player.displayName} 補 {result.playerB.player.displayName}：{trade.aTradedBDeaths ?? '—'} 次</p>
        <p>{result.playerB.player.displayName} 補 {result.playerA.player.displayName}：{trade.bTradedADeaths ?? '—'} 次</p>
        <p>合計 {trade.directPairTrades ?? '—'} 次／每重建回合 {formatRatio(trade.rate)}。部分值僅代表已重建子樣本；不納入指數。</p>
      </div>
    </div>
    <details className="surface-card p-5"><summary className="cursor-pointer text-white">計算依據</summary>
      <div className="mt-4 space-y-3 break-words text-sm">
        <p>{result.ruleVersion}／{result.benchmarkVersion} · 個人綜合表現沿用 community-score-v2</p>
        <p>共同 {result.trace.sharedMatches} 場 · A 基準 {result.trace.baselineA} 場 · B 基準 {result.trace.baselineB} 場</p>
        <p>收縮係數 {formatRatio(result.shrinkFactor)} · 零差異先驗強度 {result.trace.priorStrength} · 成分權重覆蓋 {percent(result.coverage)}</p>
        {result.components.map((c) => <p key={c.key}>{({ overall: '雙向綜合表現差異', kast: '雙向 KAST 差異', winRate: '勝率差異' })[c.key]}：
          原始 {formatRatio(c.rawDelta)} → 收縮 {formatRatio(c.shrunkDelta)} → 校準 {formatScore(c.normalized)}；
          對稱範圍 ±{c.range}；設定 {percent(c.configuredWeight)}／使用 {percent(c.usedWeight)}；<StatusBadge status={c.status} /> {c.omission}</p>)}
        {result.omissions.map((reason, index) => <p key={`${index}-${reason}`}>限制：{reason}</p>)}
        <p>50 是實際觀測差異的中性校準，不是缺值替代，也不是人口百分位。共同至少 3 場、雙方基準各 5 場與 75% 成分權重才可計分；完整樣本另需共同與各基準至少 8 場及完整成分。</p>
      </div>
    </details>
  </section>;
}
