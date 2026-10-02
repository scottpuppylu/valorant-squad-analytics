import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { primaryNavigation, secondaryNavigation, zhTW } from '../i18n/zhTW';
import { useDataset } from '../hooks/useDataset';
import { SourceBadge } from './SourceBadge';

export function AppShell({ children }: { children: ReactNode }) {
  const { status, source, message } = useDataset();
  const refreshing = status === 'stale' && message === '正在更新持久化資料…';
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLElement>(null);
  const moreMenu = useRef<HTMLElement>(null);
  const main = useRef<HTMLElement>(null);
  const previous = useRef(pathname);
  useEffect(() => {
    if (previous.current !== pathname) {
      main.current?.focus();
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    previous.current = pathname;
  }, [pathname]);
  useEffect(() => { if (open) menu.current?.querySelector('a')?.focus(); }, [open]);
  useEffect(() => { if (more) moreMenu.current?.querySelector('a')?.focus(); }, [more]);
  const linkClass = ({ isActive }: { isActive: boolean }) => 'nav-link ' + (isActive ? 'nav-link--active' : '');
  const close = () => { setOpen(false); setMore(false); main.current?.focus(); };
  const links = (items: typeof primaryNavigation | typeof secondaryNavigation) => items.map((link) => <NavLink key={link.to} to={link.to} end={link.to === '/'} className={linkClass} onClick={close}>{link.label}</NavLink>);
  return <div className="min-h-screen bg-ink text-slate-200" onKeyDown={(event) => {
    if (event.key === 'Escape' && (open || more)) { close(); (open ? menuButton : moreButton).current?.focus(); }
  }}>
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); main.current?.focus(); }}>跳至主要內容</a>
    <header className="app-header">
      <div className="shell-container header-row">
        <NavLink to="/" className="brand-link" onClick={close}><span className="brand-mark" aria-hidden="true">哥</span><span><strong>{zhTW.brand.name}</strong><small>{zhTW.brand.subtitle}</small></span></NavLink>
        <nav className="desktop-nav" aria-label="主要導覽">{links(primaryNavigation)}
          <div className="more-navigation" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMore(false); }}>
            <button ref={moreButton} type="button" className="nav-link" aria-expanded={more} aria-controls="more-navigation" onClick={() => setMore((value) => !value)}>更多</button>
            {more ? <nav ref={moreMenu} id="more-navigation" className="more-menu surface-card" aria-label="更多導覽">{links(secondaryNavigation)}</nav> : null}
          </div>
        </nav>
        <SourceBadge source={source} status={status} refreshing={refreshing} />
        <button ref={menuButton} type="button" className="menu-button mobile-menu-toggle" aria-expanded={open} aria-controls="mobile-navigation" aria-label={open ? '關閉導覽選單' : '開啟導覽選單'} onClick={() => setOpen((value) => !value)}><span /><span /><span /></button>
      </div>
      {open ? <nav ref={menu} id="mobile-navigation" className="mobile-nav" aria-label="行動版導覽">{links(primaryNavigation)}<span className="mobile-nav-heading">更多分析與說明</span>{links(secondaryNavigation)}</nav> : null}
    </header>
    <main ref={main} id="main-content" tabIndex={-1} className="shell-container app-main">{children}</main>
    <footer className="app-footer shell-container"><p>社群分析結果，不是 Riot 官方排名、MMR 或 Elo。</p><div><SourceBadge source={source} status={status} refreshing={refreshing} /><NavLink to="/about">關於本站</NavLink><NavLink to="/privacy">隱私說明</NavLink></div></footer>
  </div>;
}
