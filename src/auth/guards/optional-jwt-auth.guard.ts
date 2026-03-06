import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  // If an error occurs, propagate it. Otherwise return the user (or null)
  // so requests without a JWT are allowed through as unauthenticated.
  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err) throw err;
    return user ?? null;
  }
}
