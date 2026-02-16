import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum TariffPlan {
  START = 'start',
  STANDARD = 'standard',
  BUSINESS = 'business',
  PREMIUM = 'premium',
}

export const TARIFF_CONFIG: Record<TariffPlan, {
  label: string;
  price: number;
  maxUsers: number;
  features: string[];
}> = {
  [TariffPlan.START]: {
    label: 'Старт',
    price: 0,
    maxUsers: 3,
    features: ['Чеки', 'Клиенты', 'До 3 сотрудников'],
  },
  [TariffPlan.STANDARD]: {
    label: 'Стандарт',
    price: 1990,
    maxUsers: 7,
    features: ['Всё из Старт', 'Склад', 'Поставщики', 'До 7 сотрудников'],
  },
  [TariffPlan.BUSINESS]: {
    label: 'Бизнес',
    price: 3990,
    maxUsers: 15,
    features: ['Всё из Стандарт', 'Отчёты', 'Экспорт', 'До 15 сотрудников'],
  },
  [TariffPlan.PREMIUM]: {
    label: 'Премиум',
    price: 6990,
    maxUsers: 50,
    features: ['Всё из Бизнес', 'До 50 сотрудников', 'Приоритетная поддержка'],
  },
};

@Entity('tenants')
export class Tenant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  slug: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  email: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ nullable: true })
  logo: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'varchar', length: 30, default: TariffPlan.START })
  tariffPlan: TariffPlan;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tariffPrice: number;

  @Column({ type: 'int', default: 5 })
  maxUsers: number;

  @Column({ type: 'timestamp', nullable: true })
  subscriptionEnd: Date | null;

  @Column({ type: 'text', nullable: true })
  subscriptionNote: string;

  @OneToMany(() => User, (user) => user.tenant)
  users: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @DeleteDateColumn()
  deletedAt: Date;
}
