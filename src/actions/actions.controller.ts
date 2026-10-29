import { Controller, Get, Param } from '@nestjs/common';
import { ActionsService } from './actions.service';
import { CurrentUserId } from '../users/auth.guard';
import { Action } from './interfaces/action.interface';

@Controller('analyses')
export class ActionsController {
  constructor(private readonly actionsService: ActionsService) {}

  /**
   * GET analyses/:analysisId/actions
   * DB에서 분석 결과를 조회하고 actionIds를 추출하여 카드 목록을 반환한다.
   */
  @Get(':analysisId/actions')
  async mapActionsByAnalysis(
    @Param('analysisId') analysisId: string,
    @CurrentUserId() userId: string,
  ): Promise<{ actions: Action[] }> {
    return this.actionsService.mapActionsByAnalysis(analysisId, userId);
  }
}
