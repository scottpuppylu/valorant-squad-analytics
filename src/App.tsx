import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { playerAnalytics } from './data/analytics';
import { AboutPage } from './pages/AboutPage';
import { ConnectRiotPage } from './pages/ConnectRiotPage';
import { DashboardPage } from './pages/DashboardPage';
import { DictionaryPage } from './pages/DictionaryPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PlayerProfilePage } from './pages/PlayerProfilePage';
import { PrivacyPage } from './pages/PrivacyPage';

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/players" element={<Navigate replace to={'/players/' + playerAnalytics[0]!.player.id} />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/dictionary" element={<DictionaryPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/connect-riot" element={<ConnectRiotPage />} />
          <Route path="/compare" element={<PlaceholderPage eyebrow="規劃中的分析" title="玩家比較" description="比較角色調整後的類別輪廓與原始數據，不把不同職責硬塞進同一尺度。" nextTask="TASK-003" />} />
          <Route path="/maps" element={<PlaceholderPage eyebrow="規劃中的分析" title="地圖分析" description="待交叉篩選加入後，檢視各地圖戰績、回合樣本與角色組成。" nextTask="TASK-003" />} />
          <Route path="/agents" element={<PlaceholderPage eyebrow="規劃中的分析" title="特務／角色分析" description="探索角色價值與特務樣本，同時保留小樣本提醒。" nextTask="TASK-003" />} />
          <Route path="/synergy" element={<PlaceholderPage eyebrow="規劃中的分析" title="隊友搭配" description="資料模型支援足夠共同回合證據後，再分析雙人搭配。" nextTask="TASK-004" />} />
          <Route path="/matches" element={<PlaceholderPage eyebrow="規劃中的分析" title="對戰紀錄" description="示範資料已有 32 場對戰；專用瀏覽器將與交叉篩選一併推出。" nextTask="TASK-003" />} />
          <Route path="/import" element={<PlaceholderPage eyebrow="規劃中的流程" title="資料匯入" description="靜態計分基礎穩定後再加入 CSV 與 JSON 驗證。" nextTask="TASK-009" />} />
          <Route path="/scoring" element={<PlaceholderPage eyebrow="透明是設計原則" title="評分設定" description="目前公式可在數據字典與 docs/SCORING.md 查閱；證據感知八維引擎留待 TASK-002B。" nextTask="TASK-002B" />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
