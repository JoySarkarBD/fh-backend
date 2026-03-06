import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from 'src/schemas/user.schema';

@Injectable()
export class SubscribedUserGuard implements CanActivate {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  // This guard checks if the user has an active subscription before allowing access to certain routes.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: { userId?: string } }>();

    const userId = request.user?.userId;

    // If userId is not present, the user is not authenticated
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    // Fetch the user from the database to check subscription status
    const user = await this.userModel.findById(userId).select('isSubscribed');

    // If user is not found or does not have an active subscription, deny access
    if (!user) {
      throw new ForbiddenException('User not found');
    }

    // If the user is not subscribed, throw a ForbiddenException
    if (!user.isSubscribed) {
      throw new ForbiddenException(
        'You need an active subscription to access this resource',
      );
    }

    return true;
  }
}
