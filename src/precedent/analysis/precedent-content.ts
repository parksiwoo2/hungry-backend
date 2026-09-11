export type PrecedentContentStatus =
  'found' | 'empty_content' | 'invalid_content';

export interface PreparedPrecedentContent {
  status: PrecedentContentStatus;
  content: string | null;
}

const INVALID_CONTENT_MARKERS = [
  '국가법령정보 공동활용 미신청',
  'OPEN API 로그인 후',
  '요청하신 페이지를 찾을 수 없습니다',
];

export function preparePrecedentContent(
  fullContent: string | null,
): PreparedPrecedentContent {
  if (!fullContent?.trim()) {
    return { status: 'empty_content', content: null };
  }

  const content = fullContent
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();

  if (INVALID_CONTENT_MARKERS.some((marker) => content.includes(marker))) {
    return { status: 'invalid_content', content: null };
  }

  return { status: 'found', content };
}

export function splitPrecedentContent(
  content: string,
  maxCharacters = 240_000,
  overlapCharacters = 8_000,
): string[] {
  if (content.length <= maxCharacters) {
    return [content];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < content.length) {
    const maximumEnd = Math.min(start + maxCharacters, content.length);
    let end = maximumEnd;

    if (maximumEnd < content.length) {
      const newline = content.lastIndexOf('\n', maximumEnd);
      if (newline > start + Math.floor(maxCharacters * 0.7)) {
        end = newline;
      }
    }

    chunks.push(content.slice(start, end).trim());

    if (end >= content.length) {
      break;
    }

    start = Math.max(start + 1, end - overlapCharacters);
  }

  return chunks.filter(Boolean);
}
