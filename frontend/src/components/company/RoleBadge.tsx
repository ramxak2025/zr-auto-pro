import { Badge } from '../../ui/Badge';
import { roleLabels } from '../../../../shared/utils/formatters';

/**
 * Роль сотрудника одной меткой на всех страницах группы «Компания».
 * Роль — категория, а не состояние, поэтому без семантического цвета:
 * контурный нейтральный бейдж (правило «семантика цвета только по смыслу»).
 */
export default function RoleBadge({ role, size = 'md' }: { role: string; size?: 'sm' | 'md' }) {
  return (
    <Badge outline size={size}>
      {roleLabels[role] || role}
    </Badge>
  );
}
