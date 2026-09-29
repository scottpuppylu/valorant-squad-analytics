import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { playerAnalytics } from './data/analytics';
import { AboutPage } from './pages/AboutPage';
import { DashboardPage } from './pages/DashboardPage';
import { DictionaryPage } from './pages/DictionaryPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { ComparePage } from './pages/ComparePage';
import { MapsPage } from './pages/MapsPage';
import { AgentsPage } from './pages/AgentsPage';
import { MatchesPage } from './pages/MatchesPage';
import { PlayerProfilePage } from './pages/PlayerProfilePage';
import { PrivacyPage } from './pages/PrivacyPage';
import { ConnectPage } from './pages/ConnectPage';
import { publicRoutePaths } from './routes';

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path={publicRoutePaths.dashboard} element={<DashboardPage />} />
          <Route path={publicRoutePaths.leaderboard} element={<LeaderboardPage />} />
          <Route path={publicRoutePaths.compare} element={<ComparePage />} />
          <Route path={publicRoutePaths.maps} element={<MapsPage />} />
          <Route path={publicRoutePaths.agents} element={<AgentsPage />} />
          <Route path={publicRoutePaths.matches} element={<MatchesPage />} />
          <Route path={publicRoutePaths.connect} element={<ConnectPage />} />
          <Route path="/players" element={<Navigate replace to={'/players/' + playerAnalytics[0]!.player.id} />} />
          <Route path={publicRoutePaths.players} element={<PlayerProfilePage />} />
          <Route path={publicRoutePaths.dictionary} element={<DictionaryPage />} />
          <Route path={publicRoutePaths.about} element={<AboutPage />} />
          <Route path={publicRoutePaths.privacy} element={<PrivacyPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
