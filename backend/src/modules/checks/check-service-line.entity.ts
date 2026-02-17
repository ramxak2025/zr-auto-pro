import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Check } from './check.entity';
import { User } from '../users/user.entity';

@Entity('check_service_lines')
export class CheckServiceLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  checkId: string;

  @ManyToOne(() => Check, (c) => c.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column({ nullable: true })
  serviceId: string;

  @Column({ nullable: true })
  masterId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'masterId' })
  master: User;

  @Column()
  name: string;

  @Column({ type: 'float' })
  price: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'float' })
  total: number;
}
