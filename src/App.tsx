import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { playerAnalytics } from './data/analytics';
import { AboutPage } from './pages/AboutPage';
import { DashboardPage } from './pages/DashboardPage';
import { DictionaryPage } from './pages/DictionaryPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
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
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
