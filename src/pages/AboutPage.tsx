import { Link } from 'react-router-dom';

export function AboutPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">產品說明</p>
      <h1>關於哥布林大調查</h1>
      <p>這是一個非官方的社群 VALORANT 表現分析應用程式。參與玩家未來必須明確選擇加入，才能把自己的統計分享給朋友群或社群。</p>
      <h2>我們想解決什麼</h2>
      <p>網站用公開公式呈現火力、回合影響、開戰、團隊貢獻、殘局、經濟效率、穩定度與角色價值，避免只用 K/D 判斷所有角色。Demo 使用虛構資料；玩家也可在明確同意後，透過本站後端匯入自己的近期公開戰績。</p>
      <h2>如何解讀分數</h2><p>規則 community-score-v2，基準 community-benchmarks-v1，綜合設定 overall-profile-v1。範圍是公開的產品校準，不是官方或全球百分位。資料不足不補零，部分分數保留覆蓋率；樣本信心不提高表現分數。</p>
      <h2>我們不是什麼</h2>
      <p>本產品不是對手偵察、即時戰術輔助、官方排名、MMR、Elo 或配對系統替代品，也不隸屬或代表 Riot Games。</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link className="button-primary" to="/dictionary">查看數據字典</Link></div>
    </article>
  );
}
