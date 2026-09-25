/**
 * 챗봇 요청 DTO — 전역 ValidationPipe 가 whitelist + forbidNonWhitelisted 라서
 * 필드를 추가할 땐 반드시 검증 데코레이터를 붙인다.
 *
 * sessionId 는 Postgres uuid 컬럼에 그대로 들어가므로 형식을 먼저 막는다
 * (아니면 캐스팅 오류가 500 으로 나간다).
 */
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export const MAX_USER_MESSAGE_LENGTH = 2000;

export class StartChatDto {
  @IsString()
  @IsNotEmpty()
  analysisId!: string;
}

export class SendMessageDto {
  @IsUUID()
  sessionId!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'userMessage가 비어 있습니다' })
  @MaxLength(MAX_USER_MESSAGE_LENGTH, {
    message: `userMessage는 ${MAX_USER_MESSAGE_LENGTH}자 이하`,
  })
  userMessage!: string;
}
