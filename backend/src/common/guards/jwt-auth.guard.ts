import {
  Injectable,
  ExecutionContext,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser>(err: unknown, user: TUser, _info: unknown, _context: ExecutionContext): TUser {
    // Passport reports invalid/missing JWTs as a failed user. Errors thrown
    // by validate() also include database outages: denying access must not
    // tell clients that an otherwise valid session has expired.
    if (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException({ message: 'Проверка авторизации временно недоступна' }, { cause: err });
    }
    if (!user) {
      throw new UnauthorizedException({ message: 'Нет токена авторизации' });
    }
    return user;
  }
}
