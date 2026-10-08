import { ShiftsNfcService } from './shifts-nfc.service';
import { ShiftsNfcController } from './shifts-nfc.controller';
import { Module } from '@nestjs/common';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { ShiftAutoCloseService } from './shift-auto-close.service';

@Module({
  controllers: [ShiftsController, ShiftsNfcController],
  providers: [ShiftsService, ShiftAutoCloseService, ShiftsNfcService],
})
export class ShiftsModule {}
