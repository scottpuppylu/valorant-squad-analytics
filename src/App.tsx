import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { playerAnalytics } from './data/analytics';
import { DashboardPage } from './pages/DashboardPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { PlayerProfilePage } from './pages/PlayerProfilePage';

export default function App() {
  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/players" element={<Navigate replace to={'/players/' + playerAnalytics[0]!.player.id} />} />
          <Route path="/players/:playerId" element={<PlayerProfilePage />} />
          <Route path="/compare" element={<PlaceholderPage eyebrow="Planned analysis" title="Player comparison" description="Compare role-adjusted category shapes and raw statistics without forcing unlike responsibilities onto one scale." nextTask="TASK-003" />} />
          <Route path="/maps" element={<PlaceholderPage eyebrow="Planned analysis" title="Map performance" description="Review map-level records, round samples and role composition once deeper filters are introduced." nextTask="TASK-003" />} />
          <Route path="/agents" element={<PlaceholderPage eyebrow="Planned analysis" title="Agents & roles" description="Explore role value and agent-specific samples while keeping small-sample caveats visible." nextTask="TASK-002" />} />
          <Route path="/synergy" element={<PlaceholderPage eyebrow="Planned analysis" title="Duo synergy" description="Inspect pair performance only after the data model can support meaningful shared-round evidence." nextTask="TASK-004" />} />
          <Route path="/matches" element={<PlaceholderPage eyebrow="Planned analysis" title="Match history" description="The demo dataset already contains 32 match records; the dedicated explorer arrives with cross-filters." nextTask="TASK-003" />} />
          <Route path="/import" element={<PlaceholderPage eyebrow="Planned workflow" title="Data import" description="CSV and JSON validation will be added after the static scoring foundation is proven." nextTask="TASK-009" />} />
          <Route path="/scoring" element={<PlaceholderPage eyebrow="Transparent by design" title="Scoring settings" description="The current formulas are documented in docs/SCORING.md. Adjustable weights and the complete eight-dimension engine remain deliberately out of TASK-001." nextTask="TASK-002" />} />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </AppShell>
    </HashRouter>
  );
}
