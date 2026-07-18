import { Controller, Post, Get, Patch, Body, UseGuards } from '@nestjs/common';
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
