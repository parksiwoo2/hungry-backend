import { Injectable } from '@nestjs/common';
import { AnalysisResult } from './interfaces/analysis-result.interface';

@Injectable()
export class AnalysesService {
  /**
   * [임시 구현 - Mock Data]
   * 프론트엔드 테스트를 위해 가짜 데이터를 반환합니다.
   */
  async get(analysisId: string): Promise<AnalysisResult> {
    console.log(`[Mock] getAnalysisById 호출됨: ${analysisId}`);
    
    return {
      analysisId,
      createdAt: new Date().toISOString(),
      sessionIds: ['ses_mock_123'],
      context: 'large_group',
      participantCount: 5,
      victimName: '윤아',
      utterances: [],
      patterns: ['떼카', '셔틀'],
      summary: {
        total: 6,
        urgentCount: 3,
        attackerCounts: { '민준': 6 },
        distinctDays: 6,
        isRepeated: true,
      },
      precedents: {},
      // 핵심 테스트 데이터: 이 ID들이 ActionsService에서 카드로 변환됩니다.
      actionIds: [
        'CARD_EMERGENCY_REPORT',
        'CARD_NO_RETALIATION',
        'CARD_BACKUP_EVIDENCE',
      ],
    };
  }
}
