import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ChecksService } from './checks.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('checks')
@UseGuards(JwtAuthGuard)
export class ChecksController {
  constructor(private readonly checksService: ChecksService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('masterId') masterId?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.user.tenantId;
    return this.checksService.findAll(tenantId, {
      dateFrom,
      dateTo,
      masterId,
      clientId,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Get('dashboard')
  async getDashboardStats(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.checksService.getDashboardStats(tenantId);
  }

  @Get('ranking')
  async getEmployeeRanking(@Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.checksService.getEmployeeRanking(tenantId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.checksService.findById(id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: any) {
    dto.tenantId = req.user.tenantId;
    return this.checksService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: any) {
    return this.checksService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.checksService.remove(id);
    return { message: 'Check deleted successfully' };
  }
}
