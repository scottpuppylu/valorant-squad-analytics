import type { MetricDefinition } from '../types/metrics';

const definitions = [
  ['direct-pair-trade','Direct Pair Trade','直接互補槍','雙方在相同回合內以既有 5 秒規則直接補掉對方死亡的敵人。','(A 補 B + B 補 A) / 共同已重建回合','不是技能／溝通品質證明，也不加入搭檔指數；缺事件證據不補 0。'],
  ['mutual-overall-lift','Mutual Overall Lift','雙向綜合表現差異','雙方共同出賽相對各自其他場次的 community-score-v2 差異平均。','mean(Overall A共同 − A基準, Overall B共同 − B基準)','雙方四個窗口均須可計分；會同時顯示正負不同的方向，不代表因果。'],
  ['mutual-kast-lift','Mutual KAST Lift','雙向 KAST 差異','同一選取條件內雙方有效回合加權 KAST 差異平均。','mean(KAST A共同 − A基準, KAST B共同 − B基準)','各窗口至少 70% 有效回合觀測，部分覆蓋維持部分狀態；缺值不補 0。'],
  ['pair-win-rate-lift','Pair Win-Rate Lift','搭檔勝率差異','共同同隊勝率相對雙方各自其他場次勝率平均的差異。','共同 teamWon 勝率 − mean(A 基準 teamWon 勝率, B 基準 teamWon 勝率)','團隊賽果是描述性情境，不是個人價值；缺賽果則不可用。'],
] as const;

export const synergyDefinitions: MetricDefinition[] = definitions.map(([id,abbreviation,nameZhTW,definition,formula,limitation]) => ({
  id,abbreviation,nameZhTW,nameEnglish:abbreviation,definition,formula,category:'進階分析',type:'DERIVED',
  unit:id === 'direct-pair-trade' ? '次／重建回合' : '差異',interpretation:'只描述同一日期、地圖、模式中的樣本內搭檔關聯。',
  higherIsGenerallyBetter:null,limitations:[limitation,'不代表完整生涯紀錄；非空 production 路徑尚未實際驗證。'],
  requiredInputs:['公開同意玩家','同隊共同出賽','各自其他場次（排除對手）'],
  currentAvailability:'IMPLEMENTED',dataSource:'DURABLE_RECONSTRUCTION',usedByDimensions:[],
}));
