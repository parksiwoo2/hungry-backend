import type {
  PrecedentAnalysisIssue,
  PrecedentCourtFinding,
  PrecedentLegalAnalysis,
  PrecedentLegalContext,
} from './precedent-analysis.types';

export function mergePrecedentAnalyses(
  analyses: PrecedentLegalAnalysis[],
): PrecedentLegalAnalysis {
  const issues = new Map<string, PrecedentAnalysisIssue>();

  for (const analysis of analyses) {
    for (const issue of analysis.issues) {
      const key = createIssueKey(issue);
      const existing = issues.get(key);
      issues.set(key, existing ? mergeIssue(existing, issue) : issue);
    }
  }

  return { issues: [...issues.values()] };
}

function createIssueKey(issue: PrecedentAnalysisIssue): string {
  const context = issue.legalContext;
  return [
    issue.evidenceType,
    [...issue.evidenceTexts].map(normalize).sort().join('|'),
    String(context.isGroupChat),
    String(context.audienceCount),
    String(context.victimIdentifiable),
  ].join('::');
}

function mergeIssue(
  existing: PrecedentAnalysisIssue,
  incoming: PrecedentAnalysisIssue,
): PrecedentAnalysisIssue {
  return {
    evidenceType: existing.evidenceType,
    evidenceTexts: uniqueStrings([
      ...existing.evidenceTexts,
      ...incoming.evidenceTexts,
    ]),
    factPattern: longer(existing.factPattern, incoming.factPattern),
    searchSummary: longer(existing.searchSummary, incoming.searchSummary),
    legalContext: mergeContext(existing.legalContext, incoming.legalContext),
    crimeTypes: uniqueStrings([...existing.crimeTypes, ...incoming.crimeTypes]),
    keywords: uniqueStrings([...existing.keywords, ...incoming.keywords]),
    courtFindings: mergeCourtFindings(
      existing.courtFindings,
      incoming.courtFindings,
    ),
  };
}

function mergeContext(
  existing: PrecedentLegalContext,
  incoming: PrecedentLegalContext,
): PrecedentLegalContext {
  return {
    isGroupChat: existing.isGroupChat ?? incoming.isGroupChat,
    audienceCount: existing.audienceCount ?? incoming.audienceCount,
    victimIdentifiable:
      existing.victimIdentifiable ?? incoming.victimIdentifiable,
  };
}

function mergeCourtFindings(
  existing: PrecedentCourtFinding[],
  incoming: PrecedentCourtFinding[],
): PrecedentCourtFinding[] {
  const findings = new Map<string, PrecedentCourtFinding>();

  for (const finding of [...existing, ...incoming]) {
    const key = `${finding.courtLevel}::${normalize(finding.courtName)}`;
    const current = findings.get(key);

    findings.set(
      key,
      current
        ? {
            courtName: longer(current.courtName, finding.courtName),
            courtLevel: current.courtLevel,
            holding: longer(current.holding, finding.holding),
            evidenceAssessment: longer(
              current.evidenceAssessment,
              finding.evidenceAssessment,
            ),
            abstractRules: uniqueStrings([
              ...current.abstractRules,
              ...finding.abstractRules,
            ]),
            isGuiltyRecognized:
              current.isGuiltyRecognized ?? finding.isGuiltyRecognized,
            evidenceAccepted:
              current.evidenceAccepted ?? finding.evidenceAccepted,
            publicityRecognized:
              current.publicityRecognized ?? finding.publicityRecognized,
            specificityRecognized:
              current.specificityRecognized ?? finding.specificityRecognized,
          }
        : finding,
    );
  }

  return [...findings.values()];
}

function uniqueStrings(values: string[]): string[] {
  const unique = new Map<string, string>();

  for (const value of values) {
    const key = normalize(value);
    if (key && !unique.has(key)) {
      unique.set(key, value);
    }
  }

  return [...unique.values()];
}

function longer(left: string, right: string): string {
  return right.length > left.length ? right : left;
}

function normalize(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '');
}
