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
import { Delivery } from './delivery.entity';
import { SupplierPayment } from './supplier-payment.entity';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  contactPerson: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalPurchases: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalPaid: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  currentDebt: number;

  @OneToMany(() => Delivery, (d) => d.supplier)
  deliveries: Delivery[];

  @OneToMany(() => SupplierPayment, (p) => p.supplier)
  payments: SupplierPayment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
