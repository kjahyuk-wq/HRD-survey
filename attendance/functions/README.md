# HRD 출결 Cloud Functions

이메일 기반 식별 로그인 + 학생 등록 함수.

## 함수

| 이름 | 설명 |
|---|---|
| `loginByEmail({ name, email })` | 학생 로그인. HMAC 매칭 → custom token (uid = `stu_<hash28>`, claim `role: 'student'`) |
| `registerAttendanceStudents({ courseId, students[] })` | 관리자 엑셀 일괄 등록. 메일 평문은 함수 스코프에서만 처리 후 폐기 |
| `registerAttendanceStudent({ courseId, name, empNo, email })` | 관리자 단건 등록 |

## 어뷰징 방어

- `enforceAppCheck` — 운영에서만 강제 (`FUNCTIONS_EMULATOR` 환경변수로 자동 우회)
- `maxInstances` — 동시 실행 cap (loginByEmail: 10, register: 5)
- IP별 rate limit — 로그인 분당 5회 초과 시 `resource-exhausted`
- 관리자 함수는 `ADMIN_EMAILS` allowlist 검증 (`kjahyuk@korea.kr`)

---

## 로컬 테스트 (Blaze 없이)

```bash
cd attendance/functions
npm install
echo "EMAIL_PEPPER=$(openssl rand -hex 32)" > .secret.local

# 부모 디렉토리로 가서 dev 띄우기
cd ..
npm run dev
```

접속:
- 에뮬레이터 UI: http://localhost:4000
- 출결 관리자: https://<로컬IP>:3000/admin-attendance.html
- 학생 체크인: https://<로컬IP>:3000/checkin.html
- 강사 스캔: https://<로컬IP>:3000/scan.html

`.secret.local` 의 pepper 는 **테스트 전용**. 운영 pepper 와 절대 동일하지 말 것.

---

## 운영 배포 체크리스트

> 순서대로 진행. 각 단계 완료 후 다음 단계로.

### 1. Blaze 플랜 활성화
- Firebase 콘솔 → 프로젝트 `hrd-data` → 사용량 및 결제 → Blaze 업그레이드 (신용카드 등록)
- 예산 알림: $1 / $5 / $10 (메일 알림)
- 어뷰징 방어 깔린 상태에서 worst case 비용 $5–15 수준 (정상 운영 시 무료 한도 내)

### 2. reCAPTCHA Enterprise 활성화
- Firebase 콘솔 → App Check → 시작하기
- reCAPTCHA Enterprise 공급자 등록
- 발급된 **사이트 키** 복사 (페이지 키 아님)

### 3. 클라이언트 코드에 사이트 키 입력
`attendance/firebase-config.js`:
```js
const RECAPTCHA_SITE_KEY = '6Lxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
```

### 4. CSP 에 reCAPTCHA 도메인 추가
`firebase.json` 의 hosting CSP 헤더 — `script-src` / `frame-src` 에 추가:
```
script-src ... https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/
frame-src 'self' https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/
```
(connect-src 의 `cloudfunctions.net`, `content-firebaseappcheck.googleapis.com` 은 이미 포함됨)

### 5. Pepper 시크릿 등록
```bash
firebase functions:secrets:set EMAIL_PEPPER --project hrd-data
# 안전한 랜덤 hex 입력 (예: openssl rand -hex 32 결과)
# ⚠️ 백업 보관 필수 — 분실 시 전체 학생 재해싱 필요
```

### 6. 의존성 설치
```bash
cd attendance/functions
npm install --omit=dev
```

### 7. 배포
부모 디렉토리에서:
```bash
cd /Users/sonnim/Desktop/HRD-survey
# rules + functions + hosting 일괄
firebase deploy --only firestore:rules,functions,hosting --project hrd-data

# 또는 개별
firebase deploy --only firestore:rules --project hrd-data
firebase deploy --only functions --project hrd-data
# hosting 은 GitHub Actions 자동 배포 (push to main)
```

### 8. 스모크 테스트
1. 출결 관리자 페이지 → admin 로그인
2. 테스트 과정 만들고 학생 1명 등록 (실제 메일)
3. 학생 페이지에서 같은 이름+메일 로그인 → QR 발급 확인
4. 강사 페이지에서 QR 스캔 → 출석 처리 확인
5. 관리자 출석 현황 탭에서 결과 확인
6. Firestore 콘솔에서 `attendance_students` 도큐먼트 확인 — `email_hmac` 필드만 있고 `email` 평문 없음 검증

### 9. (선택) 기존 학생 마이그레이션
출결엔 메일이 필수라 만족도 조사 `students` 데이터로는 부족. 운영 들어갈 때:
- 관리자가 (이름/교번/메일) 채운 엑셀로 새로 일괄 등록
- 만족도 조사 `students` 컬렉션은 **건드리지 않음** (분리 운영)

---

## Pepper 분실 대응

Pepper 가 유출되면: 새 pepper 로 교체 + 모든 학생 `email_hmac` 재계산 (메일 다시 받아야 함).
Pepper 가 분실되면: 기존 학생 전원 메일 재수집 후 재등록.

→ 시크릿 매니저 + 별도 백업(예: 1Password) 이중 보관 권장.

---

## Firestore Rules 동기화 주의

`attendance/firestore.rules` 와 부모 `firestore.rules` 는 **동일 내용을 유지**해야 함.
Firebase CLI 가 프로젝트 외부 경로를 거부하므로 emulator 구동을 위해 attendance/ 안에 사본 보관.

부모 변경 시:
```bash
cp /Users/sonnim/Desktop/HRD-survey/firestore.rules /Users/sonnim/Desktop/HRD-survey/attendance/firestore.rules
```
