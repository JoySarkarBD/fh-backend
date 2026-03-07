import { Controller, Post, Query } from '@nestjs/common';
import { SeedService } from './seed.service';

@Controller('seed')
export class SeedController {
  constructor(private readonly seedService: SeedService) {}

  @Post()
  seedProperties(@Query('count') count?: string) {
    const total = Number(count) > 0 ? Number(count) : 100;
    return this.seedService.seedProperties(total);
  }
}
