import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

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

  /**
   * Find user by phone number (with password for auth).
   * Normalizes digits for comparison if exact match fails.
   */
  async findByPhone(phone: string): Promise<User | null> {
    this.logger.debug(`findByPhone called with: "${phone}"`);

    // Normalize input: strip to digits
    const inputDigits = phone.replace(/\D/g, '');

    // Try exact match first
    const exact = await this.usersRepo.findOne({ where: { phone } });
    if (exact) {
      this.logger.debug(`findByPhone exact match found for "${phone}"`);
      return exact;
    }

    // Fallback: load all and compare by digits
    if (inputDigits) {
      const allUsers = await this.usersRepo.find();
      this.logger.debug(`findByPhone fallback: ${allUsers.length} users, looking for digits "${inputDigits}"`);
      for (const u of allUsers) {
        if (u.phone) {
          const uDigits = u.phone.replace(/\D/g, '');
          this.logger.debug(`  comparing "${uDigits}" with "${inputDigits}"`);
          if (uDigits === inputDigits) {
            return u;
          }
        }
      }
    }

    this.logger.debug(`findByPhone: no user found`);
    return null;
  }

  async create(dto: Partial<User>): Promise<User> {
    if (dto.password && !dto.password.startsWith('$2b$')) {
      const salt = await bcrypt.genSalt(10);
      dto.password = await bcrypt.hash(dto.password, salt);
    }
    const user = this.usersRepo.create(dto);
    const saved = await this.usersRepo.save(user);
    this.logger.log(`User created: phone="${saved.phone}", role="${saved.role}", hasPassword=${!!saved.password}`);
    const { password: _pw, ...result } = saved;
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
