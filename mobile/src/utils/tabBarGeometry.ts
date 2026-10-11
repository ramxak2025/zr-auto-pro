/** Single geometry shared by floating bars and scroll containers on both OSes. */
export const TAB_BAR_ROW_HEIGHT = 60;
export const TAB_BAR_TOP_GAP = 6;
export const TAB_BAR_BOTTOM_GAP = 8;
export function floatingTabBarHeight(safeBottom: number): number {
  return TAB_BAR_ROW_HEIGHT + TAB_BAR_TOP_GAP + TAB_BAR_BOTTOM_GAP + Math.max(safeBottom, 8);
}
export function reservedScrollBottom(paddingBottom: number, contentInsetBottom: number, barHeight: number): number {
  return Math.max(paddingBottom, contentInsetBottom, barHeight + 16);
}
