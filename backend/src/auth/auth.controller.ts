import { Controller, Post, Get, Patch, Body, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { SelectPointDto } from './dto/select-point.dto';
import { SwitchPointDto } from './dto/switch-point.dto';
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

  /**
   * ШАГ 2 ВХОДА (163): обменять промежуточный токен + выбранный филиал на
   * токен сессии. БЕЗ JwtAuthGuard — и это не упущение: промежуточный токен
   * намеренно не проходит стратегию (она отбивает его по назначению
   * point_select), иначе им можно было бы ходить в обычные ручки, то есть
   * работать вообще без филиала. Подпись и одноразовость проверяет сервис.
   * Rate-limit — глобальный write-бакет, как у /auth/login.
   */
  @Post('select-point')
  selectPoint(@Body() dto: SelectPointDto) {
    return this.authService.selectPoint(dto);
  }

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // Филиал в ответе — филиал ЭТОЙ сессии (из токена), поэтому актор передаётся
  // целиком, а не одним userID: колонка users.current_point_id отдала бы вебу
  // филиал, выбранный в телефоне.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.authService.me(user);
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

  /**
   * МГНОВЕННАЯ СМЕНА ФИЛИАЛА (167) — ПЕРЕВЫПУСК СЕССИИ, а не «вход без пароля».
   * Требует ЖИВОЙ обычной сессии (JwtAuthGuard) и права управления персоналом;
   * сотруднику отвечает понятным отказом «выйдите и войдите заново» — прежний
   * сценарий 163 для него сохраняется дословно. Клиент вызывает ручку ТОЛЬКО
   * из раздела «Филиалы» (требование владельца) и обязан применить новый токен
   * атомарно: старый гасится немедленно. Логика и обоснование — целиком в
   * AuthService.switchPoint.
   *
   * ПОЧЕМУ ГЕЙТ ПРАВА НЕ PermissionsGuard, А ПРОВЕРКА ВНУТРИ СЕРВИСА. Во-первых,
   * guard отвечает общим 403 — человек решил бы, что приложение сломалось, тогда
   * как это осознанное правило, и текст обязан объяснить, что делать дальше.
   * Во-вторых, @RequirePermission считает право по КАРТЕ АКТОРА в TypeScript, а
   * «кто вправе управлять персоналом» уже живёт в SQL-функции миграции 166 — той
   * же, что решает, какие филиалы кому доступны. Две копии одного правила рано
   * или поздно разойдутся, а расхождение здесь — это либо запертый владелец,
   * либо мастер, прыгающий по чужим кассам.
   *
   * Сырой bearer нужен сервису ради claims, которых нет в акторе
   * (impersonatedBy, exp) — ровно как в /auth/refresh.
   *
   * RateLimitGuard тут НЕ переприменяется: он глобальный (main.ts), и второй
   * экземпляр списывал бы те же бакеты дважды за один запрос. POST → write-бакет
   * (150/мин на ip+токен), как у /auth/refresh и /auth/select-point.
   */
  @UseGuards(JwtAuthGuard)
  @Post('switch-point')
  switchPoint(@CurrentUser() user: JwtPayload, @Req() req: Request, @Body() dto: SwitchPointDto) {
    const auth = (req.headers['authorization'] as string | undefined) || '';
    const rawToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    return this.authService.switchPoint(user, rawToken, dto);
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
