/**
 * Визуальная система админки Autexa — единая точка импорта.
 * Описание, токены и правила миграции: docs/web-redesign/DESIGN_SYSTEM.md.
 *
 *   import { Button, Card, CardHeader, DataTable, StatCard, Toolbar } from '../ui';
 *
 * Здесь же реэкспортированы перестилизованные компоненты из components/ —
 * их старые пути импорта продолжают работать.
 */
export { cn } from './cn';
export * from './tokens';

export { Button, buttonClasses } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
export { IconButton } from './IconButton';
export type { IconButtonProps } from './IconButton';

export { Card, CardHeader, CardBody, CardFooter } from './Card';
export type { CardProps, CardHeaderProps } from './Card';
export { StatCard } from './StatCard';
export type { StatCardProps, StatDelta } from './StatCard';
export { Badge, StatusPill } from './Badge';
export type { BadgeProps, StatusPillProps } from './Badge';
export { Skeleton, SkeletonText, SkeletonCard } from './Skeleton';
export { Money } from './Money';

export { Toolbar, ToolbarGroup, ToolbarSeparator, FilterBar } from './Toolbar';
export { Field } from './Field';
export { Input, controlBase, controlInvalid, controlSize } from './Input';
export type { InputProps, ControlSize } from './Input';
export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';
export { Textarea } from './Textarea';
export { Checkbox } from './Checkbox';
export { RadioGroup } from './RadioGroup';
export type { RadioOption } from './RadioGroup';

export { Tabs, TabPanel } from './Tabs';
export type { TabItem, TabsProps } from './Tabs';
export { SegmentedControl } from './SegmentedControl';
export type { SegmentedOption } from './SegmentedControl';

export { Tooltip } from './Tooltip';
export { DropdownMenu } from './DropdownMenu';
export type { MenuEntry } from './DropdownMenu';
export { Drawer } from './Drawer';
export type { DrawerProps } from './Drawer';

export { DataTable } from './DataTable';
export type { DataTableColumn, DataTableProps, SortState, SortDir } from './DataTable';

// Перестилизованные существующие компоненты (API без изменений).
export { default as PageHeader } from '../components/PageHeader';
export { default as Modal } from '../components/Modal';
export { default as ConfirmDialog } from '../components/ConfirmDialog';
export { default as EmptyState } from '../components/EmptyState';
export { default as QueryState } from '../components/QueryState';
export { default as InlineLoader } from '../components/InlineLoader';
export { default as Switch } from '../components/Switch';
export { default as Pagination } from '../components/Pagination';
export { default as SearchInput } from '../components/SearchInput';
export { default as DatePeriodPicker } from '../components/DatePeriodPicker';
