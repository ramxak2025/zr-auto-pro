import { Injectable, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(phone: string, password: string): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersService.findByPhone(phone);
    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
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
