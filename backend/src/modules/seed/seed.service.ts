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

    this.logger.log('=== SEED START ===');

    try {
      const existing = await this.usersRepo.findOne({ where: { phone: adminPhone } });

      if (existing) {
        this.logger.log(`Seed: superadmin exists (id=${existing.id}), resetting password...`);
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(adminPassword, salt);

        await this.usersRepo.update(existing.id, { password: hash });

        // Verify the password was saved correctly
        const verify = await this.usersRepo.findOne({ where: { id: existing.id } });
        const isValid = await bcrypt.compare(adminPassword, verify!.password);
        this.logger.log(`Seed: password reset done. Verify bcrypt.compare = ${isValid}`);
        this.logger.log(`Seed: hash starts with: ${verify!.password.substring(0, 10)}...`);
        this.logger.log('=== SEED END ===');
        return;
      }

      // Create tenant
      let tenant: any;
      const allTenants = await this.tenantsService.findAll();
      if (allTenants.length > 0) {
        tenant = allTenants[0];
        this.logger.log(`Seed: using existing tenant (id=${tenant.id})`);
      } else {
        tenant = await this.tenantsService.create({
          name: 'Autexa',
          phone: adminPhone,
        });
        this.logger.log(`Seed: created tenant (id=${tenant.id})`);
      }

      // Create superadmin directly via repo to avoid any middleware
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      const user = this.usersRepo.create({
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

      const saved = await this.usersRepo.save(user);

      // Verify
      const verify = await this.usersRepo.findOne({ where: { id: saved.id } });
      const isValid = await bcrypt.compare(adminPassword, verify!.password);
      this.logger.log(`Seed: superadmin created (id=${saved.id}). Verify bcrypt.compare = ${isValid}`);
      this.logger.log('=== SEED END ===');
    } catch (error) {
      this.logger.error(`Seed FAILED: ${error.message}`, error.stack);
    }
  }
}
