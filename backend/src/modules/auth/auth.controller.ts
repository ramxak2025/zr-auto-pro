import {
  Controller,
  Post,
  Get,
  Body,
  Request,
  UseGuards,
  UnauthorizedException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';

import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() body: { phone: string; password: string }) {
    this.logger.log(`Login attempt: phone="${body.phone}"`);
    try {
      const user = await this.authService.validateUser(body.phone, body.password);
      if (!user) {
        this.logger.warn(`Login failed: invalid credentials for "${body.phone}"`);
        throw new UnauthorizedException('Неверный номер телефона или пароль');
      }
      this.logger.log(`Login success: phone="${body.phone}", role="${user.role}"`);
      return this.authService.login(user);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Login error for "${body.phone}": ${error.message}`, error.stack);
      throw new InternalServerErrorException('Ошибка сервера при входе');
    }
  }

  @Post('register')
  async register(
    @Body()
    body: {
      phone: string;
      password: string;
      fullName: string;
      tenantId?: string;
    },
  ) {
    return this.authService.register(body);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Request() req: any) {
    return req.user;
  }
}
