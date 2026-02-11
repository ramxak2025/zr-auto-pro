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

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  fullName: string;

  @Index()
  @Column({ unique: true })
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
