import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
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
    await this.migratePhones();
  }

  /**
   * Fill phone from username for users created before phone-based auth migration.
   */
  private async migratePhones() {
    const usersWithoutPhone = await this.userRepo.find({
      where: { phone: IsNull() },
    });

    for (const user of usersWithoutPhone) {
      user.phone = user.username;
      await this.userRepo.save(user);
      this.logger.log(`Migrated phone for user "${user.username}" (id: ${user.id})`);
    }

    if (usersWithoutPhone.length > 0) {
      this.logger.log(`Phone migration complete: ${usersWithoutPhone.length} user(s) updated`);
    }
  }

  private async seedSuperAdmin() {
    const username = process.env.SUPERADMIN_USERNAME || 'superadmin';
    const phone = process.env.SUPERADMIN_PHONE || '+79884444436';
    const password = process.env.SUPERADMIN_PASSWORD || 'Ramsys05!';
    const fullName = process.env.SUPERADMIN_FULLNAME || 'Super Admin';

    const existing = await this.userRepo.findOne({
      where: { role: UserRole.SUPERADMIN },
    });

    if (existing) {
      // Always sync password and phone so the admin can log in with the known credentials
      const hashedPassword = await bcrypt.hash(password, 10);
      existing.password = hashedPassword;
      existing.username = username;
      existing.phone = phone;
      existing.isActive = true;
      await this.userRepo.save(existing);
      this.logger.log(`SuperAdmin password synced for "${existing.username}" (phone: ${phone})`);
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const superadmin = this.userRepo.create({
      username,
      phone,
      password: hashedPassword,
      fullName,
      role: UserRole.SUPERADMIN,
      permissions: DEFAULT_PERMISSIONS[UserRole.SUPERADMIN],
      isActive: true,
    } as Partial<User>);

    await this.userRepo.save(superadmin);
    this.logger.log(`SuperAdmin created: "${username}" (phone: ${phone})`);
  }
}
