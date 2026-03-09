import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { MongooseConnectionsModule } from './common/database/database.module';

import { ArticleModule } from './article/article.module';
import { ChatModule } from './chat/chat.module';
import { AwsModule } from './common/aws/aws.module';
import { AwsService } from './common/aws/aws.service';
import { ContactModule } from './contact/contact.module';
import { DocumentModule } from './document/document.module';
import { MailModule } from './mail/mail.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { NotificationSettingsModule } from './notification-settings/notification-settings.module';
import { NotificationModule } from './notification/notification.module';
import { PaymentModule } from './payment/payment.module';
import { PropertyModule } from './property/property.module';
import { RedisModule } from './redis/redis.module';
import { SeedModule } from './seed/seed.module';
import { SavePropertyModule } from './save-property/save-property.module';
import { ServiceModule } from './service/service.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    AwsModule,
    MongooseConnectionsModule,
    RedisModule, // Global Redis Pub/Sub (must come before ChatModule)
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
    ContactModule,
    DocumentModule,
    ChatModule, // Real-time chat system
    SeedModule,
    SavePropertyModule,
  ],

  controllers: [],
  providers: [AwsService],
})
export class AppModule {}
