import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateArticleDto,
  UpdateArticleDto,
  ListArticlesQueryDto,
  CreateCourseDto,
  UpdateCourseDto,
  CreateLessonDto,
  UpdateLessonDto,
  CompleteLessonDto,
  ArticleFeedbackDto,
  CreateTroubleshootingDto,
  UpdateTroubleshootingDto,
  ListTroubleshootingQueryDto,
  ForCarQueryDto,
} from './dto/knowledge.dto';

/**
 * «База знаний» — searchable KB + regulations (063) extended into a full
 * learning + reference system (064):
 *   A. Учебный центр — courses → lessons → progress + quizzes + completion.
 *   B. Регламенты+ — versioning, mandatory, due date, view count, feedback.
 *   C. Справочник типовых неисправностей (troubleshooting).
 *   D. Контекстная KB — articles/troubleshooting for a car make.
 *
 * Два уровня доступа (запрос владельца, миграция 137):
 *   • ПРОСМОТР  — 'knowledge_view' (knowledge.view): GET-чтения базы знаний
 *     (categories, search, courses, courses/:id, troubleshooting, for-car,
 *     checklists, regulations/pending, articles, articles/:id) + пользовательские
 *     действия (complete-lesson, ack, feedback). Раньше эти чтения были открыты
 *     любому аутентифицированному — теперь гейтятся knowledge_view (у «Мастера»
 *     сид true → поведение 1:1; владелец может выключить просмотр у роли);
 *   • УПРАВЛЕНИЕ — 'knowledge_manage' (knowledge.manage): все мутации
 *     (create/update/delete) + менеджерские чтения (view acks/progress of others).
 * manage ⇒ view (flattenRoleMatrix): роль с knowledge_manage проходит и
 * read-гейты. The matrix is authoritative; owner-class (director/superadmin)
 * bypasses via PermissionsGuard. All queries are tenant-scoped by the JWT's
 * tenantID inside the service.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledge: KnowledgeService) {}

  // ─── Categories ───────────────────────────────────────────────────────────

  @RequirePermission('knowledge_view')
  @Get('categories')
  listCategories(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listCategories(user.tenantID);
  }

  @RequirePermission('knowledge_manage')
  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body() dto: CreateCategoryDto) {
    return this.knowledge.createCategory(user.tenantID, dto);
  }

  @RequirePermission('knowledge_manage')
  @Patch('categories/:id')
  updateCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.knowledge.updateCategory(user.tenantID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Delete('categories/:id')
  deleteCategory(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteCategory(user.tenantID, id);
  }

  // ─── Global smart search ────────────────────────────────────────────────────
  // Tenant-scoped search across articles (title + body + block text), category
  // names and course names. READ: any authenticated user (non-managers see only
  // published items, enforced in the service). Distinct /search segment → no
  // collision with the /articles, /courses, /troubleshooting :id routes.

  @RequirePermission('knowledge_view')
  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.knowledge.search(user.tenantID, user, user.userID, q ?? '');
  }

  // ─── A. Учебный центр — courses & lessons ──────────────────────────────────
  // Declared before /articles routes; distinct /courses prefix → no collision.

  @RequirePermission('knowledge_view')
  @Get('courses')
  listCourses(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listCourses(user.tenantID, user, user.userID);
  }

  @RequirePermission('knowledge_manage')
  @Post('courses')
  createCourse(@CurrentUser() user: JwtPayload, @Body() dto: CreateCourseDto) {
    return this.knowledge.createCourse(user.tenantID, user.userID, dto);
  }

  // Static-tail routes BEFORE the bare /courses/:id so they're never captured
  // as a course id.
  @RequirePermission('knowledge_manage')
  @Get('courses/:id/progress/:userId')
  courseProgressForUser(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('userId') userId: string) {
    return this.knowledge.courseProgressForUser(user.tenantID, id, userId);
  }

  @RequirePermission('knowledge_manage')
  @Post('courses/:id/lessons')
  createLesson(@CurrentUser() user: JwtPayload, @Param('id') courseId: string, @Body() dto: CreateLessonDto) {
    return this.knowledge.createLesson(user.tenantID, courseId, dto);
  }

  @RequirePermission('knowledge_view')
  @Get('courses/:id')
  getCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getCourse(user.tenantID, user, user.userID, id);
  }

  @RequirePermission('knowledge_manage')
  @Patch('courses/:id')
  updateCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.knowledge.updateCourse(user.tenantID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Delete('courses/:id')
  deleteCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteCourse(user.tenantID, id);
  }

  // Lessons addressed by their own id (update/delete/complete).
  @RequirePermission('knowledge_view')
  @Post('lessons/:id/complete')
  completeLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CompleteLessonDto) {
    return this.knowledge.completeLesson(user.tenantID, user.userID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Patch('lessons/:id')
  updateLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.knowledge.updateLesson(user.tenantID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Delete('lessons/:id')
  deleteLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteLesson(user.tenantID, id);
  }

  // ─── C. Troubleshooting (типовые неисправности) ────────────────────────────

  @RequirePermission('knowledge_view')
  @Get('troubleshooting')
  listTroubleshooting(@CurrentUser() user: JwtPayload, @Query() query: ListTroubleshootingQueryDto) {
    return this.knowledge.listTroubleshooting(user.tenantID, query);
  }

  @RequirePermission('knowledge_manage')
  @Post('troubleshooting')
  createTroubleshooting(@CurrentUser() user: JwtPayload, @Body() dto: CreateTroubleshootingDto) {
    return this.knowledge.createTroubleshooting(user.tenantID, user.userID, dto);
  }

  @RequirePermission('knowledge_view')
  @Get('troubleshooting/:id')
  getTroubleshooting(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getTroubleshooting(user.tenantID, id);
  }

  @RequirePermission('knowledge_manage')
  @Patch('troubleshooting/:id')
  updateTroubleshooting(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTroubleshootingDto,
  ) {
    return this.knowledge.updateTroubleshooting(user.tenantID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Delete('troubleshooting/:id')
  deleteTroubleshooting(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteTroubleshooting(user.tenantID, id);
  }

  // ─── D. Contextual KB (for a check/car) ────────────────────────────────────

  @RequirePermission('knowledge_view')
  @Get('for-car')
  forCar(@CurrentUser() user: JwtPayload, @Query() query: ForCarQueryDto) {
    return this.knowledge.forCar(user.tenantID, user, user.userID, query);
  }

  @RequirePermission('knowledge_view')
  @Get('checklists')
  listChecklists(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listChecklists(user.tenantID, user, user.userID);
  }

  // ─── Regulation counters (declared before /articles/:id so the static
  //     "regulations" segment can never be captured as an article id) ─────────

  @RequirePermission('knowledge_view')
  @Get('regulations/pending-count')
  regulationsPendingCount(@CurrentUser() user: JwtPayload) {
    return this.knowledge.regulationsPendingCount(user.tenantID, user.userID);
  }

  @RequirePermission('knowledge_manage')
  @Get('regulations/summary-for-user/:userId')
  regulationSummaryForUser(@CurrentUser() user: JwtPayload, @Param('userId') userId: string) {
    return this.knowledge.regulationSummaryForUser(user.tenantID, userId);
  }

  // ─── Articles ─────────────────────────────────────────────────────────────

  @RequirePermission('knowledge_view')
  @Get('articles')
  listArticles(@CurrentUser() user: JwtPayload, @Query() query: ListArticlesQueryDto) {
    return this.knowledge.listArticles(user.tenantID, user, user.userID, query);
  }

  @RequirePermission('knowledge_manage')
  @Post('articles')
  createArticle(@CurrentUser() user: JwtPayload, @Body() dto: CreateArticleDto) {
    return this.knowledge.createArticle(user.tenantID, user.userID, dto);
  }

  // who-acknowledged — manager only.
  @RequirePermission('knowledge_manage')
  @Get('articles/:id/acks')
  listAcks(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.listAcks(user.tenantID, id);
  }

  // any viewer may acknowledge ("Ознакомлен")
  @RequirePermission('knowledge_view')
  @Post('articles/:id/ack')
  acknowledge(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.acknowledge(user.tenantID, user.userID, id);
  }

  // any viewer may leave helpful / not-helpful feedback
  @RequirePermission('knowledge_view')
  @Post('articles/:id/feedback')
  articleFeedback(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ArticleFeedbackDto) {
    return this.knowledge.articleFeedback(user.tenantID, user.userID, id, dto);
  }

  @RequirePermission('knowledge_view')
  @Get('articles/:id')
  getArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getArticle(user.tenantID, user, user.userID, id);
  }

  @RequirePermission('knowledge_manage')
  @Patch('articles/:id')
  updateArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateArticleDto) {
    return this.knowledge.updateArticle(user.tenantID, id, dto);
  }

  @RequirePermission('knowledge_manage')
  @Delete('articles/:id')
  deleteArticle(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteArticle(user.tenantID, id);
  }
}
