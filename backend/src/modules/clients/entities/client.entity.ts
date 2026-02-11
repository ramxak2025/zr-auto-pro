import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { Car } from '../../cars/entities/car.entity';
import { Check } from '../../checks/entities/check.entity';

@Index(['phone', 'tenantId'], { unique: true })
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  tenantId: string;

  @Column()
  fullName: string;

  @Index()
  @Column()
  phone: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @OneToMany(() => Car, (car) => car.client)
  cars: Car[];

  @OneToMany(() => Check, (check) => check.client)
  checks: Check[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
