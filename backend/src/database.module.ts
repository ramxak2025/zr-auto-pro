import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { getDbConfig } from './common/db-config';

const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => new Pool(getDbConfig()),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export { PG_POOL };
