const STOP_WORDS = new Set([
  '경우',
  '관련',
  '대한',
  '대해',
  '사건',
  '판례',
  '판단',
  '기준',
  '여부',
  '어떤',
  '어떻게',
  '그리고',
  '또는',
]);

const PARTICLES = [
  '으로부터',
  '에게서',
  '이라는',
  '에서는',
  '이라고',
  '라는',
  '에서',
  '에게',
  '한테',
  '으로',
  '까지',
  '부터',
  '보다',
  '처럼',
  '하고',
  '라고',
  '으로',
  '로',
  '과',
  '와',
  '의',
  '을',
  '를',
  '은',
  '는',
  '이',
  '가',
  '도',
  '만',
  '에',
];

const ENDINGS = [
  '했습니다',
  '하였다',
  '됩니다',
  '하는',
  '해서',
  '하면',
  '해도',
  '되는',
  '되면',
  '했던',
  '했다',
  '한',
  '된',
];

const SYNONYMS: Record<string, string[]> = {
  sns: ['소셜미디어', '사회관계망'],
  단톡방: ['단체채팅방', '단체채팅'],
  카톡: ['카카오톡', '메신저'],
  악플: ['악성댓글', '댓글'],
  욕설: ['모욕', '비방'],
  디엠: ['dm', '메시지'],
};

export function extractPrecedentSearchTerms(
  query: string,
  limit = 30,
): string[] {
  const terms: string[] = [];
  const known = new Set<string>();
  const tokens = query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const add = (value: string) => {
    if (!value || known.has(value) || STOP_WORDS.has(value)) {
      return;
    }
    known.add(value);
    terms.push(value);
  };

  for (const token of tokens) {
    if (token.length < 2) {
      continue;
    }

    add(token);
    const withoutParticle = stripSuffix(token, PARTICLES);
    add(withoutParticle);
    const base = stripSuffix(withoutParticle, ENDINGS);
    add(base);

    for (const synonym of [
      ...(SYNONYMS[token] ?? []),
      ...(SYNONYMS[withoutParticle] ?? []),
      ...(SYNONYMS[base] ?? []),
    ]) {
      add(synonym);
    }

    if (terms.length >= limit) {
      break;
    }
  }

  if (terms.length === 0) {
    const fallback = tokens[0];
    if (fallback) {
      terms.push(fallback);
    }
  }

  return terms.slice(0, limit);
}

export function buildPrecedentTsQuery(terms: string[]): string {
  return terms.join(' | ');
}

function stripSuffix(value: string, suffixes: string[]): string {
  for (const suffix of suffixes) {
    if (value.endsWith(suffix) && value.length - suffix.length >= 2) {
      return value.slice(0, -suffix.length);
    }
  }
  return value;
}
