import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async findAll(tenantId: string): Promise<Omit<User, 'password'>[]> {
    const users = await this.usersRepo.find({
      where: { tenantId },
      relations: ['tenant'],
      order: { createdAt: 'DESC' },
      select: [
        'id',
        'username',
        'fullName',
        'phone',
        'role',
        'salaryPercent',
        'permissions',
        'isActive',
        'tenantId',
        'createdAt',
      ],
    });
    return users;
  }

  async findById(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.usersRepo.findOne({
      where: { id },
      relations: ['tenant'],
      select: [
        'id',
        'username',
        'fullName',
        'phone',
        'role',
        'salaryPercent',
        'permissions',
        'isActive',
        'tenantId',
        'createdAt',
      ],
    });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    return user;
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { username },
    });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { phone },
    });
  }

  async create(dto: Partial<User>): Promise<User> {
    if (dto.password && !dto.password.startsWith('$2b$')) {
      const salt = await bcrypt.genSalt(10);
      dto.password = await bcrypt.hash(dto.password, salt);
    }
    const user = this.usersRepo.create(dto);
    const saved = await this.usersRepo.save(user);
    const { password, ...result } = saved;
    return result as User;
  }

  async update(id: string, dto: Partial<User>): Promise<Omit<User, 'password'>> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
    if (dto.password && dto.password.trim()) {
      const salt = await bcrypt.genSalt(10);
      dto.password = await bcrypt.hash(dto.password, salt);
    } else {
      delete dto.password;
    }
    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);
    const { password, ...result } = saved;
    return result as Omit<User, 'password'>;
  }

  async remove(id: string): Promise<void> {
    const result = await this.usersRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`User with id "${id}" not found`);
    }
  }

  async findMasters(tenantId: string): Promise<Omit<User, 'password'>[]> {
    const masters = await this.usersRepo.find({
      where: { role: 'master', tenantId, isActive: true },
      select: [
        'id',
        'username',
        'fullName',
        'phone',
        'role',
        'salaryPercent',
        'permissions',
        'isActive',
        'tenantId',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
    });
    return masters;
  }
}
