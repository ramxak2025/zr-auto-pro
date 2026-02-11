import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Supplier } from './supplier.entity';

@Entity('supplier_payments')
export class SupplierPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Supplier, (s) => s.payments)
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column('uuid')
  supplierId: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  date: Date;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @CreateDateColumn()
  createdAt: Date;
}
