import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  userID: string;
  tenantID: string;
  role: string;
  /** Action-permission map loaded by JwtStrategy.validate (users.permissions). */
  permissions: Record<string, boolean>;
  /**
   * ФИЛИАЛ СЕССИИ (163) — claim `pointId` токена. Филиал выбирается при входе
   * и живёт ровно столько, сколько живёт сессия; веб и телефон одного человека
   * могут работать в разных филиалах. null означает ровно одно: у тенанта нет
   * живых филиалов (одноточечный автосервис). Загружается JwtStrategy.validate
   * тем же запросом, что роль; единый разбор — common/point-scope.ts
   * (actorPointId).
   */
  currentPointId?: string | null;
  jti?: string;
}

export const CurrentUser = createParamDecorator((data: keyof JwtPayload | undefined, ctx: ExecutionContext): any => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as JwtPayload;
  return data ? user?.[data] : user;
});
