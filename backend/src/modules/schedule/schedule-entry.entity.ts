import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('schedule_entries')
export class ScheduleEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'time' })
  shiftStart: string;

  @Column({ type: 'time' })
  shiftEnd: string;

  @Column({ default: false })
  isDayOff: boolean;

  @Column({ type: 'time', nullable: true })
  actualArrival: string;

  @Column({ type: 'int', default: 0 })
  lateMinutes: number;

  @Column({ nullable: true })
  lateStatus: string;

  @Column({ nullable: true })
  note: string;

  @Column({ default: false })
  isManualOverride: boolean;
}
