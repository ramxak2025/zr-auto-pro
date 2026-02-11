import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateTenantDto } from './create-tenant.dto';

export class UpdateTenantDto extends PartialType(
  OmitType(CreateTenantDto, [
    'ownerUsername',
    'ownerPassword',
    'ownerFullName',
  ] as const),
) {}
