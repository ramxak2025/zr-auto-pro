import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import Header from '../sections/Header';
import Footer from '../sections/Footer';
import GlassTabBar from '../sections/GlassTabBar';
import './learning.css';

export default function LearningShell({ title, children }: { title: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef<string>();
  useEffect(() => {
    const pageChanged = previousPath.current !== pathname;
    previousPath.current = pathname;
    if (pageChanged && navigationType !== 'POP') window.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname, navigationType]);
  useEffect(() => {
    const previousTitle = document.title;
    const previousBackground = document.body.style.backgroundColor;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousTheme = meta?.getAttribute('content') ?? null;
    document.title = `${title} — обучение Autexa`;
    document.body.style.backgroundColor = '#FAFAFA';
    meta?.setAttribute('content', '#FAFAFA');
    return () => {
      document.title = previousTitle;
      document.body.style.backgroundColor = previousBackground;
      if (meta && previousTheme !== null) meta.setAttribute('content', previousTheme);
    };
  }, [title]);
  return (
    <div id="top" className="learning font-display">
      <a href="#learning-main" className="learning-skip">
        Перейти к обучению
      </a>
      <Header />
      <main id="learning-main" className="learning-main">
        {children}
      </main>
      <Footer />
      <GlassTabBar />
    </div>
  );
}

export function LearningBreadcrumb({ title }: { title?: string }) {
  return (
    <nav className="learning-breadcrumb" aria-label="Хлебные крошки">
      <Link to="/">Autexa</Link>
      <span aria-hidden="true">/</span>
      {title ? (
        <>
          <Link to="/obuchenie">Обучение</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{title}</span>
        </>
      ) : (
        <span aria-current="page">Обучение</span>
      )}
    </nav>
  );
}
