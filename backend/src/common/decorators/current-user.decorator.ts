import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface JwtPayload {
  userID: string;
  tenantID: string;
  role: string;
  /** Action-permission map loaded by JwtStrategy.validate (users.permissions). */
  permissions: Record<string, boolean>;
  jti?: string;
}

export const CurrentUser = createParamDecorator((data: keyof JwtPayload | undefined, ctx: ExecutionContext): any => {
  const request = ctx.switchToHttp().getRequest();
  const user = request.user as JwtPayload;
  return data ? user?.[data] : user;
});
