import { Injectable, OnModuleInit } from '@nestjs/common';

import { QueueService } from '../../../infrastructure/queues/queue.service';

@Injectable()
export class TrendingSearchBootstrap implements OnModuleInit {
  constructor(private readonly queueService: QueueService) {}

  async onModuleInit() {
    await this.queueService.addTrendingSearchAggregationJob();
  }
}
