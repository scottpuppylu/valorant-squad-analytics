import { lazy, Suspense } from 'react';
import { LoadingPanel } from './components/EmptyState';
import { PageErrorBoundary } from './components/PageErrorBoundary';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
const AboutPage = lazy(() => import('./pages/AboutPage').then((module) => ({ default: module.AboutPage })));
import { DashboardPage } from './pages/DashboardPage';
const DictionaryPage = lazy(() => import('./pages/DictionaryPage').then((module) => ({ default: module.DictionaryPage })));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage').then((module) => ({ default: module.LeaderboardPage })));
const ComparePage = lazy(() => import('./pages/ComparePage').then((module) => ({ default: module.ComparePage })));
const MapsPage = lazy(() => import('./pages/MapsPage').then((module) => ({ default: module.MapsPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then((module) => ({ default: module.AgentsPage })));
const MatchesPage = lazy(() => import('./pages/MatchesPage').then((module) => ({ default: module.MatchesPage })));
const PlayerProfilePage = lazy(() => import('./pages/PlayerProfilePage').then((module) => ({ default: module.PlayerProfilePage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then((module) => ({ default: module.PrivacyPage })));
const ConnectPage = lazy(() => import('./pages/ConnectPage').then((module) => ({ default: module.ConnectPage })));
import { publicRoutePaths } from './routes';
import { DatasetRuntimeBoundary } from './components/DatasetRuntimeBoundary';
import { useDataset } from './hooks/useDataset';
const WeaponsPage = lazy(() => import('./pages/WeaponsPage').then((module) => ({ default: module.WeaponsPage })));
const SynergyPage = lazy(() => import('./pages/SynergyPage').then((module) => ({ default: module.SynergyPage })));

function DefaultPlayerRoute() {
  const { analytics } = useDataset();
  const playerId = analytics.playerAnalytics[0]?.player.id;
  return <Navigate replace to={playerId ? `/players/${playerId}` : '/'} />;
}

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <PageErrorBoundary><Suspense fallback={<LoadingPanel title="正在載入頁面" />}><Routes>
          <Route element={<DatasetRuntimeBoundary />}>
            <Route path={publicRoutePaths.dashboard} element={<DashboardPage />} />
            <Route path={publicRoutePaths.leaderboard} element={<LeaderboardPage />} />
            <Route path={publicRoutePaths.compare} element={<ComparePage />} />
            <Route path={publicRoutePaths.synergy} element={<SynergyPage />} />
            <Route path={publicRoutePaths.maps} element={<MapsPage />} />
            <Route path={publicRoutePaths.agents} element={<AgentsPage />} />
            <Route path={publicRoutePaths.weapons} element={<WeaponsPage />} />
            <Route path={publicRoutePaths.matches} element={<MatchesPage />} />
            <Route path="/players" element={<DefaultPlayerRoute />} />
            <Route path={publicRoutePaths.players} element={<PlayerProfilePage />} />
          </Route>
          <Route path={publicRoutePaths.connect} element={<ConnectPage />} />
          <Route path={publicRoutePaths.dictionary} element={<DictionaryPage />} />
          <Route path={publicRoutePaths.about} element={<AboutPage />} />
          <Route path={publicRoutePaths.privacy} element={<PrivacyPage />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes></Suspense></PageErrorBoundary>
      </AppShell>
    </HashRouter>
  );
}
