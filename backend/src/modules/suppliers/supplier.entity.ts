import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  contactPerson: string;

  @Column({ nullable: true })
  comment: string;

  @Column({ type: 'float', default: 0 })
  totalPurchases: number;

  @Column({ type: 'float', default: 0 })
  totalPaid: number;

  @Column({ type: 'float', default: 0 })
  currentDebt: number;

  @CreateDateColumn()
  createdAt: Date;
}
