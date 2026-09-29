# 哥布林大調查

哥布林大調查是朋友群專用的 VALORANT 表現分析網站；技術 repository 與 GitHub Pages base path 仍使用 `valorant-squad-analytics`。這個專案會從透明、可調整的數據指標出發，呈現火力、開戰、團隊貢獻、殘局、經濟、穩定度、角色價值與隊友協同，而不是建立或模仿 Riot 的 MMR、Elo 或官方牌位系統。

## 目前狀態

TASK-003 已完成；TASK-API-02 已把資料連接改為 Vercel 同源後端並部署至 [valorant-squad-analytics.vercel.app](https://valorant-squad-analytics.vercel.app/)。網站保留 8 位虛構玩家與 32 場可重現 Demo，並新增「加入調查」流程：一般玩家只輸入 Riot ID、Tag、區域並明確同意，永遠不需要 HenrikDev key、`.env`、Riot 密碼、Cookie 或 MFA。正式部署目前誠實顯示「API 尚未設定」；站台管理員仍須在 Vercel 設定一組 server-only `HENRIK_API_KEY`，之後才能執行同意帳號的三場驗證。TASK-002B 尚未開始。

## V1 原則

- Vite 前端與薄型 Vercel serverless API；GitHub Pages 暫留為 Demo rollback
- React、TypeScript、Vite、Tailwind CSS、Recharts、Vitest、npm
- Demo 使用固定 JSON；真實資料經後端正規化後只保存在該玩家的瀏覽器
- API key 只存在 Vercel server runtime，絕不進入 React bundle 或 API response
- 原始數據、衍生指標、正規化、權重與 UI 必須分離
- 所有計分公式公開並有測試
- 小樣本需要顯示信心指標
- 缺少進階欄位時不可讓整體計分失效

## 開發階段

1. 建立應用程式骨架、示範資料、儀表板與排行榜
2. 已先完成交叉篩選、玩家比較、地圖／特務／對戰頁面與動態稱號
3. 使用既有虛構資料修正證據覆蓋與小樣本問題，實作透明、角色調整的八維計分引擎
4. 加入 Duo Synergy
5. 完成 TASK-API-02 的 Vercel production deploy 與一個同意帳號的三場驗證
6. 後續再進行 TASK-002B；正式 Riot 整合仍須 Production API 與 RSO 核准

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

`npm test` 與 CI 只使用 mock／fixture，不會呼叫真實 provider。`npm run build` 也會掃描 browser source 與 bundle，防止 server secret 名稱進入前端。

Vite 在 Vercel 使用 `/` base path，在 GitHub Pages rollback 使用 `/valorant-squad-analytics/`。應用程式保留 hash routing，讓兩種部署都能直接切換頁面。Vercel 同源狀態端點已部署並在未設定憑證時安全回傳 `unconfigured`；GitHub Pages 仍維持 Demo-only rollback。

分析頁的條件會以簡短 query parameters 保留在 hash route 後方，可分享目前的指標、期間、地圖、特務、角色、模式與樣本門檻。「最近 10／30 場」是每位玩家在其他條件套用後各自最新的合格出賽，不是小隊全域最新場次。

計分公式見 [docs/SCORING.md](docs/SCORING.md)，資料結構見 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)，官方欄位能力見 [docs/RIOT_API_CAPABILITY.md](docs/RIOT_API_CAPABILITY.md)，未來整合前提見 [docs/RIOT_INTEGRATION_PLAN.md](docs/RIOT_INTEGRATION_PLAN.md)。

production 需求見 [docs/TASK_API_02_SPEC.md](docs/TASK_API_02_SPEC.md)，架構決策見 [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md)，管理員一次性設定見 [docs/ADMIN_SETUP.md](docs/ADMIN_SETUP.md)。

## 安全與商標

- 不可提交 `.env`、token、API key 或其他秘密資料。
- 瀏覽器只呼叫同源 `/api/*`，不會直接呼叫 HenrikDev 或收到 provider secret。
- 本專案為非官方社群分析工具，不隸屬或代表 Riot Games。
- 不複製 Riot、VALORANT、VLR 或其他網站的視覺資產與版面。
