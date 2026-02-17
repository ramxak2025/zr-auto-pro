import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { TenantsService } from '../tenants/tenants.service';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tenantsService: TenantsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const adminPhone = '+998 (00) 000-00-00';
    const existing = await this.usersService.findByPhone(adminPhone);

    if (existing) {
      this.logger.log('Seed: superadmin already exists');
      return;
    }

    const tenant = await this.tenantsService.create({
      name: 'Автосервис',
      phone: '+998 (00) 000-00-00',
    });

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);

    await this.usersService.create({
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
    });

    this.logger.log('Seed: superadmin created with phone ' + adminPhone);
  }
}
