import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export const SESSION_SOURCES = ['kakao_export'] as const;

/** POST /api/sessions — 카톡 내보내기 원문. 파싱은 서버가 한다 */
export class CreateSessionDto {
  @IsString()
  @IsNotEmpty()
  rawText!: string;

  @IsOptional()
  @IsIn(SESSION_SOURCES)
  source?: (typeof SESSION_SOURCES)[number];
}
