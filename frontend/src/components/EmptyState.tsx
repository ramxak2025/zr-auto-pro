import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { Button } from '../ui/Button';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Компактный вариант для ячеек таблиц и маленьких карточек. */
  compact?: boolean;
}

/**
 * Пустое состояние: «здесь пока пусто» + что сделать дальше. Не используйте
 * его для ОШИБОК загрузки — для них QueryState/DataTable показывают отдельный
 * блок с «Повторить» (аудит T1: ошибка ≠ пусто).
 */
export default function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-14'}`}
    >
      {Icon && (
        <span
          className={`mb-4 flex items-center justify-center rounded-full bg-surface-3 ${compact ? 'h-11 w-11' : 'h-14 w-14'}`}
        >
          <Icon className={`${compact ? 'h-5 w-5' : 'h-6 w-6'} text-ink-4`} aria-hidden="true" />
        </span>
      )}
      <h3 className={`font-semibold text-ink ${compact ? 'text-sm' : 'text-md'}`}>{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-3">{description}</p>}
      {action && (
        <Button variant="primary" size={compact ? 'sm' : 'md'} onClick={action.onClick} className="mt-4">
          {action.label}
        </Button>
      )}
    </motion.div>
  );
}
