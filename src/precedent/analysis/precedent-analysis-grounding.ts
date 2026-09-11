import type { PrecedentLegalAnalysis } from './precedent-analysis.types';

export function keepGroundedTextIssues(
  analysis: PrecedentLegalAnalysis,
  content: string,
): PrecedentLegalAnalysis {
  const normalizedContent = normalizeForGrounding(content);
  const issues = analysis.issues.flatMap((issue) => {
    const evidenceTexts = issue.evidenceTexts.filter((text) => {
      const normalizedText = normalizeForGrounding(text);
      return (
        normalizedText.length >= 2 && normalizedContent.includes(normalizedText)
      );
    });

    return evidenceTexts.length > 0 ? [{ ...issue, evidenceTexts }] : [];
  });

  return { issues };
}

function normalizeForGrounding(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '');
}
