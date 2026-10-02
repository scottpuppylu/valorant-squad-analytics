import type { MetricDefinition } from '../types/metrics';

const definitions = [
  ['overall','綜合表現','Overall','18% 火力 + 16% 回合影響 + 12% 開戰 + 16% 團隊 + 10% 殘局 + 10% 經濟 + 10% 穩定 + 8% 角色；至少六維且 75% 設定權重才重正規化'],
  ['firepower','火力','Firepower','35% ACS + 30% ADR + 20% KPR + 15% K/D（各項先依當場角色正規化）'],
  ['round-impact','回合影響','Round Impact','25% 劣勢擊殺/回合 + 20% 換人擊殺/回合 + 20% 殘局狀態擊殺/回合 + 20% 多殺回合/回合 + 15% 勝局擊殺/回合（先正規化）'],
  ['entry','開戰影響','Entry','45% FKPR + 35% 反向 FDPR + 20% KPR（先正規化）'],
  ['teamplay','團隊貢獻','Teamplay','35% KAST + 25% APR + 20% 換人助攻/回合 + 20% 換人擊殺/回合（先正規化；不含勝率）'],
  ['clutch-score','殘局能力','Clutch','80% 收縮轉換率 + 20% 難度加權勝局/回合；收縮=(wins+1)/(attempts+5)；1v1–1v5 權重=1/1.25/1.5/1.75/2；零嘗試為資料不足'],
  ['economy','經濟效率','Economy','65% 傷害/每千花費 + 35% 擊殺/每千花費（先正規化）；僅完整、正花費的對齊樣本；總產出/總花費 × 1000'],
  ['consistency','穩定度','Consistency','60% 反向 ACS CV + 40% 反向 KAST 母體標準差；至少五筆有效配對；5–9 筆為部分證據；ACS 平均為零不計 CV'],
  ['role-value','角色價值','Role Value','決鬥者 FKPR30/KPR25/劣勢20/換人15/KAST10；先鋒 APR30/KAST25/換人助攻25/換人10/目標10；控場 KAST30/APR25/換人助攻20/目標15/傷害效率10；守衛 KAST30/收縮殘局20/目標20/APR15/換人助攻15（百分比；先正規化）'],
  ['confidence','樣本信心','Confidence','100 × sqrt(min(matches/30,1) × min(rounds/600,1)) × evidenceCoverage；與表現分数分離'],
] as const;

export const scoringDefinitions: MetricDefinition[] = definitions.map(([id,nameZhTW,nameEnglish,formula]) => ({
  id,abbreviation:nameEnglish,nameZhTW,nameEnglish,formula,category:id==='confidence'?'樣本資訊':'評分類別',
  type:id==='confidence'?'CONTEXT':'COMPOSITE',unit:'0–100',currentAvailability:'IMPLEMENTED',dataSource:'DURABLE_RECONSTRUCTION',
  definition:'證據感知社群指標；採用 community-score-v2、community-benchmarks-v1 與 overall-profile-v1。',
  interpretation:'比較選取樣本中可觀察的貢獻；部分結果顯示覆蓋率，資料不足不產生數值。',
  higherIsGenerallyBetter:id==='confidence'?null:true,
  requiredInputs:['目前篩選樣本的可用原始／重建證據','當場特務角色'],
  limitations:['基準為產品校準，不是 Riot 排名或全球百分位。','Demo 為固定虛構證據；非空正式資料計分仍未實地驗證。','單維至少 70% 組件權重；完整場次證據低於選取回合 70% 時組件不可評分。','角色價值只代表可觀察代理指標，不是完整技能效果。'],
  usedByDimensions:[nameZhTW],
}));
