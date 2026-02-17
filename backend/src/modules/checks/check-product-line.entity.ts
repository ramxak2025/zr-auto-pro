import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Check } from './check.entity';

@Entity('check_product_lines')
export class CheckProductLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  checkId: string;

  @ManyToOne(() => Check, (c) => c.products, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column({ nullable: true })
  productId: string;

  @Column()
  name: string;

  @Column({ type: 'float' })
  sellPrice: number;

  @Column({ type: 'float' })
  costPrice: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'float' })
  totalSell: number;

  @Column({ type: 'float' })
  totalCost: number;
}
