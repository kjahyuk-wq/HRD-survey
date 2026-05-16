# 보안 감사 — 상세

**감사일**: 2026-05-16
**감사 범위**: `firestore.rules`(부모/attendance 동일), `attendance/functions/index.js`, 클라이언트 8개 모듈, `firebase.json`

---

## HIGH

### 1. 익명 인증자에 의한 임의 학생 `completed` 플래그 위·변조 (DoS)

**위치**: `firestore.rules:42-53`

**시나리오**:
students/{id} 의 update 규칙이 `isAuthenticated()` 만 요구하고, `changedKeysOnly(['completed','completedAt']) && completed == true` 만 충족하면 허용된다. `signInAnonymously` 만으로 얻는 익명 토큰으로 모든 과정의 모든 학생을 `completed:true` 로 일괄 마킹 가능. `main.js:73` 가 `completed===true` 면 응답 진입을 차단하므로 **모든 교육생의 설문 응답을 영구 차단**할 수 있는 DoS.

```text
allow update: if isAdmin()
  || (isAuthenticated()
      && (changedKeysOnly(['completed','completedAt'])
          && request.resource.data.completed == true) ...);
```

**권장 수정**:
본인성 검증을 강제. `main.js`/`checkin.js` 처럼 학생 식별 인증(custom token claims.empNos 또는 role==student)을 도입하고, 규칙에서 `resource.data.empNo in request.auth.token.empNos && resource.data.name == request.auth.token.name` 비교를 추가. 단기 학생은 현재 무인증 → 설문 제출도 Cloud Function 으로 옮기는 것이 근본 해법.

---

### 2. 메인 설문 사이트(루트) App Check 미적용 — 크로스 사이트 어뷰징

**위치**: `firebase-config.js:1-40` (루트), 대조: `attendance/firebase-config.js:62-71`

**시나리오**:
루트 사이트는 `initializeAppCheck` 호출 자체가 없다. `signInAnonymously` + `collectionGroup('students')` 로 모든 과정의 (이름, 교번, group, completedRounds) 를 한 번에 덤프 가능 (`main.js:37`, `firestore.rules:250`). 외부 봇이 Firebase Web SDK 만 직접 호출해도 차단되지 않음. 응답 spam, 학생 명단 전수 enumerate, 위 #1 DoS 모두 결합 가능.

**권장 수정**:
루트 `firebase-config.js` 에도 attendance 모듈과 동일하게 `initializeAppCheck(app, { provider: new ReCaptchaV3Provider(...), isTokenAutoRefreshEnabled: true })` 추가. 동시에 Firebase 콘솔에서 Firestore 의 App Check 강제(Enforce) 활성화.

---

### 3. 익명 인증자에 의한 임의 학생 명의 응답 위조

**위치**: `firestore.rules:56-101`, `145-201`

