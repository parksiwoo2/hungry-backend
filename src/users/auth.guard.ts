import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { SessionService } from './session.service';

const PUBLIC_ROUTE = 'publicRoute';
export const Public = () => SetMetadata(PUBLIC_ROUTE, true);
type AuthenticatedRequest = Request & { userId?: string };

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const id = context.switchToHttp().getRequest<AuthenticatedRequest>().userId;
    if (!id) throw new UnauthorizedException('로그인이 필요합니다.');
    return id;
  },
);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.userId = await this.sessions.userId(request);
    return true;
  }
}
