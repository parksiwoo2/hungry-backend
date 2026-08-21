/**
 * 카카오톡 대화 내보내기 파서 (0단계)
 *
 * 두 가지 내보내기 형식을 자동 감지한다:
 *   PC형:     [민준] [오후 2:20] 본문                  (날짜는 구분선에서 상태로 유지)
 *   모바일형:  2026. 6. 23. 오후 10:59, 이름 : 본문      (매 줄에 날짜 포함)
 *             2026. 6. 23. 오후 10:59: A님이 B님과 C님을 초대했습니다.   ← 시스템 줄은 콜론
 *             메시지가 삭제되었습니다.                    ← 시각 없는 단독 줄
 *
 * 파서가 처리하는 것:
 *   - 날짜 상태 유지(PC형) / 줄 단위 날짜(모바일형)
 *   - 오전·오후 → 24시간 (오후 12시는 12시, 오전 12시는 00시)
 *   - 시스템 이벤트: 나감·초대(다중 대상)·강퇴·메시지 삭제 — 카톡감옥·방폭 탐지의 유일한 재료
 *   - 여러 줄 메시지 병합
 */
import { ChatMessage } from './safeguard-analysis.service';

const RE_DATE = /^-*\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;
const RE_MSG = /^\[([^\]]+)\]\s*\[(오전|오후)\s*(\d{1,2}):(\d{2})\]\s*(.*)$/;
const RE_LEAVE = /^\[?([^\][]+?)\]?님이 나갔습니다\.$/;
const RE_INVITE = /^\[?([^\][]+?)\]?님이 (.+)님[을과] 초대했습니다\.$/;
const RE_KICK = /^\[?([^\][]+?)\]?님이 (.+)님을 내보냈습니다\.$/;
const RE_DELETED = /^메시지가 삭제되었습니다\.$/;
const RE_MOBILE =
  /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(,|:)\s*(.*)$/;
const RE_MOBILE_BODY = /^(.+?) : ([\s\S]*)$/;

function to24(ampm: string, hh: string): string {
  let h = Number(hh);
  if (ampm === '오후' && h !== 12) h += 12;
  if (ampm === '오전' && h === 12) h = 0;
  return String(h).padStart(2, '0');
}

/** "황해성님, 황성현님과 변경호" 처럼 나열된 대상들 → 이름 배열 */
function splitTargets(s: string): string[] {
  return (s + '님')
    .split(/님[,과와]\s*|님$/)
    .map((n) => n.replace(/[[\]]/g, '').trim())
    .filter(Boolean);
}

function systemEvent(
  text: string,
  time: string | undefined,
): ChatMessage | null {
  const lv = text.match(RE_LEAVE);
  if (lv) {
    return {
      sender: lv[1],
      time: time ?? '',
      text,
      systemEvent: 'leave',
      target: lv[1],
    };
  }
  const iv = text.match(RE_INVITE);
  if (iv) {
    const targets = splitTargets(iv[2]);
    return {
      sender: iv[1].replace(/[[\]]/g, ''),
      time: time ?? '',
      text,
      systemEvent: 'invite',
      target: targets[0],
      targets: targets.length > 1 ? targets : undefined,
    };
  }
  const kk = text.match(RE_KICK);
  if (kk) {
    const targets = splitTargets(kk[2]);
    return {
      sender: kk[1].replace(/[[\]]/g, ''),
      time: time ?? '',
      text,
      systemEvent: 'kick',
      target: targets[0],
      targets: targets.length > 1 ? targets : undefined,
    };
  }
  if (RE_DELETED.test(text)) {
    return {
      sender: '(알 수 없음)',
      time: time ?? '',
      text,
      systemEvent: 'delete',
    };
  }
  return null;
}

export function parseKakao(raw: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let date: string | null = null;

  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    // ── 모바일형: 줄 자체에 날짜·시각이 있음 ──
    const mb = t.match(RE_MOBILE);
    if (mb) {
      const [, y, mo, d, ampm, hh, mm, sep, rest] = mb;
      date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
      const time = `${date}T${to24(ampm, hh)}:${mm}`;
      const body = sep === ',' ? rest.match(RE_MOBILE_BODY) : null;
      if (body) {
        out.push({ sender: body[1], time, text: body[2] });
      } else {
        const ev = systemEvent(rest, time);
        if (ev) out.push(ev);
      }
      continue;
    }

    // ── 날짜 구분선 ──
    const dd = t.match(RE_DATE);
    if (dd) {
      date = `${dd[1]}-${dd[2].padStart(2, '0')}-${dd[3].padStart(2, '0')}`;
      continue;
    }
    if (!date) continue; // 헤더 줄 (파일명·저장한 날짜)

    // ── 시각 없는 시스템 줄 — 직전 메시지 시각 승계 ──
    const ev = systemEvent(t, out[out.length - 1]?.time);
    if (ev) {
      out.push(ev);
      continue;
    }

    // ── PC형 메시지 ──
    const m = t.match(RE_MSG);
    if (m) {
      out.push({
        sender: m[1],
        time: `${date}T${to24(m[2], m[3])}:${m[4]}`,
        text: m[5],
      });
      continue;
    }
    // 어느 패턴에도 안 맞으면 직전 메시지의 여러 줄 본문
    if (out.length) out[out.length - 1].text += '\n' + t;
  }
  return out;
}
