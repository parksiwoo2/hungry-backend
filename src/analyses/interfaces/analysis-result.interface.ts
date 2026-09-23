export interface AnalysisResult {
  analysisId: string;
  createdAt: string;
  sessionIds: string[];
  context: string;
  participantCount: number;
  victimName: string;
  utterances: {
    utteranceId: string;
    sessionId: string;
    messageNos: number[];
    harmTypes: string[];
    severity: string;
    reason: string;
    appliedPrecedentIds: string[];
    excluded: boolean;
    messages: {
      no: number;
      time: string;
      sender: string;
      text: string;
    }[];
  }[];
  patterns: string[];
  summary: {
    total: number;
    urgentCount: number;
    attackerCounts: Record<string, number>;
    distinctDays: number;
    isRepeated: boolean;
  };
  precedents: Record<string, string>;
  actionIds: string[];
}