**시나리오**:
responses create 규칙이 name/empNo/course 를 string 길이만 검증하고, 실제 등록된 학생 doc 과의 일관성을 검증하지 않는다. 익명 인증만 통과하면 임의 이름·교번으로 응답을 무한 생성 가능 → 통계 오염, 비판적 정성 의견(comment1~3, 각 2000자) 으로 관리자 화면 swamping. App Check 가 없는 루트(#2)와 결합 시 외부 봇에도 노출.

**권장 수정**:
1. App Check 활성화 후
2. 가능하면 학생 식별 후 발급한 custom token claim 으로 본인 학생 doc 의 ref 와 응답을 묶거나(예: `responseId == request.auth.uid + courseId`)
3. 설문 제출도 Cloud Function 화하여 학생 doc 매칭을 서버에서 확인

---

## MEDIUM

### 4. `loginByEmail` / `loginByEmpNo` 응답 형태로 등록 여부 enumeration

**위치**: `attendance/functions/index.js:91-93`, `162-164`

**시나리오**:
실패 메시지 자체는 통일(`LOGIN_FAIL_MSG`)되지만 등록된 메일/이름이면 `200 OK` 와 `customToken` 이 떨어지고, 미등록은 `functions/not-found`. 응답 코드·페이로드 구조로 등록 여부가 그대로 노출됨. 행정망 내부자가 1분당 5회 × 다중 IP 로 충분히 enumerate 가능.

**권장 수정**:
미등록 케이스에도 의도적으로 동일한 latency 보장(상수 시간 sleep) + 응답 페이로드 노이즈 추가는 어렵다. 본질적으로는 **App Check + 더 엄격한 글로벌 rate limit**(전역 분당 50회 등) 도입. `enforceRateLimit` 키에 IP 외에 `name|empNo` 해시도 추가하여 동일 타겟에 대한 추측을 차단.

---

### 5. `qr_tokens` create 시 name/courseId 자기 일관성 미검증

**위치**: `firestore.rules:218-237`, `attendance/checkin.js:404-414`

**시나리오**:
학생은 `studentId == auth.uid` 와 `empNo in token.empNos` 만 충족하면 임의의 `name`/`courseId`/`date`/`session` 으로 QR 토큰을 만들 수 있다. 학생이 자기 empNo 로 자기 uid 의 QR 을 발행하지만 `courseId` 를 다른 과정으로 위장 → 키오스크가 스캔하면 다른 과정의 attendance 컬렉션에 출석 기록을 기록할 수 있다(scan.js:335 의 `addDoc(... 'courses', courseId, 'attendance' ...)`). 본인의 다른 과정으로 출석을 옮길 수도, 자신이 등록되지 않은 과정에 위장 출석을 박을 수도 있다.

**권장 수정**:
규칙에서 `get(/databases/$(database)/documents/courses/$(request.resource.data.courseId)/attendance_students/$(?))` 형태로 학생 등록 doc 존재 검증은 비싸므로, custom token claim 에 `courseIds: [...]` 도 함께 박아 `request.resource.data.courseId in request.auth.token.courseIds` 비교.

---

### 6. 출결 학생 doc 비활성/삭제 후에도 발급된 JWT/QR 14일간 유효

**위치**: `attendance/checkin.js:13-14`, `493-520`, `attendance/functions/index.js:118-122`

**시나리오**:
`setPersistence(auth, browserLocalPersistence)` + 72시간 자동 진행. Cloud Function 에서는 active 검증을 하지만, **이미 발급된 custom token 의 만료까지(기본 1시간)** 와 그 이후 발급된 idToken(refreshToken 기반 갱신, 30~60일) 은 유효. 관리자가 `active:false` 로 차단해도 학생은 그 사이 직접 `qr_tokens` create 호출이 가능(클라이언트는 자동 진행 시 다시 cloud function 을 거치지 않고 onAuthStateChanged 만 신뢰). 14일이라는 SESSION_MAX_AGE_MS 도 사용자 시계 의존이라 우회 가능.

**권장 수정**:
`proceedWithCandidates` 진입 전, 캐시된 candidate 별로 학생 doc + 과정 active 를 한 번 더 재확인하거나, 자동 진행도 매번 Cloud Function 으로 한 번 round-trip(가벼운 `refreshStudent` callable). 또는 token revocation list 운영.

---

### 7. CSP `script-src` 에 `'unsafe-inline'` — XSS 방어 무력화

**위치**: `firebase.json:31`

**시나리오**:
admin-stats/main/admin-courses 의 다수 `innerHTML` 경로(주로 외부 입력은 `escapeHtml/escapeAttr` 처리됨)에서 escape 누락 회귀 1건만 발생해도 즉시 임의 JS 실행 가능. 현재 코드는 escape 가 비교적 일관되지만 `admin-courses.js:237` 의 `metaEl.innerHTML = ... <strong>${total}명</strong> ...` 같은 패턴이 향후 user input 으로 확장될 위험.

**권장 수정**:
인라인 스크립트는 nonce 기반으로 좁히거나, 최소한 `'unsafe-inline'` 제거 후 모든 인라인을 외부 .js 로 이동. 현실적으로는 nonce 도입이 가장 안전.

---

### 8. 관리자 권한이 이메일 화이트리스트 단일 계정 + 커스텀 클레임 미사용

**위치**: `firestore.rules:8-13`, `attendance/functions/index.js:15`, `admin-auth.js:8`, `attendance/scan.js:43`

**시나리오**:
`kjahyuk@korea.kr` 한 계정의 비밀번호가 곧 모든 권한.
1. 키오스크가 같은 관리자 자격으로 동작 → 키오스크에 비밀번호 노출 위험
2. 화이트리스트 변경 시 rules + functions 두 곳을 동기 수정해야 하는데 누락 시 정합성 깨짐
3. `email_verified` 체크 미사용 — 만약 Firebase 콘솔에서 별도 계정이 추가되면 이메일 인증 우회 가능성

관리자 1명 운영이라면 위험 낮으나 키오스크 = 관리자 = QR 발급자 통합 모델이 깨지면 권한 분리 불가.

**권장 수정**:
Firebase Auth custom claim `role: 'admin'` 도입, rules 에서 `request.auth.token.role == 'admin' && request.auth.token.email_verified == true` 로 변경. 키오스크는 별도 `role: 'kiosk'` 계정으로 운영하고 `attendance` create/update 만 허용.

---

## LOW

### 9. PII(메일/이름) 가 클라이언트 콘솔에 로깅

**위치**: `main.js:118` (`console.error(e)`), `attendance/checkin.js:128`, `177` 등

**시나리오**:
오류 시 `e` 전체를 콘솔에 출력. `signInWithCustomToken` 실패 등에서 식별 정보가 메시지에 섞일 수 있고, 향후 Sentry/RUM 도입 시 그대로 수집 위험. 공용 PC DevTools 잔존 가능성.

**권장 수정**:
오류 객체에서 `code` 와 `message` 만 추출해 로그. PII 필드는 `'[redacted]'` 치환.

---

### 10. localStorage 기반 디바이스 잠금/세션 — 클라이언트 위변조 자명

**위치**: `attendance/checkin.js:80-88`, `260-282`, `415-418`

**시나리오**:
`device_locked_*`, `att_login_*`, `qr_token_*` 모두 localStorage. 학생이 DevTools 로 키 삭제 시 잠금 우회 가능(다른 학생 기기 가장). 다만 서버 rules 가 reset_* 마커를 본인 empNo 로만 허용하므로 실제 피해는 "기기 잠금 회피 → 본인이 두 번 출석 시도" 정도로 제한적. 그래도 잠금은 보안 통제가 아니라 UX 가이드일 뿐임을 명시 필요.

**권장 수정**:
디바이스 잠금은 서버에 `qr_tokens` 발행 기록(`device fingerprint` 해시) 으로 옮기거나, 본질적으로 보안 통제가 아닌 UX 통제임을 코멘트로 명확화.

---

## 재확인된 안전 항목 (패치 완료, 변경 불요)

- **`attendance_students` 평문 메일 차단**: rules 121-130 의 `!('email' in request.resource.data)` 가 create/update 양쪽 모두 막음. 우회 경로 없음
- **`reset_*` 마커**: rules 109-113 가 본인 empNo 만 삭제 허용 → 다른 학생 lock 해제 불가
- **`qr_tokens` expiresAt**: rules 235-236 가 `> request.time && < request.time + 15m` 강제 → 무한 토큰 방지
- **응답 본문 컨텍스트 escape**: `escapeHtml`/`escapeAttr` 유틸이 일관되게 사용됨 (utils.js, main.js:424)
- **HSTS, X-Frame-Options DENY, frame-ancestors 'none', Referrer-Policy**: 정상

---

## 우선순위 조치 권고

**P0 (이번 주)**:
1. #2 루트 App Check 활성화 (rules 한 줄 + 콘솔 Enforce)
2. #1 students update 본인성 강화
3. #3 responses create 본인성 강제

**P1 (다음 주)**:
4. #5 qr_tokens courseId 검증 (custom token claim 확장)

**P2 (이번 달)**:
5. #6 active 비활성 후 토큰 무효화
6. #7 CSP unsafe-inline 제거 (nonce 도입)
7. #8 admin/kiosk 권한 분리

#2~#3 는 rules 한 줄 추가 + 한 번의 Hosting 재배포로 즉시 완화 가능.
