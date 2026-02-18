import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(phone: string, password: string): Promise<Omit<User, 'password'> | null> {
    this.logger.log(`validateUser: phone="${phone}"`);
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      this.logger.warn(`validateUser: user NOT found for phone="${phone}"`);
      return null;
    }

    this.logger.log(`validateUser: user found (id=${user.id}, role=${user.role}), hasPassword=${!!user.password}, hashPrefix=${user.password ? user.password.substring(0, 7) : 'N/A'}`);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    this.logger.log(`validateUser: bcrypt.compare result = ${isPasswordValid}`);

    if (!isPasswordValid) {
      return null;
    }

    const { password: _password, ...result } = user;
    return result;
  }

  async login(user: Omit<User, 'password'>): Promise<{ token: string; user: Omit<User, 'password'> }> {
    const payload = {
      sub: user.id,
      role: user.role,
      tenantId: user.tenantId,
    };

    return {
      token: this.jwtService.sign(payload),
      user,
    };
  }

  async register(dto: {
    phone: string;
    password: string;
    fullName: string;
    tenantId?: string;
  }): Promise<{ token: string; user: Omit<User, 'password'> }> {
    const existing = await this.usersService.findByPhone(dto.phone);
    if (existing) {
      throw new ConflictException('Пользователь с таким номером уже существует');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(dto.password, salt);

    const created = await this.usersService.create({
      ...dto,
      password: hashedPassword,
    });

    const { password: _password, ...user } = created;
    return this.login(user);
  }
}
