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
 * Tuned to feel "premium SaaS" — short (220 ms), subtle (4 px slide), no
 * scaling. Anything more dramatic stops feeling app-like and starts feeling
 * like a reveal sequence.
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
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: fadeOnly ? 0 : -4 }}
      transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      {children}
    </motion.div>
  );
}
