import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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
    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const phone = process.env.SUPERADMIN_PHONE || '+79884444436';
    const password = process.env.SUPERADMIN_PASSWORD || 'Ramsys05!';

    const hashedPassword = await bcrypt.hash(password, 10);

    // Search including soft-deleted records to avoid unique constraint conflicts
    const existingSuperAdmin = await this.userRepo
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.role = :role', { role: UserRole.SUPERADMIN })
      .orWhere('user.username = :username', { username })
      .orWhere('user.phone = :phone', { phone })
      .getOne();

    if (existingSuperAdmin) {
      // Restore if soft-deleted, sync all credentials
      existingSuperAdmin.deletedAt = null;
      existingSuperAdmin.password = hashedPassword;
      existingSuperAdmin.username = username;
      existingSuperAdmin.phone = phone;
      existingSuperAdmin.role = UserRole.SUPERADMIN;
      existingSuperAdmin.fullName = existingSuperAdmin.fullName || 'Super Administrator';
      existingSuperAdmin.permissions = DEFAULT_PERMISSIONS[UserRole.SUPERADMIN];
      existingSuperAdmin.isActive = true;
      await this.userRepo.save(existingSuperAdmin);
      this.logger.log(
        `SuperAdmin synced: "${username}" (phone: ${phone})`,
      );
      return;
    }

    const superAdmin = this.userRepo.create({
      username,
      phone,
      password: hashedPassword,
      fullName: 'Super Administrator',
      role: UserRole.SUPERADMIN,
      permissions: DEFAULT_PERMISSIONS[UserRole.SUPERADMIN],
      isActive: true,
    });

    await this.userRepo.save(superAdmin);

    this.logger.log(
      `SuperAdmin created: "${username}" (phone: "${phone}")`,
    );
  }
}
