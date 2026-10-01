import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { primaryNavigation, secondaryNavigation, zhTW } from '../i18n/zhTW';
import { useDataset } from '../hooks/useDataset';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { dataset: activeDataset, status, source } = useDataset();
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
            <span className="brand-mark" aria-hidden="true">哥</span>
            <span>
              <strong className="block text-sm tracking-[0.18em] text-white">{zhTW.brand.name}</strong>
              <small className="block text-[10px] tracking-[0.16em] text-emerald-300/70">{zhTW.brand.subtitle}</small>
            </span>
          </NavLink>
          <nav className="hidden items-center gap-1 xl:flex" aria-label="主要導覽">
            {primaryNavigation.map((link) => <NavLink key={link.to} to={link.to} className={linkClass}>{link.label}</NavLink>)}
          </nav>
          <div className="hidden items-center gap-3 xl:flex">
            <span className="data-pill"><span /> 資料來源：{status === 'loading' ? '載入中' : source === 'REAL_SERVER' ? '公開真實戰績' : zhTW.brand.demo}</span>
            <NavLink to="/dictionary" className="button-secondary">查看公式</NavLink>
          </div>
          <button
            type="button"
            className="menu-button xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-navigation"
            aria-label={open ? '關閉導覽選單' : '開啟導覽選單'}
            onClick={() => setOpen((value) => !value)}
          >
            <span /><span /><span />
          </button>
        </div>
        {open ? (
          <nav id="mobile-navigation" className="mobile-nav xl:hidden" aria-label="行動版導覽">
            {[...primaryNavigation, ...secondaryNavigation].map((link) => (
              <NavLink key={link.to} to={link.to} className={linkClass} onClick={() => setOpen(false)}>{link.label}</NavLink>
            ))}
          </nav>
        ) : null}
      </header>
      <main className="relative z-10 mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">{children}</main>
      <footer className="relative z-10 border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-3 px-4 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>非官方社群分析工具 · 資料來源：{activeDataset.mode === 'REAL' ? '公開真實戰績' : '虛構示範資料'}</p>
          <div className="flex flex-wrap gap-4">
            {secondaryNavigation.map((link) => <NavLink key={link.to} to={link.to} className="hover:text-slate-300">{link.label}</NavLink>)}
          </div>
        </div>
      </footer>
    </div>
  );
}
