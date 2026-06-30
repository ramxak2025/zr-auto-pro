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
 * READ: any authenticated user. WRITE (create/update/delete, view acks/progress
 * of others): manager roles only — director / admin / superadmin. All queries
 * are tenant-scoped by the JWT's tenantID inside the service.
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

  // ─── Global smart search ────────────────────────────────────────────────────
  // Tenant-scoped search across articles (title + body + block text), category
  // names and course names. READ: any authenticated user (non-managers see only
  // published items, enforced in the service). Distinct /search segment → no
  // collision with the /articles, /courses, /troubleshooting :id routes.

  @Get('search')
  search(@CurrentUser() user: JwtPayload, @Query('q') q?: string) {
    return this.knowledge.search(user.tenantID, user.role, user.userID, q ?? '');
  }

  // ─── A. Учебный центр — courses & lessons ──────────────────────────────────
  // Declared before /articles routes; distinct /courses prefix → no collision.

  @Get('courses')
  listCourses(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listCourses(user.tenantID, user.role, user.userID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('courses')
  createCourse(@CurrentUser() user: JwtPayload, @Body() dto: CreateCourseDto) {
    return this.knowledge.createCourse(user.tenantID, user.userID, dto);
  }

  // Static-tail routes BEFORE the bare /courses/:id so they're never captured
  // as a course id.
  @Roles('director', 'admin', 'superadmin')
  @Get('courses/:id/progress/:userId')
  courseProgressForUser(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('userId') userId: string) {
    return this.knowledge.courseProgressForUser(user.tenantID, id, userId);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('courses/:id/lessons')
  createLesson(@CurrentUser() user: JwtPayload, @Param('id') courseId: string, @Body() dto: CreateLessonDto) {
    return this.knowledge.createLesson(user.tenantID, courseId, dto);
  }

  @Get('courses/:id')
  getCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getCourse(user.tenantID, user.role, user.userID, id);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('courses/:id')
  updateCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.knowledge.updateCourse(user.tenantID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('courses/:id')
  deleteCourse(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteCourse(user.tenantID, id);
  }

  // Lessons addressed by their own id (update/delete/complete).
  @Post('lessons/:id/complete')
  completeLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CompleteLessonDto) {
    return this.knowledge.completeLesson(user.tenantID, user.userID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('lessons/:id')
  updateLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.knowledge.updateLesson(user.tenantID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('lessons/:id')
  deleteLesson(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteLesson(user.tenantID, id);
  }

  // ─── C. Troubleshooting (типовые неисправности) ────────────────────────────

  @Get('troubleshooting')
  listTroubleshooting(@CurrentUser() user: JwtPayload, @Query() query: ListTroubleshootingQueryDto) {
    return this.knowledge.listTroubleshooting(user.tenantID, query);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('troubleshooting')
  createTroubleshooting(@CurrentUser() user: JwtPayload, @Body() dto: CreateTroubleshootingDto) {
    return this.knowledge.createTroubleshooting(user.tenantID, user.userID, dto);
  }

  @Get('troubleshooting/:id')
  getTroubleshooting(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.getTroubleshooting(user.tenantID, id);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('troubleshooting/:id')
  updateTroubleshooting(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTroubleshootingDto,
  ) {
    return this.knowledge.updateTroubleshooting(user.tenantID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('troubleshooting/:id')
  deleteTroubleshooting(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.knowledge.deleteTroubleshooting(user.tenantID, id);
  }

  // ─── D. Contextual KB (for a check/car) ────────────────────────────────────

  @Get('for-car')
  forCar(@CurrentUser() user: JwtPayload, @Query() query: ForCarQueryDto) {
    return this.knowledge.forCar(user.tenantID, user.role, user.userID, query);
  }

  @Get('checklists')
  listChecklists(@CurrentUser() user: JwtPayload) {
    return this.knowledge.listChecklists(user.tenantID, user.role, user.userID);
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
    return this.knowledge.listArticles(user.tenantID, user.role, user.userID, query);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('articles')
  createArticle(@CurrentUser() user: JwtPayload, @Body() dto: CreateArticleDto) {
    return this.knowledge.createArticle(user.tenantID, user.userID, dto);
  }

  // who-acknowledged — manager only.
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

  // any user may leave helpful / not-helpful feedback
  @Post('articles/:id/feedback')
  articleFeedback(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ArticleFeedbackDto) {
    return this.knowledge.articleFeedback(user.tenantID, user.userID, id, dto);
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
