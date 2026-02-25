import { Injectable, Inject, UnauthorizedException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// Shared SQL fragment for fetching user with tenant info
const USER_WITH_TENANT_COLUMNS = `
  u.id, u.phone, u.full_name, u.avatar, u.role,
  COALESCE(u.salary_percent, 0) as salary_percent,
  COALESCE(u.permissions, '{}') as permissions,
  u.is_active, u.tenant_id, u.created_at,
  CASE WHEN t.id IS NOT NULL THEN
    json_build_object('id',t.id,'name',t.name,'slug',COALESCE(t.slug,''),
      'phone',COALESCE(t.phone,''),'address',COALESCE(t.address,''),
      'email',COALESCE(t.email,''),'isActive',t.is_active,
      'maxUsers',t.max_users,
      'subscriptionEnd',t.subscription_end,
      'subscriptionNote',COALESCE(t.subscription_note,''),
      'createdAt',t.created_at,'updatedAt',t.updated_at)::text
  ELSE NULL END as tenant_json`;

/** Map a raw DB row to a camelCase user object with parsed tenant */
function mapUserRow(row: any) {
  const user: any = {
    id: row.id,
    phone: row.phone,
    fullName: row.full_name,
    avatar: row.avatar,
    role: row.role,
    salaryPercent: parseFloat(row.salary_percent) || 0,
    permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
    isActive: row.is_active,
    tenantId: row.tenant_id,
    createdAt: row.created_at,
  };

  if (row.tenant_json) {
    try {
      user.tenant = JSON.parse(row.tenant_json);
    } catch { /* ignore malformed tenant JSON */ }
  }

  return user;
}

// All permissions enabled by default for new directors
const ALL_PERMISSIONS = JSON.stringify({
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
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private jwtService: JwtService,
  ) {}

  private generateToken(userID: string): string {
    return this.jwtService.sign({ sub: userID });
  }

  async login(dto: LoginDto) {
    if (!dto.phone || !dto.password) {
      throw new BadRequestException({ message: 'Телефон и пароль обязательны' });
    }

    const phone = normalizePhone(dto.phone);

    const { rows } = await this.pool.query(
      `SELECT u.password, ${USER_WITH_TENANT_COLUMNS}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.phone = $1 OR u.phone = $2
       LIMIT 1`,
      [phone, dto.phone],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Неверный телефон или пароль' });
    }

    const row = rows[0];

    if (!row.is_active) {
      throw new UnauthorizedException({ message: 'Аккаунт деактивирован' });
    }

    const passwordMatch = await bcrypt.compare(dto.password, row.password);
    if (!passwordMatch) {
      throw new UnauthorizedException({ message: 'Неверный телефон или пароль' });
    }

    this.logger.log(`Login OK for phone=${phone} role=${row.role}`);

    const token = this.generateToken(row.id);
    return { token, user: mapUserRow(row) };
  }

  async register(dto: RegisterDto) {
    if (!dto.phone || !dto.password || !dto.fullName) {
      throw new BadRequestException({ message: 'Телефон, пароль и имя обязательны' });
    }

    if (dto.password.length < 6) {
      throw new BadRequestException({ message: 'Пароль должен быть не менее 6 символов' });
    }

    const phone = normalizePhone(dto.phone);

    const { rows: existsRows } = await this.pool.query(
      'SELECT EXISTS(SELECT 1 FROM users WHERE phone=$1) as exists',
      [phone],
    );
    if (existsRows[0].exists) {
      throw new BadRequestException({ message: 'Пользователь с таким телефоном уже существует' });
    }

    const hash = await bcrypt.hash(dto.password, 10);
    const tenantName = dto.tenantName || 'Мой автосервис';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: tenantRows } = await client.query(
        `INSERT INTO tenants (name, is_active, max_users) VALUES ($1, true, 10) RETURNING id`,
        [tenantName],
      );
      const tenantID = tenantRows[0].id;

      const { rows: userRows } = await client.query(
        `INSERT INTO users (phone, password, full_name, role, is_active, tenant_id, permissions)
         VALUES ($1, $2, $3, 'director', true, $4, $5)
         RETURNING id, phone, full_name, role, salary_percent, permissions, is_active, tenant_id, created_at`,
        [phone, hash, dto.fullName, tenantID, ALL_PERMISSIONS],
      );

      await client.query('COMMIT');

      const token = this.generateToken(userRows[0].id);
      return { token, user: mapUserRow(userRows[0]) };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`Register error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async me(userID: string) {
    const { rows } = await this.pool.query(
      `SELECT ${USER_WITH_TENANT_COLUMNS}
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE u.id = $1`,
      [userID],
    );

    if (rows.length === 0) {
      throw new UnauthorizedException({ message: 'Пользователь не найден' });
    }

    return mapUserRow(rows[0]);
  }

  async updateAvatar(userID: string, avatar: string) {
    await this.pool.query('UPDATE users SET avatar=$1 WHERE id=$2', [avatar, userID]);
    return { avatar };
  }
}
