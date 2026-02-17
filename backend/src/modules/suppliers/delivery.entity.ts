import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { Supplier } from './supplier.entity';
import { DeliveryItem } from './delivery-item.entity';

@Entity('deliveries')
export class Delivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  supplierId: string;

  @ManyToOne(() => Supplier, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'supplierId' })
  supplier: Supplier;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'float', default: 0 })
  totalAmount: number;

  @Column({ default: 'unpaid' })
  paymentStatus: string;

  @Column({ nullable: true })
  comment: string;

  @OneToMany(() => DeliveryItem, (i) => i.delivery, { cascade: true, eager: true })
  items: DeliveryItem[];

  @CreateDateColumn()
  createdAt: Date;
}
