import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

@Entity('work_modes')
export class WorkMode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  tenantId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 20, default: 'weekly' })
  type: 'rotating' | 'weekly';

  /** For rotating: e.g. workDays=2, offDays=2 → "2/2" schedule */
  @Column({ type: 'int', default: 5 })
  workDays: number;

  /** For rotating: number of consecutive off days */
  @Column({ type: 'int', default: 2 })
  offDays: number;

  /** For weekly: array of weekday numbers [1=Mon..7=Sun] */
  @Column({ type: 'jsonb', default: [1, 2, 3, 4, 5] })
  weekDays: number[];

  @Column({ type: 'varchar', length: 5, default: '09:00' })
  shiftStart: string;

  @Column({ type: 'varchar', length: 5, default: '18:00' })
  shiftEnd: string;
}
