import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(phone: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { tenant: true },
    });

    if (!user) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Аккаунт деактивирован');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Неверный телефон или пароль');
    }

    const token = this.jwt.sign({ sub: user.id });

    const { password: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword };
  }

  async register(data: {
    phone: string;
    password: string;
    fullName: string;
    tenantName?: string;
  }) {
    const existing = await this.prisma.user.findUnique({
      where: { phone: data.phone },
    });
    if (existing) {
      throw new BadRequestException('Пользователь с таким телефоном уже существует');
    }

    const hashed = await bcrypt.hash(data.password, 10);

    const tenant = await this.prisma.tenant.create({
      data: {
        name: data.tenantName || 'Мой автосервис',
        isActive: true,
        maxUsers: 10,
      },
    });

    const user = await this.prisma.user.create({
      data: {
        phone: data.phone,
        password: hashed,
        fullName: data.fullName,
        role: 'director',
        tenantId: tenant.id,
        isActive: true,
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
      include: { tenant: true },
    });

    const token = this.jwt.sign({ sub: user.id });
    const { password: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user) throw new UnauthorizedException();
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}
