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
    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const phone = process.env.SUPERADMIN_PHONE || '+79884444436';
    const password = process.env.SUPERADMIN_PASSWORD || 'Ramsys05!';

    const existingSuperAdmin = await this.userRepo.findOne({
      where: { role: UserRole.SUPERADMIN },
    });

    if (existingSuperAdmin) {
      // Sync password and phone so the admin can always log in
      const hashedPassword = await bcrypt.hash(password, 10);
      existingSuperAdmin.password = hashedPassword;
      existingSuperAdmin.username = username;
      existingSuperAdmin.phone = phone;
      existingSuperAdmin.isActive = true;
      await this.userRepo.save(existingSuperAdmin);
      this.logger.log(
        `SuperAdmin password synced for "${existingSuperAdmin.username}" (phone: ${phone})`,
      );
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

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
      `SuperAdmin user created successfully (username: "${username}", phone: "${phone}")`,
    );
  }
}
