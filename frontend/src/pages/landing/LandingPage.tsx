import { useEffect } from 'react';
import Header from './sections/Header';
import Hero from './sections/Hero';
import Features from './sections/Features';
import Reliability from './sections/Reliability';
import Platforms from './sections/Platforms';
import CtaSection from './sections/CtaSection';
import Faq from './sections/Faq';
import Footer from './sections/Footer';

/**
 * Публичный лендинг на корне autexa.pw для неавторизованных.
 * Авторизованные на «/» сразу уезжают в /dashboard (роутинг в App.tsx).
 * Отдельный lazy-чанк — бандл залогиненных не раздувается.
 */
export default function LandingPage() {
  useEffect(() => {
    const root = document.documentElement;
    const prevScroll = root.style.scrollBehavior;
    const prevBodyBg = document.body.style.backgroundColor;
    // Плавный скролл по якорям — только если пользователь не просил меньше движения
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.style.scrollBehavior = 'smooth';
    }
    // Тёмный фон и на body — чтобы overscroll не мигал серым
    document.body.style.backgroundColor = '#0A0A0B';
    return () => {
      root.style.scrollBehavior = prevScroll;
      document.body.style.backgroundColor = prevBodyBg;
    };
  }, []);

  return (
    <div id="top" className="min-h-screen bg-[#0A0A0B] text-white antialiased selection:bg-primary-500/30">
      <Header />
      <Hero />
      <Features />
      <Reliability />
      <Platforms />
      <CtaSection />
      <Faq />
      <Footer />
    </div>
  );
}
