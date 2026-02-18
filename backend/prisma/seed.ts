import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: UserRole.superadmin },
  });

  if (existingAdmin) {
    console.log('Superadmin already exists, skipping seed');
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: 'ZR Auto Pro',
      slug: 'zr-auto',
      phone: '+7 (988) 444-44-36',
      isActive: true,
      maxUsers: 50,
    },
  });

  const password = await bcrypt.hash('admin123', 10);

  await prisma.user.create({
    data: {
      phone: '+7 (988) 444-44-36',
      password,
      fullName: 'Администратор',
      role: UserRole.superadmin,
      isActive: true,
      tenantId: tenant.id,
      permissions: {
        checks_view: true,
        checks_create: true,
        checks_edit: true,
        checks_delete: true,
        profit_view: true,
        clients_view: true,
        clients_edit: true,
        warehouse_access: true,
        suppliers_access: true,
        financial_reports: true,
        export_data: true,
        user_management: true,
      },
    },
  });

  console.log('Seed completed: tenant + superadmin created');
  console.log('Login: +7 (988) 444-44-36 / admin123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
