/**
 * Safe Guard HTTP 계층
 *
 *   GET  /                UI (public/safeguard-ui.html)
 *   POST /api/analyze     실제 2패스 분석 — 진행 상황을 ndjson으로 스트리밍
 *                         (Claude API 2회 호출, 대화당 약 30초~2분)
 *   POST /api/report      분석 결과로 정리 문서 PDF 생성
 */
import {
  Body,
  Controller,
  Get,
  Post,
  Res,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import {
  SafeguardAnalysisService,
  AnalyzeInput,
} from './safeguard-analysis.service';
import { ReportPdfService } from './report-pdf.service';
import { parseKakao } from './kakao-parser';
import { AnalyzeDto, ReportDto } from './dto/analyze.dto';

@Controller()
export class SafeguardController {
  private readonly logger = new Logger(SafeguardController.name);

  constructor(
    private readonly analysis: SafeguardAnalysisService,
    private readonly pdf: ReportPdfService,
  ) {}

  @Get()
  ui(@Res() res: Response) {
    res
      .type('html')
      .send(
        fs.readFileSync(
          path.join(process.cwd(), 'public', 'safeguard-ui.html'),
        ),
      );
  }

  /** rawText → AnalyzeInput. 파서·검증은 서버가 단일 소스로 수행 */
  private buildInput(dto: AnalyzeDto): AnalyzeInput {
    const messages = parseKakao(dto.rawText);
    if (messages.length === 0)
      throw new BadRequestException('대화 형식을 읽지 못했습니다');
    const senders = [
      ...new Set(messages.filter((m) => !m.systemEvent).map((m) => m.sender)),
    ];
    if (!senders.includes(dto.victimName))
      throw new BadRequestException('피해자 이름이 대화에 없습니다');
    return {
      messages,
      context: dto.context,
      participantCount: senders.length,
      victimName: dto.victimName,
      victimInRoom: true,
    };
  }

  @Post('api/analyze')
  async analyze(@Body() dto: AnalyzeDto, @Res() res: Response) {
    const input = this.buildInput(dto);

    res.set({
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    const send = (obj: unknown) => res.write(JSON.stringify(obj) + '\n');

    this.logger.log(
      `분석 시작 — ${input.messages.length}건 · ${input.context} · 참여 ${input.participantCount}명`,
    );
    const t0 = Date.now();
    try {
      const r = await this.analysis.analyze(input, {
        onStage: (stage, data) => send({ type: 'stage', stage, ...data }),
      });
      send({ type: 'result', flagged: r.flagged, patterns: r.patterns });
      this.logger.log(
        `분석 완료 — 확정 ${r.flagged.length}건 · 패턴 [${r.patterns.join(',')}] · ${((Date.now() - t0) / 1000).toFixed(1)}초`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '분석에 실패했습니다';
      this.logger.error(`분석 실패 — ${msg}`);
      send({ type: 'error', message: msg });
    }
    res.end();
  }

  @Post('api/report')
  async report(@Body() dto: ReportDto, @Res() res: Response) {
    const input = this.buildInput(dto);
    const flagged = dto.result.flagged as never[];
    const summary = this.analysis.aggregate(flagged, input.messages);
    const pdf = await this.pdf.generate({
      input,
      result: { flagged, patterns: dto.result.patterns },
      summary,
      legal: dto.legal !== false,
    });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="report.pdf"',
    });
    res.send(pdf);
    this.logger.log(
      `정리 문서 생성 — ${(pdf.length / 1024).toFixed(0)}KB · ${dto.result.flagged.length}건 · legal=${dto.legal !== false}`,
    );
  }
}
