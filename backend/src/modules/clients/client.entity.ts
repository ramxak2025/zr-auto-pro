import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from 'typeorm';
import { Car } from '../cars/car.entity';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  tenantId: string;

  @Column()
  fullName: string;

  @Column()
  phone: string;

  @Column({ nullable: true })
  comment: string;

  @OneToMany(() => Car, (c) => c.client)
  cars: Car[];

  @CreateDateColumn()
  createdAt: Date;
}
