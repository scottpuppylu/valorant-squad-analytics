# VALORANT Squad Analytics

朋友群專用的 VALORANT 表現分析網站。這個專案會從透明、可調整的數據指標出發，呈現火力、開戰、團隊貢獻、殘局、經濟、穩定度、角色價值與隊友協同，而不是建立或模仿 Riot 的 MMR、Elo 或官方牌位系統。

## 目前狀態

TASK-003 已依使用者指定順序先於 TASK-002B 完成。網站現在提供共用的 player-performance 查詢層、交叉排名、2–4 人比較、地圖、特務／角色、對戰紀錄、玩家切分與動態徽章。所有分析仍只使用 8 位虛構玩家與 32 場可重現示範比賽，不需要 API key、真實 Riot 帳號或 `.env.local`；目前分數仍是透明的原型模型，TASK-002B 尚未完成。

## V1 原則

- 靜態網站，可部署到 GitHub Pages
- React、TypeScript、Vite、Tailwind CSS、Recharts、Vitest、npm
- 使用示範 JSON，以及後續的 CSV／JSON 匯入
- 公開網站不需要後端、不包含 API key，也不在 runtime 呼叫非官方 VALORANT API
- 原始數據、衍生指標、正規化、權重與 UI 必須分離
- 所有計分公式公開並有測試
- 小樣本需要顯示信心指標
- 缺少進階欄位時不可讓整體計分失效

## 開發階段

1. 建立應用程式骨架、示範資料、儀表板與排行榜
2. 已先完成交叉篩選、玩家比較、地圖／特務／對戰頁面與動態稱號
3. 使用既有虛構資料修正證據覆蓋與小樣本問題，實作透明、角色調整的八維計分引擎
4. 加入 Duo Synergy
5. 完成 CSV／JSON 匯入與 GitHub Pages v1.0
6. 未來另以 `TASK-API-01` 驗證第三方真實資料；正式官方整合仍須 Production API、RSO 核准與安全後端

詳細範圍請見 [docs/PROJECT_BRIEF.md](docs/PROJECT_BRIEF.md)，下一個開發任務請見 [docs/TASKS.md](docs/TASKS.md)。

## 本機需求

- Node.js 20 或更新版本
- npm
- Git

```bash
npm install
npm run dev
```

品質檢查：

```bash
npm run lint
npm test
npm run build
```

Vite 的 production base path 是 `/valorant-squad-analytics/`，應用程式使用 hash routing，讓靜態 GitHub Pages 可以直接切換頁面。

分析頁的條件會以簡短 query parameters 保留在 hash route 後方，可分享目前的指標、期間、地圖、特務、角色、模式與樣本門檻。「最近 10／30 場」是每位玩家在其他條件套用後各自最新的合格出賽，不是小隊全域最新場次。

計分公式見 [docs/SCORING.md](docs/SCORING.md)，資料結構見 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)，官方欄位能力見 [docs/RIOT_API_CAPABILITY.md](docs/RIOT_API_CAPABILITY.md)，未來整合前提見 [docs/RIOT_INTEGRATION_PLAN.md](docs/RIOT_INTEGRATION_PLAN.md)。

第三方資料 spike 的架構準備、延後狀態與未驗證限制見 [docs/THIRD_PARTY_API_SPIKE.md](docs/THIRD_PARTY_API_SPIKE.md)。

## 安全與商標

- 不可提交 `.env`、token、API key 或其他秘密資料。
- 公開 V1 不連接 Riot 或第三方玩家資料 API。
- 本專案為非官方社群分析工具，不隸屬或代表 Riot Games。
- 不複製 Riot、VALORANT、VLR 或其他網站的視覺資產與版面。
