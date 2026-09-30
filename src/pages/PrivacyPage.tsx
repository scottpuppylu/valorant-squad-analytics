export function PrivacyPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">隱私說明</p>
      <h1>隱私與資料可見性</h1>
      <p>Demo 模式使用虛構資料。選擇加入真實戰績時，玩家提交 Riot Game Name、Tag、區域與明確同意；本站不要求 Riot 密碼、驗證碼、Cookie 或登入憑證。</p>
      <h2>瀏覽器內資料</h2>
      <p>玩家的 emoji 頭像覆寫值存放在目前瀏覽器的 localStorage。清除網站資料、改用其他瀏覽器或裝置時不會自動同步。</p>
      <h2>連接時會讀取什麼</h2>
      <p>同意後，本站後端會向第三方資料提供者查詢公開帳號資料，以及你主動選擇的最近 1、10、20 或 30 場戰績。資料用於朋友群的統計、排名與分析；不會自動要求生涯全部紀錄。</p>
      <h2>資料如何處理</h2>
      <p>提供者憑證只存在伺服器。後端會移除 PUUID、原始 match ID 與未使用欄位，只把已正規化的分析資料傳回瀏覽器。第一階段沒有資料庫，也不在伺服器永久保存玩家戰績。</p>
      <h2>保存多久與如何移除</h2>
      <p>已正規化戰績只保存在目前瀏覽器的 localStorage，直到你在「加入調查」頁按下「移除本機戰績並返回 Demo」，或清除本站瀏覽器資料。其他裝置不會自動同步。</p>
      <h2>Emoji 頭像</h2>
      <p>玩家的 emoji 覆寫值也只保存在目前瀏覽器。於玩家分析頁按「重設頭像」可移除該玩家的 emoji 覆寫值。</p>
    </article>
  );
}
