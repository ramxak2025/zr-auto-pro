import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { Car } from '../../cars/entities/car.entity';
import { User } from '../../users/entities/user.entity';
import { CheckService } from './check-service.entity';
import { CheckProduct } from './check-product.entity';

export enum PaymentMethod {
  CASH = 'cash',
  CARD = 'card',
  TRANSFER = 'transfer',
  MIXED = 'mixed',
}

@Entity('checks')
export class Check {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  tenantId: string;

  @Index()
  @Column({ type: 'int', generated: 'increment' })
  number: number;

  @Index()
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  @ManyToOne(() => User, (user) => user.checks)
  @JoinColumn({ name: 'masterId' })
  master: User;

  @Index()
  @Column('uuid')
  masterId: string;

  @ManyToOne(() => Client, (client) => client.checks)
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column('uuid')
  clientId: string;

  @ManyToOne(() => Car, (car) => car.checks)
  @JoinColumn({ name: 'carId' })
  car: Car;

  @Column('uuid')
  carId: string;

  @Column({ type: 'int', nullable: true })
  mileage: number;

  @OneToMany(() => CheckService, (cs) => cs.check, { cascade: true, eager: true })
  services: CheckService[];

  @OneToMany(() => CheckProduct, (cp) => cp.check, { cascade: true, eager: true })
  products: CheckProduct[];

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.CASH })
  paymentMethod: PaymentMethod;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  serviceTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  productTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalRevenue: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  productCostTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  serviceSalaryTotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalCost: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  profit: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discount: number;

  @Column({ type: 'boolean', default: false })
  isDeferred: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
