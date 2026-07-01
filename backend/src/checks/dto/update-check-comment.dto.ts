import { IsString, MaxLength } from 'class-validator';

/**
 * PATCH /checks/:id/comment body — the narrow «свой чек, день в день»
 * comment-only edit. `comment` is REQUIRED but may be an empty string ('' →
 * clears the comment); whitespace-only is normalised to NULL in the service.
 * Deliberately NOT extending BaseCheckDto: this endpoint may touch nothing but
 * the comment, and the global whitelist ValidationPipe strips любые лишние
 * поля so a crafted body can't smuggle money fields through.
 */
export class UpdateCheckCommentDto {
  @IsString()
  @MaxLength(2000)
  comment!: string;
}
