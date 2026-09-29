import type { PrecedentAnalysisSource } from './precedent-analysis-source';
import type { PrecedentAnalysisIssue } from './precedent-analysis.types';

export function buildPrecedentSearchText(
  source: PrecedentAnalysisSource,
  issues: PrecedentAnalysisIssue[],
): string {
  const issueTexts = issues.flatMap((issue) => [
    issue.searchSummary,
    issue.factPattern,
    ...issue.evidenceTexts,
    ...issue.crimeTypes,
    ...issue.keywords,
    ...issue.courtFindings.flatMap((finding) => [
      finding.courtName,
      finding.holding,
      finding.evidenceAssessment,
      ...finding.abstractRules,
    ]),
  ]);

  return uniqueStrings([
    source.externalId,
    source.caseNumber,
    source.caseName,
    source.courtName,
    source.judgementDate,
    source.caseType,
    source.judgementType,
    source.summary,
    source.gist,
    source.refLaws,
    source.refCases,
    source.fullContent,
    ...source.matchedCategories,
    ...source.matchedQueries,
    ...issueTexts,
  ]).join('\n');
}

export function collectIssueCrimeTypes(
  issues: PrecedentAnalysisIssue[],
): string[] {
  return uniqueStrings(issues.flatMap((issue) => issue.crimeTypes));
}

export function collectIssueKeywords(
  issues: PrecedentAnalysisIssue[],
): string[] {
  return uniqueStrings(issues.flatMap((issue) => issue.keywords));
}

function uniqueStrings(values: Array<string | null>): string[] {
  const strings = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(strings)];
}
