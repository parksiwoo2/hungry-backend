/**
 * 가명화 전처리 — 대화가 외부 AI API로 나가기 전에 신원 정보를 지운다.
 *
 * 처리:
 *   1. 참여자 이름 → 가명 (학생A, 학생B, …)  — 성이 붙은 형태("김윤아")도 잡는다
 *   2. 전화번호·주민번호 패턴 → [전화번호]·[주민번호]
 *   3. URL → [링크]
 *
 * 원칙:
 *   - 가명↔실명 매핑은 로컬에만 존재한다. API로 나가는 것은 가명뿐.
 *   - AI 출력(reason·contextNote)에 가명이 섞여 돌아오므로 deanonymize로 역치환한다.
 *   - 메시지 번호(no)는 순서 기반이라 가명화와 무관하게 앵커로 동작한다.
 *
 * 한계(문서화): 이름이 일상 단어와 겹치면(예: "하늘") 오탐 치환이 생길 수 있고,
 * 본문에 참여자 목록에 없는 제3자 실명이 나오면 잡지 못한다.
 * 완전한 익명화가 아니라 최선 노력(best-effort) 마스킹이다.
 */
import type { AnalyzeInput, ChatMessage } from './safeguard-analysis.service';

export interface PseudonymMap {
  /** 가명 → 실명 */
  [pseudonym: string]: string;
}

const PHONE = /\b01[016789][ -]?\d{3,4}[ -]?\d{4}\b/g;
const RRN = /\b\d{6}[ -]\d{7}\b/g;
const URL =
  /https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+(?:com|net|kr|org|io)\/[^\s]*/gi;

export function anonymizeInput(input: AnalyzeInput): {
  input: AnalyzeInput;
  map: PseudonymMap;
} {
  // 참여자 수집: 발신자 + 시스템 이벤트 대상 + 피해자
  const names = new Set<string>();
  for (const m of input.messages) {
    names.add(m.sender);
    if (m.target) names.add(m.target);
    for (const t of m.targets ?? []) names.add(t); // 다중 초대·강퇴 대상
  }
  names.add(input.victimName);

  // 긴 이름부터 치환해야 "김윤아"가 "윤아"보다 먼저 잡힌다
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  const map: PseudonymMap = {};
  const forward = new Map<string, string>(); // 실명 → 가명
  sorted.forEach((name, i) => {
    const pseudo = `학생${String.fromCharCode(65 + i)}`; // 학생A, 학생B, …
    forward.set(name, pseudo);
    map[pseudo] = name;
  });

  const maskText = (s: string): string => {
    let out = s
      .replace(PHONE, '[전화번호]')
      .replace(RRN, '[주민번호]')
      .replace(URL, '[링크]');
    for (const [name, pseudo] of forward) {
      // 성(姓) 한 글자가 앞에 붙은 형태까지 통째로 치환 ("김윤아" → "학생A")
      out = out.replace(new RegExp(`[가-힣]?${escapeRe(name)}`, 'g'), (hit) =>
        hit.endsWith(name) ? pseudo : hit,
      );
    }
    return out;
  };

  const messages: ChatMessage[] = input.messages.map((m) => ({
    ...m,
    sender: forward.get(m.sender) ?? m.sender,
    target: m.target ? (forward.get(m.target) ?? m.target) : m.target,
    targets: m.targets?.map((t) => forward.get(t) ?? t),
    text: maskText(m.text),
  }));

  return {
    input: {
      ...input,
      messages,
      victimName: forward.get(input.victimName) ?? input.victimName,
    },
    map,
  };
}

/** AI 출력 문자열의 가명을 실명으로 되돌린다 (문서 생성 직전에 사용) */
export function deanonymize(text: string, map: PseudonymMap): string {
  let out = text;
  for (const [pseudo, name] of Object.entries(map)) {
    out = out.replace(new RegExp(escapeRe(pseudo), 'g'), name);
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
