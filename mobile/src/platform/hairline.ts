/**
 * Hairline constants.
 * StyleSheet.hairlineWidth is 0.5 on iOS and 1 on Android (in dip) — it's
 * exactly what we want for dividers/borders so they read "crisp" at any
 * pixel density. Re-exported so imports are semantic.
 */
import { StyleSheet } from 'react-native';

export const HAIRLINE = StyleSheet.hairlineWidth;
