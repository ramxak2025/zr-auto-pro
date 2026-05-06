import * as React from 'react';
import { Platform, View, ViewStyle, StyleProp, NativeSyntheticEvent } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

/**
 * AutexaScheduleGrid — premium native iOS schedule grid.
 *
 * On iOS this resolves to the Swift `AutexaScheduleGridView` (see
 * mobile/modules/autexa-liquid-glass/ios/AutexaScheduleGridView.swift):
 *   • single UIScrollView, sticky header, sticky names column
 *   • cell tap fires onCellPress event back to JS
 *   • smooth native scroll without RN→bridge round-trips
 *
 * On Android (or as a defensive fallback if the native module isn't
 * registered) the component returns null — the calling site is expected
 * to detect Platform.OS !== 'ios' and render the existing RN
 * implementation instead.
 */

export interface AutexaScheduleUser {
  id: string;
  fullName: string;
  /** Two-letter initials for the round avatar. */
  initials: string;
}

export type AutexaScheduleStatus = 'work' | 'off' | 'sick' | 'late_minor' | 'late_major' | 'absent';

export interface AutexaScheduleEntry {
  userId: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  status: AutexaScheduleStatus;
}

export interface AutexaScheduleGridProps {
  users: AutexaScheduleUser[];
  entries: AutexaScheduleEntry[];
  /** ISO `YYYY-MM-DD`, inclusive. */
  dateFromISO: string;
  /** ISO `YYYY-MM-DD`, inclusive. */
  dateToISO: string;
  /** ISO `YYYY-MM-DD` of "today" — gets a primary highlight. */
  todayISO: string;
  cellWidth?: number;
  rowHeight?: number;
  nameColumnWidth?: number;
  headerHeight?: number;
  onCellPress?: (e: { userId: string; dateISO: string }) => void;
  style?: StyleProp<ViewStyle>;
}

interface NativeProps {
  usersJSON: string;
  entriesJSON: string;
  dateFromISO: string;
  dateToISO: string;
  todayISO: string;
  cellWidth: number;
  rowHeight: number;
  nameColumnWidth: number;
  headerHeight: number;
  onCellPress?: (e: NativeSyntheticEvent<{ userId: string; dateISO: string }>) => void;
  style?: StyleProp<ViewStyle>;
}

let NativeGridView: React.ComponentType<NativeProps> | null = null;
try {
  NativeGridView = requireNativeViewManager('AutexaScheduleGrid');
} catch {
  NativeGridView = null;
}

/** Returns true when the native module is available on this build. The
 *  caller can use this to gate whether to render <AutexaScheduleGrid />
 *  or fall back to the existing RN grid. */
export const isAutexaScheduleGridAvailable = Platform.OS === 'ios' && !!NativeGridView;

export function AutexaScheduleGrid(props: AutexaScheduleGridProps) {
  const {
    users,
    entries,
    dateFromISO,
    dateToISO,
    todayISO,
    cellWidth = 44,
    rowHeight = 56,
    nameColumnWidth = 112,
    headerHeight = 44,
    onCellPress,
    style,
  } = props;

  if (!isAutexaScheduleGridAvailable || !NativeGridView) {
    // Caller is expected to detect this and render their RN fallback.
    return <View style={style} />;
  }

  // Serialize via JSON once per render — much cheaper than dispatching
  // Native props for each user/entry separately (which would cost an RN
  // bridge call per object per change). One string update per relayout.
  const usersJSON = React.useMemo(() => JSON.stringify(users), [users]);
  const entriesJSON = React.useMemo(() => JSON.stringify(entries), [entries]);

  return (
    <NativeGridView
      usersJSON={usersJSON}
      entriesJSON={entriesJSON}
      dateFromISO={dateFromISO}
      dateToISO={dateToISO}
      todayISO={todayISO}
      cellWidth={cellWidth}
      rowHeight={rowHeight}
      nameColumnWidth={nameColumnWidth}
      headerHeight={headerHeight}
      onCellPress={(e) => onCellPress?.(e.nativeEvent)}
      style={style}
    />
  );
}
