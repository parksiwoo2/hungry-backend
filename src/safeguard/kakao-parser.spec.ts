import { parseKakao } from './kakao-parser';

describe('parseKakao', () => {
  it('PC형 — 날짜 구분선과 오전·오후를 처리한다', () => {
    const raw = [
      '단톡방 님과 카카오톡 대화',
      '저장한 날짜 : 2026-07-17 20:30:12',
      '',
      '--------------- 2026년 7월 16일 목요일 ---------------',
      '[한결] [오후 6:00] 안녕',
      '[다온] [오후 12:30] 정오 메시지',
      '[루아] [오전 12:05] 자정 메시지',
    ].join('\n');

    const out = parseKakao(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      sender: '한결',
      time: '2026-07-16T18:00',
      text: '안녕',
    });
    expect(out[1].time).toBe('2026-07-16T12:30'); // 오후 12시는 그대로
    expect(out[2].time).toBe('2026-07-16T00:05'); // 오전 12시는 00시
  });

  it('모바일형 — 줄 단위 날짜와 이름 : 본문을 처리한다', () => {
    const raw = [
      'Talk_2026.8.12 11:37-1.txt',
      '저장한 날짜 : 2026. 8. 13. 오전 12:41',
      '',
      '2022년 4월 20일 수요일',
      '2022. 4. 20. 오후 8:15, 박시현 : ㅇㅇㅇ',
      '2022. 4. 20. 오후 8:16, 변경호 : 답장',
    ].join('\n');

    const out = parseKakao(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      sender: '박시현',
      time: '2022-04-20T20:15',
    });
    expect(out[1].text).toBe('답장');
  });

  it('모바일형 시스템 줄 — 다중 초대·삭제를 이벤트로 뽑는다', () => {
    const raw = [
      '2026년 6월 23일 화요일',
      '2026. 6. 23. 오후 10:59: 최규진님이 황해성님, 황성현님과 변경호님을 초대했습니다.',
      '2026. 6. 23. 오후 10:59, 최규진 : ㅎㅇ',
      '메시지가 삭제되었습니다.',
    ].join('\n');

    const out = parseKakao(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      systemEvent: 'invite',
      sender: '최규진',
      targets: ['황해성', '황성현', '변경호'],
    });
    expect(out[2]).toMatchObject({
      systemEvent: 'delete',
      time: '2026-06-23T22:59',
    }); // 직전 시각 승계
  });

  it('PC형 시스템 이벤트 — 나감·초대를 잡는다', () => {
    const raw = [
      '--------------- 2026년 7월 16일 목요일 ---------------',
      '[한결] [오후 6:00] 시작',
      '[윤아]님이 나갔습니다.',
      '[한결]님이 [윤아]님을 초대했습니다.',
    ].join('\n');

    const out = parseKakao(raw);
    expect(out[1]).toMatchObject({
      systemEvent: 'leave',
      target: '윤아',
      time: '2026-07-16T18:00',
    });
    expect(out[2]).toMatchObject({ systemEvent: 'invite', target: '윤아' });
  });

  it('여러 줄 메시지는 직전 메시지에 병합한다', () => {
    const raw = [
      '--------------- 2026년 7월 16일 목요일 ---------------',
      '[한결] [오후 6:00] 첫 줄',
      '둘째 줄',
    ].join('\n');

    const out = parseKakao(raw);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('첫 줄\n둘째 줄');
  });

  it('형식이 아닌 입력은 빈 배열', () => {
    expect(parseKakao('아무 내용')).toEqual([]);
  });
});
