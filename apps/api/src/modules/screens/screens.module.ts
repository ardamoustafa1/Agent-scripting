import { Module } from '@nestjs/common';

import { ScreensController } from './screens.controller.js';
import { ScreensRepository } from './screens.repository.js';
import { ScreensService } from './screens.service.js';

@Module({ controllers: [ScreensController], providers: [ScreensService, ScreensRepository] })
export class ScreensModule {}
