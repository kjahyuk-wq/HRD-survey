# 기능·코드 품질 감사 — 상세

**감사일**: 2026-05-16
**감사 범위**: 만족도 조사 + 출결 운영 흐름, 클라이언트/Functions 코드, 데이터 모델

---

## 1. 데이터 정합성 & 에러 처리

### [HIGH] 학생 삭제 시 회차(leadership) 응답이 cascade 삭제되지 않음

**위치**: `admin-students.js:217, 245`

**현 상태**:
`deleteSelectedStudents` / `deleteStudent`는 `courses/{cid}/responses`만 정리. 중견리더 과정의 `rounds/{rid}/responses`는 그대로 남음.

**근거**:
`admin-students.js:217`의 `getDocs(collection(db, 'courses', courseId, 'responses'))` 한 경로만 훑음. 회차 cascade 로직 부재.

**제안**:
`state.courseTypeById[courseId] === 'leadership'`인 경우 `rounds` 컬렉션을 돌며 각 회차의 `responses`도 함께 매칭 삭제. 또는 응답 통계에 "삭제된 학생" 표시가 남아도 무방한지 정책 정리.

---

### [HIGH] 설문 응답 중복 제출 가능 (race condition)

**위치**: `main.js:380-395`

**현 상태**:
`main.js:380-395`는 `addDoc(responses)` + `updateDoc(student, {completed: true})` 두 작업을 트랜잭션 없이 순차 실행. Firestore rules는 `completed`가 false→true 단방향만 막을 뿐, 동일 학생이 두 탭에서 동시에 제출 버튼을 눌러 두 응답 doc이 생기는 케이스는 차단 못함. 회차 모드의 `arrayUnion`은 멱등하지만 응답 doc은 중복 생성 가능.

**제안**:
`runTransaction`으로
1. 학생 doc의 `completed`/`completedRounds` 검사
2. response 작성
3. student 갱신
을 원자적으로. 또는 response 문서 ID를 `${studentDocId}_${roundId||'std'}` 고정 + rules에서 ID 매칭 강제.

---

### [MEDIUM] `deleteSelectedStudents`의 응답 매칭 키가 약함

**위치**: `admin-students.js:216`

**현 상태**:
`${name}|${empNo}` 키로 응답을 매칭. 동명이인+같은 교번이 같은 과정에 있으면(이상하지만 가능) 둘 다 매칭. 또 이름 변경 후 삭제 시 옛 응답이 매칭 실패.

**제안**:
학생 doc ID 또는 `studentId`(uid) 필드를 응답에 박아두고 그것으로 조인. 출결 모듈은 이미 그렇게 함(`scan.js:336` `studentId: studentId || null`).

---

## 2. 데드 코드 / 중복 / 추상화 부재

### [MEDIUM] `sortInstructors` 동일 함수가 4개 파일에 복제됨

**근거**:
`main.js:411-421`, `admin-stats.js:9-19`, `admin-preview.js:10-20`, `admin-courses.js:745-758`(normalizeInstructorOrder), `admin-rounds.js:306-314`. 정책은 같음("order 우선 → createdAt fallback").

**제안**:
`admin-utils.js`에 `sortByOrderThenCreatedAt(arr)` 단일 export. main.js는 모듈 import 안 쓰는 형태라 별도 sortInstructors 유지 필요할 수 있으나 admin 측은 통합 가능.

---

### [MEDIUM] `escapeHtml`/`escapeAttr`가 3곳에 복제됨

**근거**:
`admin-utils.js:43-62`, `main.js:424-442`, `attendance/utils.js:6-24`. 정의는 동일.

**제안**:
ES 모듈을 쓰는 admin/attendance 트리는 공통화 가능. `main.js`는 type="module"이 아니어서 분리 유지 필요할 수도 — 확인 후 통합.

---

### [MEDIUM] 단기과정 강사관리와 회차별 강사관리 패턴 거의 완전 복제

**근거**:
`admin-courses.js:631-1019`(엑셀/추가/순서/수정/일괄삭제) vs `admin-rounds.js:262-766`의 회차 강사 블록. 동일 패턴(escape, batch, missing-order backfill, drag-drop)을 두 번 작성. `admin-rounds.js`의 길이(859줄)도 상당 부분이 이 복제.

