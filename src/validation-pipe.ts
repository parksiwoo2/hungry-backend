/**
 * 전역 ValidationPipe — main.ts 와 e2e 가 같은 설정을 쓰도록 한곳에 둔다.
 *
 * 노션 Endpoint 명세의 에러 바디는 `{ "message": "한 문장" }` 이다. class-validator 기본값은
 * message 가 문자열 배열이라, 검증 실패 메시지를 한 문자열로 합쳐 내보낸다.
 * whitelist + forbidNonWhitelisted 라서 검증 데코레이터가 없는 DTO 필드가 오면 400이다
 * (팀 main 설정). 필드를 추가할 땐 반드시 데코레이터를 붙일 것.
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
    forbidNonWhitelisted: true,
    stopAtFirstError: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException(collectMessages(errors).join(' · ')),
  });
}
