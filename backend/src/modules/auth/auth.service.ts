import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(
    phone: string,
    password: string,
  ): Promise<Omit<User, 'password'> | null> {
    let user = await this.usersService.findByPhone(phone);

    // Fallback: try alternative phone formats (with/without +)
    if (!user && phone.startsWith('+')) {
      user = await this.usersService.findByPhone(phone.slice(1));
    }
    if (!user && !phone.startsWith('+')) {
      user = await this.usersService.findByPhone('+' + phone);
    }

    // Fallback: try username for users created before phone migration
    if (!user) {
      user = await this.usersService.findByUsername(phone);
    }

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

  async login(user: Omit<User, 'password'>) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenantId,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: {
        id: user.id,
        username: user.username,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
        salaryPercent: user.salaryPercent,
        permissions: user.permissions,
        isActive: user.isActive,
        tenantId: user.tenantId,
      },
    };
  }

  async register(tenantId: string, dto: RegisterDto): Promise<Omit<User, 'password'>> {
    if (dto.phone) {
      const existingByPhone = await this.usersService.findByPhone(dto.phone);
      if (existingByPhone) {
        throw new ConflictException('Пользователь с таким телефоном уже существует');
      }
    }

    const existingUser = await this.usersService.findByUsername(dto.username);
    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    // usersService.create() already hashes the password — do NOT hash here
    const user = await this.usersService.create(tenantId, dto);

    const { password: _password, ...result } = user;
    return result;
  }
}