**제안**:
`InstructorPanel(courseRef, cacheNamespace)` 같은 팩토리 함수로 추출. 분반(groups) 처리만 옵션으로 분기.

---

### [LOW] 데드 / 비활성 분기

- `firestore.rules:208` 주석 "이전에는 익명 분기가 있었으나... 제거"는 정리 끝났음
- 학생 흐름의 `auth.currentUser?.uid || null` 분기 (`scan.js:336`)와 `checkin.js:322`의 "인증 안 된 비정상 흐름 fallback" — 정상 흐름에선 늘 uid 있으므로 죽은 코드 가능성. 보존하려면 명시적 로깅
- `index.html:23`의 만족도 로그인 화면은 이름+교번 방식. 출결 로그인은 메일/교번 분리 (`checkin.html`). 두 시스템 학생 컬렉션이 분리되어 있어 "한 번 로그인 = 양쪽 진입" 통합 여지 (신기능 후보로 분리)

---

## 3. 운영/로깅/관측성

### [HIGH] 클라이언트 에러 추적이 `console.error` 뿐

**현 상태**:
32개 에러 핸들러가 모두 `alert('...오류...')` 또는 `console.error`. 운영 사용자의 에러를 관리자가 알 방법이 없음.

**근거**:
`grep -c "alert(" admin-*.js` → 단순 alert 55회. 모두 e.message 없이 사용자 친화 문구만 표시.

**제안**:
1. `firebase/analytics` logEvent 또는 단순 `errors/{auto}` Firestore 컬렉션에 `{ts, fn, code, message, uid}` 박는 헬퍼 — 사내망 차단 대비 fire-and-forget
2. `e.code` 토대로 분기 메시지(현재 `admin-rounds.js:24`에만 일부 적용)

---

### [MEDIUM] App Check 거부/Functions 호출 실패 모니터링 부재

**근거**:
`attendance/firebase-config.js:64-71`이 `initializeAppCheck` 결과를 `console.info`만. Functions 실패 코드(`functions/resource-exhausted`, `functions/permission-denied`)도 사용자 alert만.

**제안**:
Firebase Console > Functions 로그 + Cloud Monitoring 알림 (Slack/이메일 webhook). worst-case `rate_limits` 컬렉션 자체가 폭주 신호.

---

### [MEDIUM] 운영 가이드 누락

**현 상태**:
루트에 `README.md` 없음. `attendance/functions/README.md`만 존재 — 출결 배포 절차는 정리되어 있으나 만족도 시스템 일반 운영 매뉴얼은 없음.

**제안**:
루트 README — 과정/회차/분반 운영 흐름, 정책(과정 종료의 의미, 회차 삭제 시 cascade), 자주 막히는 케이스, EMAIL_PEPPER 회전 절차(현재 README에 분실 대응만).

---

## 4. 데이터 변경 추적 & 백필/마이그레이션

### [HIGH] 출결 수정 사유/이력 기록 없음

**위치**: `attendance/admin-attendance.js:912-917`

**현 상태**:
`saveStudentManual`가 출결을 덮어쓰지만, **누가/언제/왜** 수정했는지 기록 없음. `manual: true` 플래그만.

**근거**:
setDoc payload — `updatedAt`만, 사유 필드 없음.

**제안**:
`attendance_audit` 서브컬렉션에 `{by: auth.uid/email, prevStatus, newStatus, reason, ts}` 박기. UI에 사유 입력란(선택). 행정직 감사에 대응.

---

### [MEDIUM] 백필/마이그레이션 도구 부재

**현 상태**:
코드 곳곳에 인라인 백필 — 강사 `order` 백필(`admin-courses.js:789-797`, `admin-rounds.js:316-326`), legacy `common` 키워드 호환(`admin-rounds.js:535-541`). 일회성 마이그레이션 스크립트로 분리되어 있지 않아 모든 페이지 로드마다 검사.

