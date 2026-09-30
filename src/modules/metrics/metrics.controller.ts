import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiKeyRole } from '../../common/auth/api-key-context';
import { Roles } from '../../common/decorators/auth.decorators';
import { MetricsService, MetricsSnapshot } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** Platform metrics as JSON: total, active, CPS, uploads, rejections. */
  @Get()
  @Header('Cache-Control', 'no-store')
  getMetrics(): Promise<MetricsSnapshot> {
    return this.metrics.getSnapshot();
  }

  /** Prometheus exposition format (admin key; used by the Prometheus scraper). */
  @Get('prometheus')
  @Roles(ApiKeyRole.ADMIN)
  async getPrometheus(@Res() res: Response): Promise<void> {
    const { contentType, body } = await this.metrics.renderPrometheus();
    res.setHeader('Content-Type', contentType);
    res.send(body);
  }
}
