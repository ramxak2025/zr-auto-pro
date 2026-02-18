import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';
import { User } from '../users/user.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    const adminPhone = '+7 (988) 444-44-36';
    const adminPassword = 'admin123';

    const existing = await this.usersService.findByPhone(adminPhone);

    if (existing) {
      // Always reset password to ensure it works after bcrypt migration
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(adminPassword, salt);
      await this.usersRepo.update(existing.id, { password: hash });
      this.logger.log('Seed: superadmin password reset OK');
      return;
    }

    let tenant = (await this.tenantsService.findAll())[0];
    if (!tenant) {
      tenant = await this.tenantsService.create({
        name: 'Autexa',
        phone: adminPhone,
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPassword, salt);

    await this.usersRepo.save(
      this.usersRepo.create({
        phone: adminPhone,
        password: hashedPassword,
        fullName: 'Администратор',
        role: 'superadmin',
        tenantId: tenant.id,
        permissions: {
          manageUsers: true,
          manageTenants: true,
          manageClients: true,
          manageCars: true,
          manageProducts: true,
          manageServices: true,
          manageChecks: true,
          manageSuppliers: true,
          manageSalary: true,
          manageSchedule: true,
          manageShifts: true,
          viewReports: true,
        },
        isActive: true,
      }),
    );

    this.logger.log('Seed: superadmin created with phone ' + adminPhone);
  }
}
