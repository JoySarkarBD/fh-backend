import { Module } from '@nestjs/common';
import { DocumentService } from './document.service';
import { DocumentController } from './document.controller';
import { AwsService } from 'src/common/aws/aws.service';

@Module({
  controllers: [DocumentController],
  providers: [DocumentService, AwsService],
})
export class DocumentModule {}
