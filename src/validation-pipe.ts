/**
 * 전역 ValidationPipe — main.ts 와 e2e 가 같은 설정을 쓰도록 한곳에 둔다.
 *
 * 노션 Endpoint 명세의 에러 바디는 `{ "message": "한 문장" }` 이다. class-validator 기본값은
 * message 가 문자열 배열이라, 검증 실패 메시지를 한 문자열로 합쳐 내보낸다.
 * whitelist: true 라서 검증 데코레이터가 없는 DTO 필드는 조용히 제거된다.
 */
import {
  BadRequestException,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';

function collectMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collectMessages(e.children ?? []),
  ]);
}

export function buildValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException(collectMessages(errors).join(' · ')),
  });
}
