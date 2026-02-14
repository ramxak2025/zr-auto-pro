import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  UnauthorizedException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { TenantGuard } from './guards/tenant.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RequirePermissions } from './decorators/permissions.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { TenantId } from './decorators/tenant-id.decorator';
import { User } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    try {
      const user = await this.authService.validateUser(
        loginDto.phone,
        loginDto.password,
      );

      if (!user) {
        throw new UnauthorizedException('Неверный телефон или пароль');
      }

      if (!user.isActive) {
        throw new UnauthorizedException('Учётная запись деактивирована');
      }

      return this.authService.login(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(
        `Login failed for "${loginDto.phone}": ${error.message}`,
        error.stack,
      );
      throw new InternalServerErrorException(
        `Ошибка при входе: ${error.message}`,
      );
    }
  }

  @Post('register')
  @UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
  @RequirePermissions('user_management')
  async register(@TenantId() tenantId: string, @Body() registerDto: RegisterDto) {
    return this.authService.register(tenantId, registerDto);
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  getProfile(@CurrentUser() user: Omit<User, 'password'>) {
    return user;
  }
}