**제안**:
`tools/migrate-*.js` 분리 + 한 번 실행으로 끝나는 스크립트. 현재 inline 코드 제거 가능.

---

## 5. 회귀 위험 큰 곳 (테스트 없음)

### [MEDIUM] 통계 계산 `computeStats`

**위치**: `admin-stats.js:22-69`

**근거**:
단일 패스 합산 — Q1~Q9 / 강사 / Demographics 동시. 강사 키 `${edu}__${name}` 인코딩(`main.js:345`)과 디코딩(`admin-stats.js:422`) 양쪽이 어긋나면 통계 0 표시. 분반 필터링 분기(`admin-stats.js:282, 299`)까지 합쳐 6분기 발생 — 회귀 시 손상 큼.

**제안**:
순수 함수이므로 노드 테스트 도입이 가장 가성비 — fixture 응답 → 기대 통계 일치 검증. CI에 mocha/vitest 5분 셋업.

---

### [MEDIUM] QR 만료/지각 판정 로직

**위치**: `scan.js:295-330`

**근거**:
`expiresAt` Timestamp/Date 두 형식, `LATE_GRACE_MIN=15`분 cutoff, 세션 키 분기. 회귀 시 출결 데이터 직접 손상.

**제안**:
핵심 로직(만료 판정, 지각 판정)을 순수 함수로 분리하고 단위 테스트.

---

## 6. 신기능 후보

### 1. 회차 복제(Duplicate Round)
중견리더 과정에서 동일 강사/분반 구성의 새 회차를 만드는 빈도가 높을 텐데, 현재는 강사 엑셀 재업로드만 가능. 회차 카드의 "복제" 버튼 → 강사+분반+기간 시프트 자동.

### 2. 결석 사유 / 출결 수정 사유 입력
위 4번 항목과 결합. UI 한 줄 추가 + audit 컬렉션.

### 3. 출결 임박 알림 (담당자용)
학생이 수업일 09:15(grace+1) 시점까지 미스캔이면 담당자에게 알림. Cloud Scheduler + Functions 1개로 구현 가능, Blaze 비용 미미.

### 4. 만족도 + 출결 통합 학생 마스터
현재 `students` (만족도용)와 `attendance_students` (출결용)가 분리. 통합 마스터 + 두 시스템에서 view-only 참조하면 등록 작업 절반으로 줄어듦. 학생 입장에서도 메일/교번 로그인 단일화 가능.

### 5. 응답률/출석률 대시보드
현재 과정 카드에 카운트는 있지만 시계열·다과정 비교 부재. 진행 중 과정 5-10개를 한 화면에 비교(평균 응답률, 평균 만족도, 평균 출석률).

---

## 핵심 요약

- **HIGH 3건**: 학생 삭제 cascade 누락, 설문 중복 제출 가능, 클라이언트 에러 가시성
- **MEDIUM 7건**: 강사관리 중복(복제), 출결 audit 부재, sort/escape 유틸 복제, 회귀 위험 핫스팟(통계/QR) 무테스트, 운영 README 부재, 백필 인라인 산재, App Check 모니터링
- **보안/방어 면에서 잘된 곳**: rules의 응답 검증(`firestore.rules:60-101, 153-200`), App Check + rate limit + EMAIL_PEPPER HMAC, 익명/관리자 권한 분리, 키오스크 세션 격리(`scan.js:33`)

**관련 파일**:
- `/Users/sonnim/Desktop/HRD-survey/admin-students.js`
- `/Users/sonnim/Desktop/HRD-survey/main.js`
- `/Users/sonnim/Desktop/HRD-survey/admin-stats.js`
- `/Users/sonnim/Desktop/HRD-survey/admin-courses.js`
- `/Users/sonnim/Desktop/HRD-survey/admin-rounds.js`
- `/Users/sonnim/Desktop/HRD-survey/attendance/admin-attendance.js`
- `/Users/sonnim/Desktop/HRD-survey/attendance/functions/index.js`
- `/Users/sonnim/Desktop/HRD-survey/firestore.rules`
- `/Users/sonnim/Desktop/HRD-survey/attendance/functions/README.md`
