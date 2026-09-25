/**
 * PageTransition — wraps a route's content with a soft fade + slight rise.
 *
 * Usage: drop into a <Layout> body around <Outlet />, or wrap a single page.
 *   <AnimatePresence mode="wait">
 *     <PageTransition key={location.pathname}>
 *       <Outlet />
 *     </PageTransition>
 *   </AnimatePresence>
 *
 * The combination is necessary: AnimatePresence needs a key change to
 * trigger exit animation, and a unique key per route is the standard way.
 *
 * Тайминги под рабочий инструмент: уход 120 мс + приход 180 мс (mode="wait"
 * складывает их) — переход заметен, но не задерживает десятки операций в час.
 * Сдвиг по Y отключается системной настройкой reduced-motion через
 * <MotionConfig reducedMotion="user"> в Layout; остаётся только fade.
 */
import { motion } from 'framer-motion';
import { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
  /** Disable rise animation — use for inner-tab swaps where movement
   *  becomes distracting. */
  fadeOnly?: boolean;
}

export default function PageTransition({ children, fadeOnly = false }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: fadeOnly ? 0 : 4 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.25, 1, 0.5, 1] } }}
      exit={{ opacity: 0, y: fadeOnly ? 0 : -2, transition: { duration: 0.12, ease: [0.4, 0, 1, 1] } }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {children}
    </motion.div>
  );
}
