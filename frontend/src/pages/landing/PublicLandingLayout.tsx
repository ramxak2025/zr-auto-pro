import { Outlet } from 'react-router-dom';
import PageTransition from './gsap/PageTransition';

/**
 * Персистентный layout публичных страниц сайта: «/», «/f/:slug», «/tarify»,
 * «/voprosy». Один экземпляр <PageTransition> остаётся смонтированным, пока
 * пользователь ходит между этими роутами (react-router сохраняет element
 * родительского layout-роута и меняет только <Outlet/>). Поэтому кросс-фейд
 * играет при КАЖДОЙ смене pathname, а не только внутри одного компонента —
 * если бы обёртка жила в каждой странице, свежий маунт на новом роуте всегда
 * попадал бы в ветку «первый рендер = без анимации» и переход не проигрывался.
 *
 * Приватные/app-роуты лежат ВНЕ этого layout — их анимация переходов не
 * касается, а GSAP не попадает в главный бандл: layout грузится тем же
 * lazy-чанком, что и сами страницы сайта (см. App.tsx).
 */
export default function PublicLandingLayout() {
  // overflow-x-clip на обёртке — общий страж горизонтального переполнения для
  // всех публичных страниц (главная, /f/:slug, /tarify, /voprosy), которые
  // переиспользуют секции с декоративными glow/bleed. clip не создаёт scroll-
  // контейнер (overflow-y остаётся visible) и не ломает sticky/fixed; обёртка
  // анимирует только opacity, поэтому containing block для fixed не появляется.
  return (
    <PageTransition className="overflow-x-clip">
      <Outlet />
    </PageTransition>
  );
}
