import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { Check } from '../../checks/entities/check.entity';
import { Tenant } from '../../tenants/entities/tenant.entity';

export enum UserRole {
  SUPERADMIN = 'superadmin',
  OWNER = 'owner',
  ADMIN = 'admin',
  MASTER = 'master',
  STOREKEEPER = 'storekeeper',
  ACCOUNTANT = 'accountant',
}

export interface UserPermissions {
  checks_view: boolean;
  checks_create: boolean;
  checks_edit: boolean;
  checks_delete: boolean;
  profit_view: boolean;
  clients_view: boolean;
  clients_edit: boolean;
  warehouse_access: boolean;
  suppliers_access: boolean;
  financial_reports: boolean;
  export_data: boolean;
  user_management: boolean;
}

export const DEFAULT_PERMISSIONS: Record<string, UserPermissions> = {
  [UserRole.SUPERADMIN]: {
    checks_view: true,
    checks_create: true,
    checks_edit: true,
    checks_delete: true,
    profit_view: true,
    clients_view: true,
    clients_edit: true,
    warehouse_access: true,
    suppliers_access: true,
    financial_reports: true,
    export_data: true,
    user_management: true,
  },
  [UserRole.OWNER]: {
    checks_view: true,
    checks_create: true,
    checks_edit: true,
    checks_delete: true,
    profit_view: true,
    clients_view: true,
    clients_edit: true,
    warehouse_access: true,
    suppliers_access: true,
    financial_reports: true,
    export_data: true,
    user_management: true,
  },
  [UserRole.ADMIN]: {
    checks_view: true,
    checks_create: true,
    checks_edit: true,
    checks_delete: true,
    profit_view: true,
    clients_view: true,
    clients_edit: true,
    warehouse_access: true,
    suppliers_access: true,
    financial_reports: true,
    export_data: true,
    user_management: false,
  },
  [UserRole.MASTER]: {
    checks_view: true,
    checks_create: true,
    checks_edit: false,
    checks_delete: false,
    profit_view: false,
    clients_view: true,
    clients_edit: true,
    warehouse_access: false,
    suppliers_access: false,
    financial_reports: false,
    export_data: false,
    user_management: false,
  },
  [UserRole.STOREKEEPER]: {
    checks_view: true,
    checks_create: false,
    checks_edit: false,
    checks_delete: false,
    profit_view: false,
    clients_view: true,
    clients_edit: false,
    warehouse_access: true,
    suppliers_access: true,
    financial_reports: false,
    export_data: false,
    user_management: false,
  },
  [UserRole.ACCOUNTANT]: {
    checks_view: true,
    checks_create: false,
    checks_edit: false,
    checks_delete: false,
    profit_view: true,
    clients_view: true,
    clients_edit: false,
    warehouse_access: true,
    suppliers_access: true,
    financial_reports: true,
    export_data: true,
    user_management: false,
  },
};

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  username: string;

  @Column()
  @Exclude()
  password: string;

  @Column()
  fullName: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.MASTER })
  role: UserRole;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  salaryPercent: number;

  @Column({ type: 'jsonb', default: {} })
  permissions: UserPermissions;

  @Column({ default: true })
  isActive: boolean;

  @Index()
  @ManyToOne(() => Tenant, (tenant) => tenant.users, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenantId' })
  tenant: Tenant;

  @Column('uuid', { nullable: true })
  tenantId: string;

  @OneToMany(() => Check, (check) => check.master)
  checks: Check[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
