import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

// Smoothed outer alpha contour of the existing mobile/assets/logo.png cloud,
// sampled from its left 600 × 363 region before the wordmark. The asset is unchanged.
const cloudPath =
  'M250 3 C269.83 2.17 297.17 5.33 316 11 C334.83 16.67 350.17 27 363 37 C375.83 47 382.33 65 393 71 C403.67 77 415 70 427 73 C439 76 453.33 80.83 465 89 C476.67 97.17 489.67 112.33 497 122 C504.33 131.67 506.17 138.33 509 147 C511.83 155.67 506 165.5 514 174 C522 182.5 547.33 191 557 198 C566.67 205 567.67 208.83 572 216 C576.33 223.17 580.83 229.83 583 241 C585.17 252.17 586 272 585 283 C584 294 580.5 299.67 577 307 C573.5 314.33 571 320 564 327 C557 334 544.83 343.83 535 349 C525.17 354.17 537.83 356.5 505 358 C472.17 359.5 406.5 358.5 338 358 C269.5 357.5 139.5 357.33 94 355 C48.5 352.67 74.33 349 65 344 C55.67 339 45.67 332 38 325 C30.33 318 24.5 311 19 302 C13.5 293 7.33 286.5 5 271 C2.67 255.5 0.67 227.17 5 209 C9.33 190.83 20.83 174.33 31 162 C41.17 149.67 53.5 141.83 66 135 C78.5 128.17 96.67 130 106 121 C115.33 112 112.67 95 122 81 C131.33 67 149.5 47.83 162 37 C174.5 26.17 182.33 21.67 197 16 C211.67 10.33 230.17 3.83 250 3 Z';

/** One quiet brand cloud; it never participates in focus, touch, or data. */
export default function OwnerHomeCloud() {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.cloud}
    >
      <Svg width={176} height={106.48} viewBox="0 0 600 363" accessible={false}>
        <Defs>
          <LinearGradient id="owner-home-cloud-fill" x1="0%" y1="0%" x2="88%" y2="100%">
            <Stop offset="0" stopColor="#B5D9FF" stopOpacity={0.12} />
            <Stop offset="0.48" stopColor="#80B8FA" stopOpacity={0.07} />
            <Stop offset="1" stopColor="#5B8FE5" stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Path d={cloudPath} fill="url(#owner-home-cloud-fill)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  cloud: { position: 'absolute', bottom: 24, right: -15, width: 176, height: 106.48 },
});
