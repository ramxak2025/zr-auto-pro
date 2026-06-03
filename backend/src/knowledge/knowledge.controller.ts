import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateArticleDto,
  UpdateArticleDto,
  ListArticlesQueryDto,
} from './dto/knowledge.dto';

/**
 * «База знаний» — searchable KB (categories + articles + attachments) plus
 * regulations with per-user acknowledgment.
 *
 * READ: any authenticated user. WRITE (create/update/delete categories &
 * articles, view who-acked): manager roles only — director / admin /
 * superadmin (the same set other modules use). All queries are tenant-scoped
 * by the JWT's tenantID inside the service.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  // ─── Categories ───────────────────────────────────────────────────────────

  @Get('categories')
  listCategories(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listCategories(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.knowledge.createCategory(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.knowledge.updateCategory(user.tenantID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('categories/:id')
  deleteCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteCategory(user.tenantID, id);
  }

  // ─── Regulation counters (declared before /articles/:id so the static
  //     "regulations" segment can never be captured as an article id) ─────────

  @Get('regulations/pending-count')
  regulationsPendingCount(@CurrentUser() user: JwtPayload) {
    return this.knowledge.regulationsPendingCount(user.tenantID, user.userID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Get('regulations/summary-for-user/:userId')
  regulationSummaryForUser(@CurrentUser() user: JwtPayload, @Param('userId') userId: string) {
    return this.knowledge.regulationSummaryForUser(user.tenantID, userId);
  }

  // ─── Articles ─────────────────────────────────────────────────────────────

  @Get('articles')
  listArticles(@CurrentUser() user: JwtPayload, @Query() query: ListArticlesQueryDto) {
    return this.knowledge.listArticles(user.tenantID, user.role, query);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('articles')
  createArticle(@CurrentUser() user: JwtPayload, @Body() dto: CreateArticleDto) {
    return this.knowledge.createArticle(user.tenantID, user.userID, dto);
  }

  // who-acknowledged — manager only. Declared before GET /articles/:id is fine
  // (distinct trailing segment) but kept adjacent for clarity.
  @Roles('director', 'admin', 'superadmin')
  @Get('articles/:id/acks')
  listAcks(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.listAcks(user.tenantID, id);
  }

  // any user may acknowledge ("Ознакомлен")
  @Post('articles/:id/ack')
  acknowledge(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.acknowledge(user.tenantID, user.userID, id);
  }

  @Get('articles/:id')
  getArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getArticle(user.tenantID, user.role, user.userID, id);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('articles/:id')
  updateArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledge.updateArticle(user.tenantID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('articles/:id')
  deleteArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteArticle(user.tenantID, id);
  }
}
