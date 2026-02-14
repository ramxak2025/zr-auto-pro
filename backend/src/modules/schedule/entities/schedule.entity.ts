import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export type LateStatus = 'on_time' | 'late_minor' | 'late_major';

@Entity('schedules')
@Index(['tenantId', 'userId', 'date'], { unique: true })
export class Schedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  tenantId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid')
  userId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 5, default: '09:00' })
  shiftStart: string;

  @Column({ type: 'varchar', length: 5, default: '18:00' })
  shiftEnd: string;

  @Column({ type: 'boolean', default: false })
  isDayOff: boolean;

  @Column({ type: 'timestamp', nullable: true })
  actualArrival: Date;

  @Column({ type: 'int', default: 0 })
  lateMinutes: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  lateStatus: LateStatus;

  @Column({ type: 'text', nullable: true })
  note: string;

  @Column({ type: 'boolean', default: false })
  isManualOverride: boolean;
}
