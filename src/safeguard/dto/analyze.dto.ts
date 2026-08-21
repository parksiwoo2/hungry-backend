/**
 * 요청 검증 — context는 공연성 분기(1:1이면 모욕·명예훼손 조문이 통째로 바뀜)의
 * 입력이라, 잘못된 값이 조용히 들어오면 법령 매핑이 틀린다. enum으로 강제한다.
 */
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsBoolean,
  IsOptional,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

const CONTEXTS = ['dm', 'small_group', 'large_group', 'public'] as const;

export class AnalyzeDto {
  @IsString()
  @IsNotEmpty()
  rawText!: string; // 카톡 내보내기 원문 — 파싱은 서버가 한다

  @IsIn(CONTEXTS)
  context!: (typeof CONTEXTS)[number];

  @IsString()
  @IsNotEmpty()
  victimName!: string;
}

class ResultFlaggedDto {
  // 주의: whitelist:true 는 "검증 데코레이터가 있는" 필드만 통과시킨다.
  // @Type 만 붙이면 스트립되므로 모든 필드에 검증 데코레이터가 필요하다.
  @IsInt() @Type(() => Number) no!: number;
  @IsArray() @IsString({ each: true }) harmTypes!: string[];
  @IsString() severity!: string;
  @IsString() reason!: string;
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  appliedPrecedentIds?: string[];
}

class ResultDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResultFlaggedDto)
  flagged!: ResultFlaggedDto[];

  @IsArray()
  @IsString({ each: true })
  patterns!: string[];
}

export class ReportDto extends AnalyzeDto {
  @ValidateNested()
  @Type(() => ResultDto)
  result!: ResultDto;

  @IsOptional()
  @IsBoolean()
  legal?: boolean;
}
