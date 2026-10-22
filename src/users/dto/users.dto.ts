import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEmail,
  IsEnum,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MaskingIcon } from '../entities/user.entity';

export class LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: '올바른 email을 입력하세요.' })
  @MaxLength(254, { message: 'email은 254자 이하여야 합니다.' })
  email!: string;
}

export class SignupDto extends LoginDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString({ message: 'nickName은 문자열이어야 합니다.' })
  @Length(1, 30, { message: 'nickName은 1~30자여야 합니다.' })
  nickName!: string;
}

export class UpdateUserDto {
  @ValidateIf((_input: UpdateUserDto, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: '올바른 email을 입력하세요.' })
  @MaxLength(254, { message: 'email은 254자 이하여야 합니다.' })
  email?: string;

  @ValidateIf((_input: UpdateUserDto, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().normalize('NFC') : value,
  )
  @IsString({ message: 'nickName은 문자열이어야 합니다.' })
  @Length(1, 30, { message: 'nickName은 1~30자여야 합니다.' })
  nickName?: string;

  @ValidateIf((_input: UpdateUserDto, value: unknown) => value !== undefined)
  @IsEnum(MaskingIcon, {
    message: 'maskingIcon은 NONE, NOTE, CALCU 중 하나여야 합니다.',
  })
  maskingIcon?: MaskingIcon;

  @ValidateIf(
    (input: UpdateUserDto) =>
      input.secretPassword !== undefined ||
      (input.maskingIcon !== undefined &&
        input.maskingIcon !== MaskingIcon.NONE),
  )
  @IsDefined({
    message:
      'maskingIcon을 NOTE 또는 CALCU로 변경할 때 secretPassword가 필요합니다.',
  })
  @IsString({ message: 'secretPassword는 문자열이어야 합니다.' })
  @Length(6, 128, { message: 'secretPassword는 6~128자여야 합니다.' })
  secretPassword?: string;
}
