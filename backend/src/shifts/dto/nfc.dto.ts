import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class NfcTagNameDto {
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, 80)
  name!: string;
}
export class NfcTokenDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
export class NfcScanDto extends NfcTokenDto {
  @IsUUID()
  requestId!: string;
}
