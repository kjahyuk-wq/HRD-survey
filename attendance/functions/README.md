# HRD 출결 Cloud Functions

이메일 기반 식별 로그인 + 학생 등록 함수.

## 함수

- `loginByEmail({ name, email })` — 학생 로그인. HMAC 매칭 → custom token.
- `registerAttendanceStudents({ courseId, students[] })` — 관리자 일괄 등록 (엑셀).
- `registerAttendanceStudent({ courseId, name, empNo, email })` — 관리자 단건 등록.

## 배포 전 1회 셋업

```bash
# Blaze 플랜 활성화 (Firebase 콘솔)
# reCAPTCHA Enterprise 활성화 (App Check 용도)

# Pepper 시크릿 설정 (백업 보관 필수 — 분실 시 전체 학생 재해싱)
firebase functions:secrets:set EMAIL_PEPPER

# 의존성 설치
cd functions
npm install

# 배포
firebase deploy --only functions
```

## 로컬 테스트 (Blaze 없이)

```bash
# 시크릿을 .secret.local 로 주입
echo "test-pepper-do-not-use-in-prod" > functions/.secret.local

# 에뮬레이터 실행
firebase emulators:start --only functions,firestore,auth
```

## 어뷰징 방어

- `enforceAppCheck: true` — App Check 통과한 클라이언트만
- `maxInstances` — 동시 실행 cap (loginByEmail: 10, register: 5)
- 함수 내 IP별 rate limit — 로그인 분당 5회 초과 차단
- 관리자 함수는 admin email allowlist 검증
