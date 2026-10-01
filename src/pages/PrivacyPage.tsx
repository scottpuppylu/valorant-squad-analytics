import { PUBLIC_DATASET_PRIVACY_VERSION } from '../../shared/privacyPolicy';

export function PrivacyPage() {
  return (
    <article className="content-page surface-card">
      <p className="metric-label">隱私說明</p>
      <h1>隱私與資料可見性</h1>
      <p><strong>Production 的真實戰績分析是公開的。</strong>任何造訪 production 網站的人都能瀏覽已同意玩家的去敏感化分析，不需要登入、密碼或存取碼。GitHub Pages 則固定使用虛構 Demo 資料。</p>
      <p>選擇加入真實戰績時，玩家提交 Riot Game Name、Tag、區域與明確同意；本站不要求 Riot 密碼、驗證碼、Cookie 或登入憑證。這是玩家自行聲明的同意（self-asserted），不是 Riot 帳號所有權驗證。</p>
      <h2>目前公開政策版本</h2>
      <p><code>{PUBLIC_DATASET_PRIVACY_VERSION}</code>。未來若公開範圍有重大變更，會使用新的政策版本，玩家必須再次明確同意；舊版同意不會由背景同步、讀取或重試自動升級。</p>
      <h2>瀏覽器內資料</h2>
      <p>玩家的 emoji 頭像覆寫值與一次性核發的同意管理憑證會分開存放在目前瀏覽器的 localStorage。完整真實戰績不再保存於 localStorage；舊版 `goblin-survey:real-dataset:v1` 會在 DatasetProvider 啟動時只做清除，不會被重新讀取。遺失管理憑證時仍需由管理員協助撤回。</p>
      <h2>連接時會讀取什麼</h2>
      <p>同意後，本站後端會向第三方資料提供者查詢公開帳號資料，以及你主動選擇的有界戰績。公開資料集最多讀取目前持久化證據中最近 300 場符合條件的對戰，不代表完整生涯紀錄。</p>
      <h2>可能公開顯示的資料</h2>
      <p>Riot Game Name／顯示名稱、Riot Tag、路由使用的公開應用程式玩家 ID、特務歷史、比賽層級公開分析、社群分數與排名、地圖、遊戲模式，以及本站公開的衍生或重建指標。</p>
      <h2>永不公開的資料</h2>
      <p>PUUID、原始 provider match ID、資料庫內部 ID、provider lookup HMAC、participant HMAC、event HMAC、<code>DATABASE_<wbr />URL</code>、<code>IDENTIFIER_<wbr />HMAC_<wbr />KEY</code>、<code>HENRIK_<wbr />API_<wbr />KEY</code>、同意管理憑證，以及原始回合、事件、經濟或位置紀錄都不會由公開資料集 API 回傳。</p>
      <h2>資料如何處理</h2>
      <p>提供者憑證只存在伺服器。公開讀取 API 只回傳通過最新版公開同意與有效成員資格的玩家，以及既有去敏感化、版本化資料集投影。非同意玩家只可作為伺服器內的匿名重建證據，不會以玩家列、原始事件或可跨比賽識別的形式公開。</p>
      <h2>保存多久與如何移除</h2>
      <p>按下「取消參與哥布林大調查」並再次確認後，伺服器接受撤回時會立即停止同步、停用成員資格，並讓玩家失去公開資料集資格。較大量的證據刪除或匿名化可能繼續於可續跑背景工作中；在伺服器回報 complete 前不會宣稱刪除完成。管理憑證只保留供刪除狀態查詢與續跑，並在完成後自動清除。此操作無法復原；之後重新同意會建立新的、無法連回舊歷史的身分。</p>
      <h2>Emoji 頭像</h2>
      <p>玩家的 emoji 覆寫值也只保存在目前瀏覽器。於玩家分析頁按「重設頭像」可移除該玩家的 emoji 覆寫值。</p>
    </article>
  );
}
