import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
// Per-page memory: status refreshes and receipt remounts cannot replay a burst.
const celebrated = new Set<string>();
export default function BookingFireworks({ requestId, enabled }: { requestId: string; enabled: boolean }) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled || celebrated.has(requestId)) return;
    celebrated.add(requestId);
    if (reduced) return;
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), 1600);
    return () => {
      window.clearTimeout(timer);
      setActive(false);
    };
  }, [enabled, requestId, reduced]);
  if (!active || reduced) return null;
  return (
    <div className="pb-fireworks" aria-hidden="true">
      {Array.from({ length: 24 }, (_, i) => (
        <i
          key={i}
          style={
            {
              '--burst-x': `${Math.cos((i * Math.PI) / 12) * (i % 2 ? 82 : 54)}px`,
              '--burst-y': `${Math.sin((i * Math.PI) / 12) * (i % 2 ? 70 : 48)}px`,
              '--burst-color': ['#1760df', '#299781', '#d79b27'][i % 3],
              animationDelay: `${(i % 3) * 70}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
