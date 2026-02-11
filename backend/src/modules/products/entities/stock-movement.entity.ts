import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { User } from '../../users/entities/user.entity';

export enum MovementType {
  INCOME = 'income',
  EXPENSE = 'expense',
  WRITEOFF = 'writeoff',
  INVENTORY = 'inventory',
}

@Entity('stock_movements')
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Product)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column('uuid')
  productId: string;

  @Column({ type: 'enum', enum: MovementType })
  type: MovementType;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'int', default: 0 })
  stockBefore: number;

  @Column({ type: 'int', default: 0 })
  stockAfter: number;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column('uuid', { nullable: true })
  referenceId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column('uuid', { nullable: true })
  userId: string;

  @CreateDateColumn()
  createdAt: Date;
}
