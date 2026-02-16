import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';
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

    const hashedPassword = await bcrypt.hash(password, 10);

    // Search including soft-deleted records to avoid unique constraint conflicts
    const existing = await this.userRepo
      .createQueryBuilder('user')
      .withDeleted()
      .where('user.role = :role', { role: UserRole.SUPERADMIN })
      .orWhere('user.username = :username', { username })
      .orWhere('user.phone = :phone', { phone })
      .getOne();

    if (existing) {
      // Restore if soft-deleted, sync all credentials
      existing.deletedAt = null;
      existing.password = hashedPassword;
      existing.username = username;
      existing.phone = phone;
      existing.role = UserRole.SUPERADMIN;
      existing.fullName = existing.fullName || fullName;
      existing.permissions = DEFAULT_PERMISSIONS[UserRole.SUPERADMIN];
      existing.isActive = true;
      await this.userRepo.save(existing);
      this.logger.log(`SuperAdmin synced: "${username}" (phone: ${phone})`);
      return;
    }

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
