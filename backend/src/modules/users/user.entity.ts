import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Tenant } from '../tenants/tenant.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  username: string;

  @Column()
  password: string;

  @Column()
  fullName: string;

  @Column({ unique: true })
  phone: string;

  @Column({ default: 'master' })
  role: string;

  @Column({ type: 'float', default: 0 })
  salaryPercent: number;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  permissions: Record<string, boolean>;

  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  tenantId: string;

  @ManyToOne(() => Tenant, (t) => t.users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @CreateDateColumn()
  createdAt: Date;
}
