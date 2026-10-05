/**
 * POST /api/analyses — context는 공연성 분기(1:1이면 모욕·명예훼손 조문이 통째로 바뀜)의
 * 입력이라, 잘못된 값이 조용히 들어오면 법령 매핑이 틀린다. enum으로 강제한다.
 */
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
} from 'class-validator';

export const CONTEXTS = ['dm', 'small_group', 'large_group', 'public'] as const;

export class CreateAnalysisDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  sessionIds!: string[];

  @IsIn(CONTEXTS, { message: `context는 ${CONTEXTS.join(' | ')} 중 하나` })
  context!: (typeof CONTEXTS)[number];

  @IsString()
  @IsNotEmpty()
  victimName!: string;
}
