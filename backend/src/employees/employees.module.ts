import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { PrivateDocsBootstrap } from './private-docs.bootstrap';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, PrivateDocsBootstrap],
})
export class EmployeesModule {}
