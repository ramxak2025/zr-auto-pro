import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  User,
  UserRole,
  DEFAULT_PERMISSIONS,
} from '../users/entities/user.entity';

@Injectable()
export class TenantsSeedService implements OnModuleInit {
  private readonly logger = new Logger(TenantsSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedSuperAdmin();
  }

  private async seedSuperAdmin(): Promise<void> {
    const existingSuperAdmin = await this.userRepo.findOne({
      where: { role: UserRole.SUPERADMIN },
    });

    if (existingSuperAdmin) {
      this.logger.log(
        `SuperAdmin user already exists: "${existingSuperAdmin.username}"`,
      );
      return;
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);

    const superAdmin = this.userRepo.create({
      username: 'superadmin',
      password: hashedPassword,
      fullName: 'Super Administrator',
      role: UserRole.SUPERADMIN,
      permissions: DEFAULT_PERMISSIONS[UserRole.SUPERADMIN],
      isActive: true,
    });

    await this.userRepo.save(superAdmin);

    this.logger.log(
      'SuperAdmin user created successfully (username: "superadmin", password: "admin123")',
    );
    this.logger.warn(
      'Please change the default SuperAdmin password immediately!',
    );
  }
}
