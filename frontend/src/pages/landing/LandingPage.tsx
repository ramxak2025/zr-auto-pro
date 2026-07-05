import { useEffect } from 'react';
import { useNavigationType } from 'react-router-dom';
import Header from './sections/Header';
import Hero from './sections/Hero';
import Roles from './sections/Roles';
import Features from './sections/Features';
import Reliability from './sections/Reliability';
import Platforms from './sections/Platforms';
import CtaSection from './sections/CtaSection';
import Faq from './sections/Faq';
import Footer from './sections/Footer';
import GlassTabBar from './sections/GlassTabBar';

/**
 * Публичный лендинг на корне autexa.pw для неавторизованных.
 * Авторизованные на «/» сразу уезжают в /dashboard (роутинг в App.tsx).
 * Отдельный lazy-чанк — бандл залогиненных не раздувается.
 *
 * Тема — светлая (доверие, «дневной» продукт): фон #FAFAFA, белые карточки
 * с мягкими тенями, пастельный gradient-mesh в hero.
 */
export default function LandingPage() {
  const navigationType = useNavigationType();

  useEffect(() => {
    const root = document.documentElement;
    const prevScroll = root.style.scrollBehavior;
    const prevBodyBg = document.body.style.backgroundColor;
    // Плавный скролл по якорям — только если пользователь не просил меньше движения
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.style.scrollBehavior = 'smooth';
    }
    // Светлый фон и на body — чтобы overscroll не мигал другим цветом
    document.body.style.backgroundColor = '#FAFAFA';
    // Светлый theme-color хрома браузера на время лендинга; при уходе
    // восстанавливается базовый #2563eb из index.html (цвет приложения)
    const themeMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const prevTheme = themeMeta?.getAttribute('content') ?? null;
    themeMeta?.setAttribute('content', '#FAFAFA');
    return () => {
      root.style.scrollBehavior = prevScroll;
      document.body.style.backgroundColor = prevBodyBg;
      if (themeMeta && prevTheme !== null) themeMeta.setAttribute('content', prevTheme);
    };
  }, []);

  // react-router при SPA-переходе не скроллит ни к hash-якорю, ни к верху:
  // крошки с /f/:slug («Возможности» → /#features, «Autexa» → /) без этого
  // оставляли страницу на произвольном offset'е. POP (кнопка «назад») не
  // трогаем — браузер сам восстанавливает позицию. Секции уже имеют scroll-mt-24.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (target) {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    } else if (navigationType !== 'POP') {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    // Только на маунте: hash-навигацию ВНУТРИ лендинга (шапка, GlassTabBar)
    // браузер обрабатывает сам — нативные <a href="#...">.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      id="top"
      className="min-h-screen bg-[#FAFAFA] pb-28 text-slate-900 antialiased selection:bg-primary-500/20 md:pb-0"
    >
      <Header />
      <Hero />
      <Roles />
      <Features />
      <Reliability />
      <Platforms />
      <CtaSection />
      <Faq />
      <Footer />
      {/* Liquid-glass нижнее меню — только мобилка; pb-28 выше даёт футеру место под баром */}
      <GlassTabBar />
    </div>
  );
}
