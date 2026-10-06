import { Inject, Injectable } from '@nestjs/common';

import { DomainError } from '../../common/errors/domain-errors.js';
import { RedisService } from '../../infra/redis/redis.service.js';

@Injectable()
export class DraftLeaseService {
  constructor(@Inject(RedisService) private readonly redis: RedisService) {}
  key(tenant: string, script: string, number: number) {
    return `authoring:lease:${tenant}:${script}:${number}`;
  }
  async claim(tenant: string, script: string, number: number, owner: string) {
    const key = this.key(tenant, script, number);
    if ((await this.redis.client.get(key)) === owner) {
      await this.renew(key, owner);
      return;
    }
    if ((await this.redis.client.set(key, owner, 'PX', 30000, 'NX')) !== 'OK')
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Collaboration room belongs to another server',
      );
  }
  async renew(key: string, owner: string) {
    const ok = await this.redis.client.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],30000) else return 0 end",
      1,
      key,
      owner,
    );
    if (ok !== 1)
      throw new DomainError('VERBIS_SCRIPT_INVALID_TRANSITION', 'Collaboration lease expired');
  }
  async release(key: string, owner: string) {
    await this.redis.client.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      1,
      key,
      owner,
    );
  }
  async assertWritable(tenant: string, script: string, number: number, owner?: string) {
    const lease = await this.redis.client.get(this.key(tenant, script, number));
    if (lease !== null && lease !== owner)
      throw new DomainError(
        'VERBIS_SCRIPT_INVALID_TRANSITION',
        'Flush and close collaboration before changing the saved draft',
      );
    if (owner && lease !== owner)
      throw new DomainError('VERBIS_SCRIPT_INVALID_TRANSITION', 'Collaboration lease lost');
  }
}
