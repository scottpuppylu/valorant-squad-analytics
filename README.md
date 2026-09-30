# 哥布林大調查

哥布林大調查是朋友群專用的 VALORANT 表現分析網站；技術 repository 與 GitHub Pages base path 仍使用 `valorant-squad-analytics`。這個專案會從透明、可調整的數據指標出發，呈現火力、開戰、團隊貢獻、殘局、經濟、穩定度、角色價值與隊友協同，而不是建立或模仿 Riot 的 MMR、Elo 或官方牌位系統。

## 目前狀態

TASK-003 與 TASK-API-02 已完成；Vercel 同源後端已部署至 [valorant-squad-analytics.vercel.app](https://valorant-squad-analytics.vercel.app/)，並在一個明確同意的帳號上完成受控、去識別化的真實資料欄位稽核。TASK-DATA-01A 的 migration、同意紀錄、HMAC 身分保護與 transactional evidence persistence 已在本機 disposable Postgres 驗證；production Neon 設定與受控 row-count 驗證仍待完成。TASK-DATA-01B、TASK-DATA-01C、DATA-02 與 TASK-002B 均未開始。

## V1 原則

- Vite 前端與薄型 Vercel serverless API；GitHub Pages 暫留為 Demo rollback
- React、TypeScript、Vite、Tailwind CSS、Recharts、Vitest、npm
- Demo 使用固定 JSON；現行真實資料經後端正規化後只保存在該玩家的瀏覽器，跨裝置共用尚未實作
- API key 只存在 Vercel server runtime，絕不進入 React bundle 或 API response
- 原始數據、衍生指標、正規化、權重與 UI 必須分離
- 所有計分公式公開並有測試
- 小樣本需要顯示信心指標
- 缺少進階欄位時不可讓整體計分失效

## 開發階段

1. 建立應用程式骨架、示範資料、儀表板與排行榜
2. 已先完成交叉篩選、玩家比較、地圖／特務／對戰頁面與動態稱號
3. 已完成 Vercel production deploy、受控真實 provider 稽核與欄位能力分類
4. 以 TASK-DATA-01A 建立持久化證據底層，再分別完成 DATA-01B 回填與 DATA-01C 刪除流程
5. 再進行 TASK-002B 的證據感知八維計分引擎
6. Synergy 繼續保留為更後面的共用比賽分析

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
npm run db:validate
```

`npm test` 與 CI 只使用 mock／fixture，不會呼叫真實 provider。`npm run build` 也會掃描 browser source 與 bundle，防止 server secret 名稱進入前端。

資料庫 migration 位於 `migrations/`；`npm run db:migrate` 僅可在受信任、具 server-only `DATABASE_URL` 的環境執行。`IDENTIFIER_HMAC_KEY`、`DATABASE_URL` 與 `HENRIK_API_KEY` 都不得進入 React 或 browser bundle。完整 schema、身分類型、同意與 retention 語意見 [docs/DATABASE.md](docs/DATABASE.md)。現行前端仍使用 browser-local REAL dataset；Neon 在 DATA-02 前不會取代公開分析資料源。

Vite 在 Vercel 使用 `/` base path，在 GitHub Pages rollback 使用 `/valorant-squad-analytics/`。應用程式保留 hash routing，讓兩種部署都能直接切換頁面。Vercel 同源狀態端點已部署；provider secret 只存在 server runtime，真實資料稽核與測試輸出都不包含私密識別值。GitHub Pages 仍維持 Demo-only rollback。

分析頁的條件會以簡短 query parameters 保留在 hash route 後方，可分享目前的指標、期間、地圖、特務、角色、模式與樣本門檻。「最近 10／30 場」是每位玩家在其他條件套用後各自最新的合格出賽，不是小隊全域最新場次。

計分公式見 [docs/SCORING.md](docs/SCORING.md)，資料結構見 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)，官方欄位能力見 [docs/RIOT_API_CAPABILITY.md](docs/RIOT_API_CAPABILITY.md)，未來整合前提見 [docs/RIOT_INTEGRATION_PLAN.md](docs/RIOT_INTEGRATION_PLAN.md)。

production 需求見 [docs/TASK_API_02_SPEC.md](docs/TASK_API_02_SPEC.md)，真實欄位證據見 [docs/REAL_DATA_FIELD_AUDIT.md](docs/REAL_DATA_FIELD_AUDIT.md)，架構決策見 [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md)，後續代碼分工見 [docs/CODE_MAP.md](docs/CODE_MAP.md)。

## 安全與商標

- 不可提交 `.env`、token、API key 或其他秘密資料。
- 瀏覽器只呼叫同源 `/api/*`，不會直接呼叫 HenrikDev 或收到 provider secret。
- 本專案為非官方社群分析工具，不隸屬或代表 Riot Games。
- 不複製 Riot、VALORANT、VLR 或其他網站的視覺資產與版面。
