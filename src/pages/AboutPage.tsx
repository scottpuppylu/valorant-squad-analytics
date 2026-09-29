import { Link } from 'react-router-dom';

export function AboutPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">產品說明</p>
      <h1>關於小隊分析</h1>
      <p>這是一個非官方的社群 VALORANT 表現分析應用程式。參與玩家未來必須明確選擇加入，才能把自己的統計分享給朋友群或社群。</p>
      <h2>我們想解決什麼</h2>
      <p>網站用公開公式呈現火力、開戰、團隊貢獻、殘局與穩定度，避免只用 K/D 判斷所有角色。現階段所有對戰與玩家都是虛構示範資料。</p>
      <h2>我們不是什麼</h2>
      <p>本產品不是對手偵察、即時戰術輔助、官方排名、MMR、Elo 或配對系統替代品，也不隸屬或代表 Riot Games。</p>
      <div className="mt-8 flex flex-wrap gap-3"><Link className="button-primary" to="/dictionary">查看數據字典</Link></div>
    </article>
  );
}
