import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  Index,
  JoinColumn,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { Check } from '../../checks/entities/check.entity';

@Index(['plateNumber', 'tenantId'], { unique: true })
@Entity('cars')
export class Car {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  tenantId: string;

  @Index()
  @Column()
  plateNumber: string;

  @Column()
  makeModel: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @ManyToOne(() => Client, (client) => client.cars, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column('uuid')
  clientId: string;

  @OneToMany(() => Check, (check) => check.car)
  checks: Check[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
