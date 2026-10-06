import { Controller, Get } from '@nestjs/common';

import { ADAPTER_TYPES } from '@verbis/sdk-connector';

@Controller()
export class HelloController {
  @Get()
  hello(): { service: string; message: string; supportedAdapters: readonly string[] } {
    return { service: 'verbis-connector-hub', message: 'hello', supportedAdapters: ADAPTER_TYPES };
  }
}
