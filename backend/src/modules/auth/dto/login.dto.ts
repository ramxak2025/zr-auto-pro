import { IsString, IsNotEmpty } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'Введите телефон' })
  phone: string;

  @IsString()
  @IsNotEmpty({ message: 'Введите пароль' })
  password: string;
}
