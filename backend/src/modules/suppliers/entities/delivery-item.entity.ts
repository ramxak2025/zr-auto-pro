import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Delivery } from './delivery.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('delivery_items')
export class DeliveryItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Delivery, (d) => d.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deliveryId' })
  delivery: Delivery;

  @Column('uuid')
  deliveryId: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column('uuid')
  productId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  price: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;
}
