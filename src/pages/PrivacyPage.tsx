export function PrivacyPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">原型隱私說明</p>
      <h1>隱私與資料可見性</h1>
      <p>目前公開版本不連接 Riot 帳號、不收集真實玩家統計，也不把頭像設定上傳到伺服器。所有畫面中的示範名稱與比賽資料均為虛構。</p>
      <h2>瀏覽器內資料</h2>
      <p>玩家的 emoji 頭像覆寫值存放在目前瀏覽器的 localStorage。清除網站資料、改用其他瀏覽器或裝置時不會自動同步。</p>
      <h2>本機資料 spike</h2>
      <p>開發用第三方 API probe 只允許查詢已明確同意的玩家，API key 由本機環境變數提供；工具只輸出不含玩家識別資訊的欄位覆蓋摘要，不會把原始回應寫入網站或 repository。</p>
      <h2>未來的選擇加入</h2>
      <p>若取得 Riot Production API 與 RSO 核准，玩家必須自行登入並同意分享資料。介面將提供可見範圍、解除連結與撤銷授權概念；未選擇加入的玩家資料不會對其他使用者顯示。</p>
      <h2>目前可做的移除</h2>
      <p>在玩家分析頁打開 emoji 選擇器並按「重設頭像」，即可移除該玩家的本機覆寫值；也可由瀏覽器設定清除本站資料。</p>
    </article>
  );
}
