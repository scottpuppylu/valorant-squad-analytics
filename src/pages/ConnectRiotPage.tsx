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
      <h2>第三方資料 spike 不等於帳號連結</h2>
      <p>TASK-002A.1 只在開發者本機以明確同意的玩家與環境變數執行欄位驗證；公開網站不會呼叫第三方玩家資料 API，也不會保存真實 Riot ID。</p>
      <div className="readiness-notice"><strong>為什麼現在不能連結？</strong><p>官方憑證與 RSO client secret 不能放在公開 GitHub Pages 前端。正式整合需要安全的伺服器端 OAuth callback、token 與 API 代理層。</p></div>
      <button className="button-primary mt-8" type="button" disabled aria-disabled="true">尚未開放連結</button>
    </article>
  );
}
