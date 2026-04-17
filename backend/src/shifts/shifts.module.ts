import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { ShiftAutoCloseService } from './shift-auto-close.service';

@Module({
  controllers: [ShiftsController],
  providers: [ShiftsService, ShiftAutoCloseService],
})
export class ShiftsModule {}
