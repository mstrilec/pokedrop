import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator.js';
import { AppService } from './app.service.js';
import { Doc } from './common/openapi.js';

@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Doc('API root: a plain-text greeting that proves the process answers', 'A plain-text greeting')
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
