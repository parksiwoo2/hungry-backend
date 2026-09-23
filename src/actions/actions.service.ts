import {
  Injectable,
  NotFoundException,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { Action } from './interfaces/action.interface';
import { AnalysesService } from '../analyses/analyses.service';
import { AnalysisResult } from '../analyses/interfaces/analysis-result.interface';

@Injectable()
export class ActionsService implements OnModuleInit {
  private actionMap: Map<string, Action> = new Map();

  constructor(private readonly analysesService: AnalysesService) {}

  onModuleInit(): void {
    const filePath = path.join(__dirname, 'action_mapping.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data: { mapped_actions: Action[] } = JSON.parse(raw);

    for (const action of data.mapped_actions) {
      this.actionMap.set(action.id, action);
    }
  }

  /**
   * analysisId로 DB에서 2차 분석 결과를 조회한 뒤,
   * actionIds를 추출하여 카드로 매핑한다.
   */
  async mapActionsByAnalysis(analysisId: string): Promise<{ actions: Action[] }> {
    let analysis: AnalysisResult;
    try {
      analysis = await this.analysesService.get(analysisId);
    } catch (err: any) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      throw new InternalServerErrorException(
        `Failed to get analysis: ${err?.message ?? 'unknown error'}`,
      );
    }

    const actionIds: string[] = analysis?.actionIds ?? [];

    if (actionIds.length === 0) {
      return { actions: [] };
    }

    return { actions: this.resolveCards(actionIds) };
  }

  /**
   * ID 배열 → 카드 배열 (priority 오름차순, tier 0 자동 최상위)
   */
  private resolveCards(ids: string[]): Action[] {
    const matched: Action[] = [];

    for (const id of ids) {
      const action = this.actionMap.get(id);
      if (action) {
        matched.push(action);
      }
    }

    matched.sort((a, b) => a.priority - b.priority);
    return matched;
  }
}
