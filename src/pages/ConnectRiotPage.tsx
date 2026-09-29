export function ConnectRiotPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">官方整合準備</p>
      <h1>Riot 帳號連結功能尚未啟用</h1>
      <p>VALORANT 玩家資料需要官方 Production API 存取、Riot Sign On（RSO）核准，以及玩家明確選擇加入。此頁只是可測試的未來流程說明，不會啟動登入。</p>
      <ol>
        <li><strong>1. 玩家主動連結</strong><span>使用官方 RSO 流程確認自己的 Riot 帳號。</span></li>
        <li><strong>2. 清楚同意分享</strong><span>在加入朋友群前了解哪些統計會被看見。</span></li>
        <li><strong>3. 可隨時撤銷</strong><span>解除連結後停止後續同步，並依未來隱私政策處理既有資料。</span></li>
      </ol>
      <div className="readiness-notice"><strong>為什麼現在不能連結？</strong><p>官方憑證與 RSO client secret 不能放在公開 GitHub Pages 前端。正式整合需要安全的伺服器端 OAuth callback、token 與 API 代理層。</p></div>
      <button className="button-primary mt-8" type="button" disabled aria-disabled="true">尚未開放連結</button>
    </article>
  );
}
