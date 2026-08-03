import { Controller, Post, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // RateLimitGuard is registered once globally in main.ts. Applying it here as
  // well would charge the same Redis buckets twice for a single request.
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user.userID);
  }

  // Тихое продление сессии: клиент со СТАРЫМ, но ещё валидным токеном получает
  // свежий (полный TTL из JwtModule). Обмен строго 1:1 — старый jti атомарно
  // уходит в blacklist с 2-минутным grace-окном доживания, повторный refresh
  // тем же токеном → 401, impersonation-токен → 403; живые проверки идут МИМО
  // 30с auth-кэша — подробности в AuthService.refresh. Сырой bearer нужен
  // сервису ради claims, которые guard не прокидывает (impersonatedBy, exp).
  // RateLimitGuard глобальный (write-бакет 150/мин) — отдельный не нужен.
  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  refresh(@CurrentUser() user: JwtPayload, @Req() req: Request) {
    const auth = (req.headers['authorization'] as string | undefined) || '';
    const rawToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return this.authService.refresh(user, rawToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentUser() user: JwtPayload) {
    if (user.jti) {
      await this.authService.logout(user.jti, user.userID, user.tenantID);
    }
    return { message: 'Logged out' };
  }

  @UseGuards(JwtAuthGuard)
  @Patch('avatar')
  updateAvatar(@CurrentUser() user: JwtPayload, @Body('avatar') avatar: string) {
    return this.authService.updateAvatar(user.userID, avatar);
  }
}
