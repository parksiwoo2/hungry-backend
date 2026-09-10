/**
 *   GET /   테스트용 모바일 UI (public/safeguard-ui.html)
 *
 * 분석 API는 sessions.controller.ts · analyses.controller.ts 에 있다.
 */
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller()
export class SafeguardController {
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
}
