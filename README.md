# 哥布林大調查

哥布林大調查是朋友群專用的 VALORANT 表現分析網站；技術 repository 與 GitHub Pages base path 仍使用 `valorant-squad-analytics`。這個專案會從透明、可調整的數據指標出發，呈現火力、開戰、團隊貢獻、殘局、經濟、穩定度、角色價值與隊友協同，而不是建立或模仿 Riot 的 MMR、Elo 或官方牌位系統。

## 目前狀態

TASK-003、TASK-API-02、TASK-DATA-01A／01B／01C 與 TASK-DATA-02 已完成。TASK-METRICS-01 已實作，production migration、CI 與部署驗證仍待完成。Vercel 是 [PUBLIC REAL canonical runtime](https://valorant-squad-analytics.vercel.app/)：任何訪客都能在無登入、無存取碼的情況下讀取已同意玩家的去敏感化分析。GitHub Pages 固定為 Demo-only rollback，不呼叫 production dataset API。公開投影最多包含最近 300 場符合資格的持久化對戰；目前 production 在 DATA-01C 刪除後沒有重新加入的玩家，所以公開 REAL dataset 預期為空，非空 production 指標路徑仍是 **NOT VERIFIED**。

## V1 原則

- Vite 前端與薄型 Vercel serverless API；Vercel 提供公開 REAL，GitHub Pages 保留 Demo-only rollback
- React、TypeScript、Vite、Tailwind CSS、Recharts、Vitest、npm
- Demo 使用固定 JSON；公開真實資料使用 versioned server read API，不把完整 REAL dataset 保存到 localStorage
- API key 只存在 Vercel server runtime，絕不進入 React bundle 或 API response
- 原始數據、衍生指標、正規化、權重與 UI 必須分離
- 所有計分公式公開並有測試
- 小樣本需要顯示信心指標
- 缺少進階欄位時不可讓整體計分失效

## 開發階段

1. 建立應用程式骨架、示範資料、儀表板與排行榜
2. 已先完成交叉篩選、玩家比較、地圖／特務／對戰頁面與動態稱號
3. 已完成 Vercel production deploy、受控真實 provider 稽核與欄位能力分類
4. 已以 TASK-DATA-01A 建立持久化證據底層，並以 DATA-01B 完成有界、可續跑的歷史與增量同步
5. DATA-01C 已完成 disposable 與 production 不可逆撤回／刪除驗證
6. DATA-02A／02A.1 已完成 durable read API、DatasetProvider 與 missing-evidence hardening
7. DATA-02B 採用 PUBLIC REAL、無 viewer authentication、`no-store` 與最新版公開同意政策；migration `0005` 保證每位玩家最多一筆 active consent
8. TASK-METRICS-01 已實作 `event-metrics-v1` 的 Trade、KAST、殘局、目標、技能施放、經濟效率與擊殺情境證據重建，production gates 待驗證；沒有新增或改寫任何計分權重
9. 下一步只建議 TASK-002B；Synergy 仍未開始

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

`npm test` 與 CI 只使用 mock／fixture，不會呼叫真實 provider 或 production Neon。`npm run build` 也會掃描 browser source 與 bundle，防止 server secret 名稱進入前端。公開政策唯一版本定義在 `shared/privacyPolicy.ts`；目前版本是 `2026-10-02-public-v1`。

資料庫 migration 位於 `migrations/`；`npm run db:migrate` 僅可在受信任、具 server-only database configuration 的環境執行。所有 provider、資料庫、HMAC、原始事件列與管理憑證都不得進入 React 或公開 dataset response。完整 schema、身分類型、同意與 retention 語意見 [docs/DATABASE.md](docs/DATABASE.md)，撤回與刪除契約見 [docs/REVOCATION_AND_DELETION.md](docs/REVOCATION_AND_DELETION.md)。DATA-02 runtime 與公開政策見 [docs/DATASET_RUNTIME.md](docs/DATASET_RUNTIME.md)，事件規則與證據狀態見 [docs/METRICS_RECONSTRUCTION.md](docs/METRICS_RECONSTRUCTION.md)。

Vite 在 Vercel 使用 `/` base path，在 GitHub Pages rollback 使用 `/valorant-squad-analytics/`。應用程式保留 hash routing，讓兩種部署都能直接切換頁面。Vercel 的 `GET /api/valorant/dataset` 在 `REAL_DATASET_READ_MODE=public` 時提供同源、無 viewer authentication、`Cache-Control: no-store` 的去敏感化有界 dataset。GitHub Pages 仍維持 Demo-only rollback。

分析頁的條件會以簡短 query parameters 保留在 hash route 後方，可分享目前的指標、期間、地圖、特務、角色、模式與樣本門檻。「最近 10／30 場」是每位玩家在其他條件套用後各自最新的合格出賽，不是小隊全域最新場次。

計分公式見 [docs/SCORING.md](docs/SCORING.md)，資料結構見 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)，官方欄位能力見 [docs/RIOT_API_CAPABILITY.md](docs/RIOT_API_CAPABILITY.md)，未來整合前提見 [docs/RIOT_INTEGRATION_PLAN.md](docs/RIOT_INTEGRATION_PLAN.md)。

production 需求見 [docs/TASK_API_02_SPEC.md](docs/TASK_API_02_SPEC.md)，真實欄位證據見 [docs/REAL_DATA_FIELD_AUDIT.md](docs/REAL_DATA_FIELD_AUDIT.md)，歷史同步契約見 [docs/HISTORICAL_SYNC.md](docs/HISTORICAL_SYNC.md)，架構決策見 [docs/PRODUCTION_ARCHITECTURE.md](docs/PRODUCTION_ARCHITECTURE.md)，後續代碼分工見 [docs/CODE_MAP.md](docs/CODE_MAP.md)。

## 安全與商標

- 不可提交 `.env`、token、API key 或其他秘密資料。
- 瀏覽器只呼叫同源 `/api/*`，不會直接呼叫 HenrikDev 或收到 provider secret。
- 本專案為非官方社群分析工具，不隸屬或代表 Riot Games。
- 不複製 Riot、VALORANT、VLR 或其他網站的視覺資產與版面。
