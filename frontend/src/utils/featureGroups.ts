// Buckets the canonical plan feature registry (shared/constants/features.ts) by
// its `group` so the admin plan editor + the public tariff page can render the
// 23 toggles/rows under section headings instead of one flat wall. Pure UI
// sectioning — `group` carries no enforcement meaning.
import { ALL_FEATURES, type FeatureDef, type FeatureGroup } from '../../../shared/constants/features';

export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  core: 'Основное',
  section: 'Разделы',
  integration: 'Интеграции',
};

const GROUP_ORDER: readonly FeatureGroup[] = ['core', 'section', 'integration'];

export interface FeatureGroupBucket {
  group: FeatureGroup;
  label: string;
  items: FeatureDef[];
}

/** ALL_FEATURES bucketed by `group`, in canonical order, empty groups dropped. */
export const FEATURE_GROUPS: FeatureGroupBucket[] = GROUP_ORDER.map((group) => ({
  group,
  label: FEATURE_GROUP_LABELS[group],
  items: ALL_FEATURES.filter((f) => f.group === group),
})).filter((bucket) => bucket.items.length > 0);
