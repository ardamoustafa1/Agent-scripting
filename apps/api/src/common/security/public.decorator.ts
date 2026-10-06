import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'verbis:public';

/** Route needs no principal and runs outside any tenant transaction (health, docs). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
