/**
 * Platform primitives — one import site for everything adaptive.
 * Usage: `import { Text, Icon, shadow, haptic, PressableScale } from '../platform';`
 */
export { shadow, type ShadowLevel } from './shadow';
export { haptic, type HapticIntent } from './haptics';
export { HAIRLINE } from './hairline';
export {
  preferSpring,
  SPRING_TIGHT,
  SPRING_SOFT,
  SPRING_PRESS,
  TIMING_STANDARD,
  TIMING_EMPHASISED,
  TIMING_FAST,
} from './motion';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { Text, textVariantStyles, type TextVariant, type TextProps } from './Typography';
export { Icon, type IconName, type IconProps } from './Icon';
export {
  iosCard,
  iosCardAccent,
  iosCardCompact,
  iosPill,
  iosSectionLabel,
  SQUIRCLE_RADIUS,
  PILL_RADIUS,
} from './iosSurface';
