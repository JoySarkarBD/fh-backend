import { createParamDecorator, ExecutionContext } from '@nestjs/common';


// Custom decorator to extract the current user from the request
export const CurrentUser =createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    // Extract the request object from the execution context, which contains the user information attached by the authentication guard.
    const request = ctx.switchToHttp().getRequest();

    // Return the user information from the request object, allowing it to be accessed as a parameter in the controller method where this decorator is used.
    return request.user;
  },
);
