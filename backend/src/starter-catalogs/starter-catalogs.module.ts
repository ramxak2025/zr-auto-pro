import { Module } from '@nestjs/common';
import { StarterCatalogsService } from './starter-catalogs.service';
import { StarterCatalogsController } from './starter-catalogs.controller';
@Module({
  providers: [StarterCatalogsService],
  controllers: [StarterCatalogsController],
  exports: [StarterCatalogsService],
})
export class StarterCatalogsModule {}
