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
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit() {
    await this.seedSuperAdmin();
  }

  private async seedSuperAdmin() {
    const existing = await this.userRepo.findOne({
      where: { role: UserRole.SUPERADMIN },
    });

    if (existing) {
      this.logger.log(`SuperAdmin already exists: "${existing.username}"`);
      return;
    }

    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const password = process.env.SUPERADMIN_PASSWORD || 'Ramsys05!';
    const fullName = process.env.SUPERADMIN_FULLNAME || 'Super Admin';

    const hashedPassword = await bcrypt.hash(password, 10);

    const superadmin = this.userRepo.create({
      username,
      password: hashedPassword,
      fullName,
      role: UserRole.SUPERADMIN,
      permissions: DEFAULT_PERMISSIONS[UserRole.SUPERADMIN],
      isActive: true,
      tenantId: null,
    });

    await this.userRepo.save(superadmin);
    this.logger.log(`SuperAdmin created: "${username}"`);
  }
}
