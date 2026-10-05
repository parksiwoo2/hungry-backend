# 사용자 API

현재 요청에 따라 이메일 소유 확인 없이 등록된 이메일로 로그인합니다.
누구든 다른 사람의 이메일을 알면 해당 계정에 로그인할 수 있습니다.
`secretPassword`는 로그인에 사용하지 않는 별도 서비스 비밀번호이며, 확인/잠금해제 API는 이번 범위에 포함하지 않습니다.

| 메서드 | URL           | 요청                                                     | 성공                      |
| ------ | ------------- | -------------------------------------------------------- | ------------------------- |
| POST   | /auth/signup  | email, nickName                                          | 201, 내 정보              |
| POST   | /auth/login   | email                                                    | 200, 내 정보 및 세션 쿠키 |
| POST   | /auth/logout  | 없음                                                     | 204                       |
| GET    | /users/me     | 없음                                                     | 200, 내 정보              |
| PATCH  | /users/me     | email, nickName, maskingIcon, secretPassword 중 1개 이상 | 200, 수정된 내 정보       |
| DELETE | /users/me     | 없음                                                     | 204                       |

회원가입은 자동 로그인하지 않습니다. GET/PATCH/DELETE /users/me에는 로그인이 필요합니다.
로그아웃은 이미 만료된 세션에도 204를 반환합니다.
email은 앞뒤 공백 제거 및 소문자 변환 후 unique, nickName은 앞뒤 공백 제거 및 Unicode NFC 정규화 후 unique입니다.
email 변경 시 이후 로그인에 새 이메일을 사용합니다. 이메일 변경도 현재는 소유 확인을 하지 않습니다.
nickName은 1~30자, secretPassword는 6~128자, maskingIcon은 NONE/NOTE/CALCU만 허용합니다.
maskingIcon을 NOTE 또는 CALCU로 변경하는 요청에는 secretPassword를 반드시 같이 보내야 합니다.
NONE으로 변경할 때는 secretPassword를 생략할 수 있습니다.
기본값은 maskingIcon=NONE, 비밀 비밀번호 미설정입니다. 비밀번호는 scrypt 해시만 저장합니다.

응답 예시:

```json
{
  "id": "c6ad5a38-8fcb-4715-9c44-5b9c8142ccf7",
  "email": "sieu.park@gmail.com",
  "nickName": "몽이",
  "maskingIcon": "NONE",
  "hasSecretPassword": false
}
```

secretPassword 원문과 해시는 어떤 API 응답에도 노출하지 않습니다.
400은 입력 오류, 401은 미로그인/만료/미등록 이메일, 409는 email/nickName 중복입니다.

## 실행 및 프론트 연결

기존 DB 환경변수로 서버를 시작하면 `CreateUsers20260922000000` 마이그레이션이
users와 user_sessions 테이블을 생성합니다. 이전 판례 덤프에 사용자 테이블이 없어도 됩니다.
세션 원본 토큰은 HttpOnly 쿠키에, 토큰의 SHA-256 해시는 PostgreSQL에 저장합니다.
서버 재시작 후에도 유효하며, 로그인 시 현재 브라우저 세션을 새 토큰으로 교체합니다.
세션은 로그인 후 7일이 지나면 만료되며 연장하지 않습니다. 만료 행은 다음 로그인 때 정리됩니다.
탈퇴 시 사용자와 모든 기기의 세션을 영구 삭제합니다.

`.env`를 직접 변경하지 않았습니다. 필요한 경우 다음 설정을 추가하세요:

```dotenv
SESSION_COOKIE_SECURE=false
```

HTTPS를 사용하는 개발 환경은 SESSION_COOKIE_SECURE=true로 설정하세요.
프론트의 `/auth`, `/users` 요청은 프록시가 WAS로 전달하는 같은 출처 구성을 전제로 합니다.

```javascript
await fetch('/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: 'sieu.park@gmail.com' }),
});
```

모든 사용자 API 호출에 credentials: 'include'를 사용하세요.
HTTP 요청 예시는 users.http에 있습니다.
