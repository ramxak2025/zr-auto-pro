import { Module } from '@nestjs/common';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

// PushModule is @Global (see push/push.module.ts) so PushService is injectable
// here without importing it. We use PushService to push «новый обязательный
// регламент» to tenant users on assignment — there is no recurring scheduler
// for KB reminders (see KnowledgeService comments).
@Module({
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
