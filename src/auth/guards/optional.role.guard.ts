import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from 'src/schemas/user.schema';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class OptionalRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService, // JwtService inject
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<{ user?: { role?: UserRole }, headers: any }>();

    // token check
    const authHeader = request.headers['authorization'];
    let tokenRole: UserRole | undefined;

    if (authHeader) {
      const token = authHeader.split(' ')[1]; // Bearer <token>
      if (token) {
        try {
          const payload: any = this.jwtService.verify(token);
          tokenRole = payload.role;
          request.user = { role: tokenRole }; // attach role to request
        } catch (err) {
          tokenRole = undefined; // invalid token
        }
      }
    }

    // token nai or invalid -> just continue without blocking
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // role based check only if requiredRoles are defined
    if (tokenRole && requiredRoles.includes(tokenRole)) {
      return true; // role matches
    }

    // token nai or role mismatch -> route still allowed
    return true;
  }
}
