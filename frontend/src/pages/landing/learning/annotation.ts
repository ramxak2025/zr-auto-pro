export interface LearningTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LearningAnnotation {
  label?: string;
  kind?: 'click' | 'focus';
  placement?: 'above' | 'below';
}

export function learningZoomScroll(
  target: LearningTarget | undefined,
  image: { width: number; height: number },
  viewport: { width: number; height: number },
) {
  return {
    left: Math.max(
      0,
      Math.min(
        image.width - viewport.width,
        ((target?.x ?? 0) + (target?.width ?? 0) / 2) * image.width - viewport.width / 2,
      ),
    ),
    top: Math.max(
      0,
      Math.min(
        image.height - viewport.height,
        ((target?.y ?? 0) + (target?.height ?? 0) / 2) * image.height - viewport.height / 2,
      ),
    ),
  };
}

export function learningAnnotationGeometry(
  target: LearningTarget,
  preferred?: 'above' | 'below',
  frame = { width: 800, height: 600 },
) {
  const valid =
    [target.x, target.y, target.width, target.height].every(Number.isFinite) &&
    target.x >= 0 &&
    target.y >= 0 &&
    target.width > 0 &&
    target.height > 0 &&
    target.x + target.width <= 1 &&
    target.y + target.height <= 1;
  if (!valid) return null;
  const labelSpace = 28 / Math.max(1, frame.height) + 0.015;
  const pinX = Math.min(0.5, 14 / Math.max(1, frame.width));
  const pinY = Math.min(0.5, 14 / Math.max(1, frame.height));
  const above = target.y >= labelSpace;
  const below = target.y + target.height <= 1 - labelSpace;
  const side = preferred === 'below' && below ? 'below' : above ? 'above' : below ? 'below' : undefined;
  return {
    pin: {
      x: Math.max(pinX, Math.min(1 - pinX, target.x + target.width)),
      y: Math.max(pinY, Math.min(1 - pinY, target.y)),
    },
    label: side
      ? {
          x: Math.max(0.22, Math.min(0.78, target.x + target.width / 2)),
          y: side === 'above' ? target.y - 0.015 : target.y + target.height + 0.015,
          side,
        }
      : null,
  };
}
