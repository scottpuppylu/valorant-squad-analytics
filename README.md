# VALORANT Squad Analytics

朋友群專用的 VALORANT 表現分析網站。這個專案會從透明、可調整的數據指標出發，呈現火力、開戰、團隊貢獻、殘局、經濟、穩定度、角色價值與隊友協同，而不是建立或模仿 Riot 的 MMR、Elo 或官方牌位系統。

## 目前狀態

TASK-001 已建立靜態前端基礎：8 位虛構玩家、32 場可重現的示範比賽、角色調整的初始計分、儀表板、排行榜、玩家頁面與 GitHub Pages 工作流程。

## V1 原則

- 靜態網站，可部署到 GitHub Pages
- React、TypeScript、Vite、Tailwind CSS、Recharts、Vitest、npm
- 使用示範 JSON，以及後續的 CSV／JSON 匯入
- 不需要後端、不使用 API key、不連接非官方 VALORANT API
- 原始數據、衍生指標、正規化、權重與 UI 必須分離
- 所有計分公式公開並有測試
- 小樣本需要顯示信心指標
- 缺少進階欄位時不可讓整體計分失效

## 開發階段

1. 建立應用程式骨架、示範資料、儀表板與排行榜
2. 實作透明、角色調整的八維計分引擎
3. 加入交叉篩選、玩家比較與動態稱號
4. 加入 Duo Synergy
5. 完成 CSV／JSON 匯入與 GitHub Pages v1.0
6. V1 完成後，才評估 Riot 官方 API 與 RSO

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

計分公式見 [docs/SCORING.md](docs/SCORING.md)，資料結構見 [docs/DATA_MODEL.md](docs/DATA_MODEL.md)。

## 安全與商標

- 不可提交 `.env`、token、API key 或其他秘密資料。
- V1 不使用 Riot API。
- 本專案為非官方社群分析工具，不隸屬或代表 Riot Games。
- 不複製 Riot、VALORANT、VLR 或其他網站的視覺資產與版面。
