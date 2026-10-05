export const EVIDENCE_TEXT_TYPES = [
  'group_chat_message',
  'direct_message',
  'social_post',
  'community_post',
  'comment',
  'email',
  'sms',
  'game_chat',
  'online_broadcast_statement',
  'other_digital_text',
] as const;

export type EvidenceTextType = (typeof EVIDENCE_TEXT_TYPES)[number];

export const COURT_LEVELS = [
  'first_instance',
  'appellate',
  'supreme',
  'retrial',
  'unknown',
] as const;

export type CourtLevel = (typeof COURT_LEVELS)[number];

export interface PrecedentLegalContext {
  isGroupChat: boolean | null;
  audienceCount: number | null;
  victimIdentifiable: boolean | null;
}

export interface PrecedentCourtFinding {
  courtName: string;
  courtLevel: CourtLevel;
  holding: string;
  evidenceAssessment: string;
  abstractRules: string[];
  isGuiltyRecognized: boolean | null;
  evidenceAccepted: boolean | null;
  publicityRecognized: boolean | null;
  specificityRecognized: boolean | null;
}

export interface PrecedentAnalysisIssue {
  evidenceType: EvidenceTextType;
  evidenceTexts: string[];
  factPattern: string;
  searchSummary: string;
  legalContext: PrecedentLegalContext;
  crimeTypes: string[];
  keywords: string[];
  courtFindings: PrecedentCourtFinding[];
}

export interface PrecedentLegalAnalysis {
  issues: PrecedentAnalysisIssue[];
}

export interface AnalysisTargetLegalContext {
  isGroupChat: boolean;
  audienceCount: number;
  victimIdentifiable: boolean;
}

export interface PrecedentAnalysisTarget {
  targetText: string;
  legalContext: AnalysisTargetLegalContext;
}

export interface PrecedentMatchRequest {
  analysisTargets: PrecedentAnalysisTarget[];
}

export interface PrecedentMatchScore {
  overall: number;
  semantic: number;
  context: number;
  decisionUsefulness: number;
}

export interface PrecedentMatch {
  precedentId: string;
  issueId: string;
  issueOrder: number;
  caseNumber: string | null;
  caseName: string | null;
  courtName: string | null;
  judgementDate: string | null;
  evidenceType: EvidenceTextType;
  evidenceTexts: string[];
  factPattern: string;
  legalContext: PrecedentLegalContext;
  searchSummary: string;
  crimeTypes: string[];
  keywords: string[];
  courtFindings: PrecedentCourtFinding[];
  score: PrecedentMatchScore;
}

export interface PrecedentTargetMatchResult {
  targetText: string;
  legalContext: AnalysisTargetLegalContext;
  matches: PrecedentMatch[];
}
