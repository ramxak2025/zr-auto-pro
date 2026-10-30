// Core-only, function calls only: no CSSPlugin, DOM targets or per-frame React updates.
const headlessConfig = { headless: true, autoSleep: 30 };
let enginePromise: Promise<typeof import('gsap/gsap-core').gsap> | undefined;
function ownerGsap() {
  // Legacy/disabled and Reduce Motion paths never wake the GSAP ticker.
  return (enginePromise ??= import('gsap/gsap-core').then(({ gsap }) => {
    gsap.config(headlessConfig);
    return gsap;
  }));
}

export function startOwnerHomeSequence({
  reducedMotion,
  isCurrent,
  reveal,
  draw,
  settle,
}: {
  reducedMotion: boolean;
  isCurrent: () => boolean;
  reveal: () => void;
  draw: () => void;
  settle?: () => void;
}): () => void {
  let alive = true;
  const invoke = (callback: () => void) => () => {
    if (alive && isCurrent()) callback();
  };
  if (reducedMotion) {
    invoke(reveal)();
    invoke(draw)();
    if (settle) invoke(settle)();
    return () => {
      alive = false;
    };
  }
  let timeline: ReturnType<typeof import('gsap/gsap-core').gsap.timeline> | undefined;
  if (isCurrent())
    void ownerGsap()
      .then((engine) => {
        if (!alive || !isCurrent()) return;
        timeline = engine.timeline({ paused: true });
        timeline.call(invoke(reveal), [], 0).call(invoke(draw), [], 0.05);
        if (settle) timeline.call(invoke(settle), [], 0.4);
        timeline.play(0);
      })
      .catch(() => {
        // Animation is noncritical: exact validated data must remain visible if loading its scheduler fails.
        invoke(reveal)();
        invoke(draw)();
        if (settle) invoke(settle)();
      });
  return () => {
    alive = false;
    timeline?.kill();
  };
}
