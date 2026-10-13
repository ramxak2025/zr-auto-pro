import { BadRequestException } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  ValidateIf,
  ValidateNested,
  validateSync,
} from 'class-validator';

export type ReturnDestination = 'warehouse' | 'defect';
export type ReturnScope = 'full' | 'partial';

export class ReturnLineInput {
  @IsOptional()
  @IsUUID()
  productLineId?: string;

  @IsOptional()
  @IsUUID()
  serviceLineId?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  quantity?: number;
}

export class CreateReturnDto {
  @IsIn(['warehouse', 'defect'])
  destination!: ReturnDestination;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsIn(['full', 'partial'])
  scope!: ReturnScope;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnLineInput)
  lines?: ReturnLineInput[];
}

/** Also protect internal callers that do not pass through Nest's ValidationPipe. */
export function validateReturnInput(dto: CreateReturnDto): void {
  if (
    !dto ||
    typeof dto !== 'object' ||
    Array.isArray(dto) ||
    validateSync(plainToInstance(CreateReturnDto, dto)).length
  ) {
    throw new BadRequestException({ message: 'Некорректные данные возврата' });
  }
  if (dto.destination === 'defect' && !dto.reason?.trim()) {
    throw new BadRequestException({ message: 'Для возврата в брак укажите причину' });
  }
  if (dto.scope === 'partial' && !dto.lines?.length) {
    throw new BadRequestException({ message: 'Укажите позиции для частичного возврата' });
  }
  const seen = new Set<string>();
  for (const line of dto.lines ?? []) {
    if (!!line.productLineId === !!line.serviceLineId) {
      throw new BadRequestException({ message: 'Укажите ровно одну позицию товара или услуги' });
    }
    // UUIDs are case-insensitive in PostgreSQL; spelling must not bypass deduplication.
    const key = line.productLineId
      ? `product:${line.productLineId.toLowerCase()}`
      : `service:${line.serviceLineId?.toLowerCase()}`;
    if (seen.has(key)) {
      throw new BadRequestException({ message: 'Позиция возврата указана повторно' });
    }
    seen.add(key);
  }
}
