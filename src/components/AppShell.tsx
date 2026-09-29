import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

const primaryLinks = [
  { to: '/', label: 'Dashboard' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/players/nova-hex', label: 'Players' },
  { to: '/maps', label: 'Maps' },
  { to: '/matches', label: 'Matches' },
];

const secondaryLinks = [
  { to: '/compare', label: 'Compare' },
  { to: '/agents', label: 'Agents & roles' },
  { to: '/synergy', label: 'Duo synergy' },
  { to: '/import', label: 'Data import' },
  { to: '/scoring', label: 'Scoring' },
];

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const [open, setOpen] = useState(false);
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    'nav-link ' + (isActive ? 'nav-link--active' : '');

  return (
    <div className="min-h-screen bg-ink text-slate-200">
      <div className="ambient ambient--one" />
      <div className="ambient ambient--two" />
      <header className="app-header">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-3" onClick={() => setOpen(false)}>
            <span className="brand-mark" aria-hidden="true">SA</span>
            <span>
              <strong className="block text-sm tracking-[0.18em] text-white">SQUAD ANALYTICS</strong>
              <small className="block text-[10px] uppercase tracking-[0.16em] text-emerald-300/70">Community metrics</small>
            </span>
          </NavLink>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
            {primaryLinks.map((link) => <NavLink key={link.to} to={link.to} className={linkClass}>{link.label}</NavLink>)}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <span className="data-pill"><span /> DEMO DATA</span>
            <NavLink to="/scoring" className="button-secondary">View formulas</NavLink>
          </div>
          <button
            type="button"
            className="menu-button lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label="Toggle navigation"
            onClick={() => setOpen((value) => !value)}
          >
            <span /><span /><span />
          </button>
        </div>
        {open ? (
          <nav id="mobile-navigation" className="mobile-nav lg:hidden" aria-label="Mobile navigation">
            {[...primaryLinks, ...secondaryLinks].map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass} onClick={() => setOpen(false)}>{link.label}</NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="relative z-10 mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">{children}</main>
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>Unofficial community analytics · Fictional demo data</p>
          <div className="flex flex-wrap gap-4">
            {secondaryLinks.map((link) => <NavLink key={link.to} to={link.to} className="hover:text-slate-300">{link.label}</NavLink>)}
          </div>
        </div>
      </footer>
    </div>
  );
}
