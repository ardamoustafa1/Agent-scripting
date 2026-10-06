import { Controller, Get, Inject } from '@nestjs/common';

import { UuidSchema } from '../../common/dto.js';
import { ZParam, ZQuery } from '../../common/validation/zod.js';
import { ApiOperation, ApiResponse, ApiTag } from '../../openapi/metadata.js';
import { RequirePermissions } from '../authz/permissions.js';

import {
  ScreenDetailSchema,
  ScreenListQuerySchema,
  ScreenPageSchema,
  type ScreenListQuery,
} from './screens.dto.js';
import { ScreensService } from './screens.service.js';

@ApiTag('screens')
@Controller('v1')
export class ScreensController {
  constructor(@Inject(ScreensService) private readonly screens: ScreensService) {}

  @ApiOperation({ summary: 'List screens (pages) of a script version' })
  @ApiResponse(200, 'A page of screens', ScreenPageSchema)
  @RequirePermissions('read:Screen')
  @Get('script-versions/:versionId/screens')
  list(
    @ZParam('versionId', UuidSchema) versionId: string,
    @ZQuery(ScreenListQuerySchema) query: ScreenListQuery,
  ) {
    return this.screens.list(versionId, query);
  }

  @ApiOperation({ summary: 'Get a screen with its components' })
  @ApiResponse(200, 'The screen', ScreenDetailSchema)
  @RequirePermissions('read:Screen')
  @Get('screens/:id')
  get(@ZParam('id', UuidSchema) id: string) {
    return this.screens.get(id);
  }
}
