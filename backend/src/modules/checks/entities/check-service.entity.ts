import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Check } from './check.entity';
import { Service } from '../../services/entities/service.entity';
import { User } from '../../users/entities/user.entity';

@Entity('check_services')
export class CheckService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Check, (check) => check.services, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column('uuid')
  checkId: string;

  @ManyToOne(() => Service, { nullable: true })
  @JoinColumn({ name: 'serviceId' })
  service: Service;

  @Column('uuid', { nullable: true })
  serviceId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'masterId' })
  master: User;

  @Column('uuid', { nullable: true })
  masterId: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;
}
