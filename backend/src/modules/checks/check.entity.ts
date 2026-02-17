import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { User } from '../users/user.entity';
import { Client } from '../clients/client.entity';
import { Car } from '../cars/car.entity';
import { CheckServiceLine } from './check-service-line.entity';
import { CheckProductLine } from './check-product-line.entity';

@Entity('checks')
export class Check {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column({ type: 'int', generated: 'increment' })
  number: number;

  @Column({ type: 'date' })
  date: string;

  @Column({ nullable: true })
  masterId: string;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'masterId' })
  master: User;

  @Column({ nullable: true })
  clientId: string;

  @ManyToOne(() => Client, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'clientId' })
  client: Client;

  @Column({ nullable: true })
  carId: string;

  @ManyToOne(() => Car, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'carId' })
  car: Car;

  @Column({ type: 'int', nullable: true })
  mileage: number;

  @Column({ nullable: true })
  comment: string;

  @Column({ type: 'float', default: 0 })
  discount: number;

  @Column({ default: false })
  isDeferred: boolean;

  @Column({ default: 'cash' })
  paymentMethod: string;

  @Column({ type: 'float', default: 0 })
  serviceTotal: number;

  @Column({ type: 'float', default: 0 })
  productTotal: number;

  @Column({ type: 'float', default: 0 })
  totalRevenue: number;

  @Column({ type: 'float', default: 0 })
  productCostTotal: number;

  @Column({ type: 'float', default: 0 })
  serviceSalaryTotal: number;

  @Column({ type: 'float', default: 0 })
  totalCost: number;

  @Column({ type: 'float', default: 0 })
  profit: number;

  @OneToMany(() => CheckServiceLine, (s) => s.check, { cascade: true, eager: true })
  services: CheckServiceLine[];

  @OneToMany(() => CheckProductLine, (p) => p.check, { cascade: true, eager: true })
  products: CheckProductLine[];

  @CreateDateColumn()
  createdAt: Date;
}
