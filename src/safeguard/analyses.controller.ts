/**
 *   POST   /api/analyses                      분석 실행 — 진행 단계를 ndjson으로 스트리밍, 마지막 줄이 결과
 *   GET    /api/analyses?limit=&offset=       내 분석 목록 (최신순)
 *   GET    /api/analyses/:analysisId          분석 결과 (의심 구간·패턴·집계·판례)
 *   DELETE /api/analyses/:analysisId          분석 삭제
 *   GET    /api/analyses/:analysisId/report   정리 문서 PDF (?legal=false 면 법조 없이 사실만)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AnalysesService } from './analyses.service';
import { CreateAnalysisDto } from './dto/analysis.dto';

function toInt(v: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(v ?? '', 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

@Controller('api/analyses')
export class AnalysesController {
  constructor(private readonly analyses: AnalysesService) {}

  @Post()
  async create(@Body() dto: CreateAnalysisDto, @Res() res: Response) {
    // 검증 실패(400·404)는 스트림을 열기 전에 보통의 JSON 에러로 나가야 한다
    const prepared = await this.analyses.prepare(dto);

    res.status(201).set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

    const out = await this.analyses.run(prepared, (stage, data) =>
      send({ type: 'stage', stage, ...data }),
    );
    if (out.ok) send({ type: 'result', ...out.analysis });
    else
      send({ type: 'error', analysisId: out.analysisId, message: out.message });
    res.end();
  }

  @Get()
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.analyses.list(
      toInt(limit, 20, 100) || 20,
      toInt(offset, 0, Number.MAX_SAFE_INTEGER),
    );
  }

  @Get(':analysisId')
  get(@Param('analysisId') id: string) {
    return this.analyses.get(id);
  }

  @Delete(':analysisId')
  @HttpCode(204)
  async remove(@Param('analysisId') id: string) {
    await this.analyses.remove(id);
  }

  @Get(':analysisId/report')
  async report(
    @Param('analysisId') id: string,
    @Query('legal') legal: string | undefined,
    @Res() res: Response,
  ) {
    const pdf = await this.analyses.report(id, legal !== 'false');
    const name = `정리문서-${id}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="report-${id}.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
    });
    res.send(pdf);
  }
}
