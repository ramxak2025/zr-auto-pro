import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CheckTemplatesService } from './check-templates.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateCheckTemplateDto, UpdateCheckTemplateDto } from './dto/check-template.dto';

@UseGuards(JwtAuthGuard)
@Controller('check-templates')
export class CheckTemplatesController {
  constructor(private readonly checkTemplatesService: CheckTemplatesService) {}

  // ── Folders (declared before the ':id' routes on purpose) ───────────────

  @Get('folders')
  getFolders(@CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.getFolders(user.tenantID, user.userID);
  }

  @Post('folders')
  createFolder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name: string; parentId?: string | null; sort?: number },
  ) {
    return this.checkTemplatesService.createFolder(user.tenantID, user.userID, dto);
  }

  @Patch('folders/:id')
  updateFolder(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { name?: string; parentId?: string | null; sort?: number },
  ) {
    return this.checkTemplatesService.updateFolder(id, user.tenantID, user.userID, dto);
  }

  @Delete('folders/:id')
  removeFolder(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.removeFolder(id, user.tenantID, user.userID);
  }

  // ── Templates ────────────────────────────────────────────────────────────

  @Get()
  getAll(@CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.getAll(user.tenantID, user.userID);
  }

  /**
   * Тело валидируется DTO-классом (услуги: `serviceId?`, `name`, `price ≥ 0`). `quantity` услуги
   * принимается от старых клиентов, но сохраняется как 1 — см. normalizeTemplateServices.
   */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCheckTemplateDto) {
    return this.checkTemplatesService.create(user.tenantID, user, dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateCheckTemplateDto) {
    return this.checkTemplatesService.update(id, user.tenantID, user, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checkTemplatesService.remove(id, user.tenantID, user);
  }
}
