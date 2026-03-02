import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { MongooseConnectionsModule } from './common/database/database.module';

import { NotificationSettingsModule } from './notification-settings/notification-settings.module';
import { NotificationModule } from './notification/notification.module';
import { PropertyModule } from './property/property.module';
import { UserModule } from './user/user.module';
import { ServiceModule } from './service/service.module';
import { PaymentModule } from './payment/payment.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { ArticleModule } from './article/article.module';
import { MailModule } from './mail/mail.module';

@Module({
  imports: [
    MongooseConnectionsModule,
    AuthModule,
    PropertyModule,
    UserModule,
    NotificationModule,
    NotificationSettingsModule,
    ServiceModule,
    PaymentModule,
    MaintenanceModule,
    ArticleModule,
    MailModule,
  ],

  controllers: [],
  providers: [],
})
export class AppModule {}
