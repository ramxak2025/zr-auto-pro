import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Check } from './check.entity';
import { Product } from '../../products/entities/product.entity';

@Entity('check_products')
export class CheckProduct {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Check, (check) => check.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column('uuid')
  checkId: string;

  @ManyToOne(() => Product, { nullable: true })
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column('uuid', { nullable: true })
  productId: string;

  @Column()
  name: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  sellPrice: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  costPrice: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalSell: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalCost: number;
}
