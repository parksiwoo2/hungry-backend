import {
  PrecedentAnalysisIssue,
  PrecedentAnalysisTarget,
} from './precedent-analysis.types';

export function buildSummaryEmbeddingText(
  issue: PrecedentAnalysisIssue,
): string {
  return issue.searchSummary.trim();
}

export function buildFactEmbeddingText(issue: PrecedentAnalysisIssue): string {
  return [
    `증거 텍스트: ${issue.evidenceTexts.join(' | ')}`,
    `텍스트 유형: ${issue.evidenceType}`,
    `작성 또는 전달 상황: ${issue.factPattern}`,
    `단체 대화방: ${formatNullableBoolean(issue.legalContext.isGroupChat)}`,
    `참여 또는 수신 인원: ${issue.legalContext.audienceCount ?? '확인되지 않음'}`,
    `피해자 식별 가능: ${formatNullableBoolean(issue.legalContext.victimIdentifiable)}`,
  ].join('\n');
}

export function buildRuleEmbeddingText(issue: PrecedentAnalysisIssue): string {
  const abstractRules = uniqueStrings(
    issue.courtFindings.flatMap((finding) => finding.abstractRules),
  );
  const holdings = uniqueStrings(
    issue.courtFindings.map((finding) => finding.holding).filter(Boolean),
  );

  return [
    `죄명 및 법률 카테고리: ${issue.crimeTypes.join(' | ') || '확인되지 않음'}`,
    `일반화된 법리: ${abstractRules.join(' | ') || '확인되지 않음'}`,
    `법원 판단: ${holdings.join(' | ') || '확인되지 않음'}`,
  ].join('\n');
}

export function buildTargetEmbeddingText(
  target: PrecedentAnalysisTarget,
): string {
  return [
    `증거 텍스트: ${target.targetText.trim()}`,
    `단체 대화방: ${target.legalContext.isGroupChat ? '예' : '아니오'}`,
    `참여 또는 수신 인원: ${target.legalContext.audienceCount}`,
    `피해자 식별 가능: ${target.legalContext.victimIdentifiable ? '예' : '아니오'}`,
  ].join('\n');
}

function formatNullableBoolean(value: boolean | null): string {
  if (value === null) {
    return '확인되지 않음';
  }

  return value ? '예' : '아니오';
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
