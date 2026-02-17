import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('work_modes')
export class WorkMode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  name: string;

  @Column({ default: 'rotating' })
  type: string;

  @Column({ type: 'int', default: 2 })
  workDays: number;

  @Column({ type: 'int', default: 2 })
  offDays: number;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  weekDays: number[];

  @Column({ type: 'time', default: '09:00' })
  shiftStart: string;

  @Column({ type: 'time', default: '18:00' })
  shiftEnd: string;
}
