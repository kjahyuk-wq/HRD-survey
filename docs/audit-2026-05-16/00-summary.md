# HRD 시스템 개선 종합 리포트

**감사일**: 2026-05-16
**대상**: HRD 만족도 조사 + 출결 통합 시스템 (운영 진입 2026-05-10, 1차 하드닝 2026-05-11)
**감사 방식**: 보안 / 효율성·성능 / 디자인·UX / 기능·코드품질 4개 영역 병렬 코드 감사

> 본 리포트는 5/11 하드닝 이후 **새로 발견된 개선 후보** 위주로 정리한 것입니다.
> 영역별 상세 내용은 같은 폴더의 `01-security.md`, `02-performance.md`, `03-design-ux.md`, `04-features-quality.md` 참고.

---

## 🚨 즉시 조치 TOP 10 (1주 이내 권장)

| 우선 | 영역 | 이슈 | 위치 | 조치 |
|---|---|---|---|---|
| **P0** | 보안 | **루트 사이트(만족도) App Check 미적용** — 외부 봇이 익명 토큰으로 학생 명단 전수 enumerate + 응답 spam 가능 | `firebase-config.js:1-40` | attendance 쪽처럼 `initializeAppCheck` 추가 + Firestore 콘솔 Enforce ON |
| **P0** | 보안 | **익명 인증으로 임의 학생 `completed:true` 마킹 가능** → 전 교육생 설문 응답 영구 차단 DoS | `firestore.rules:42-53` | 본인성 검증(custom token claim) 강제 또는 설문 제출을 Cloud Function 화 |
| **P0** | 보안 | **익명 인증으로 임의 학생 명의 응답 위조 가능** → 통계 오염, comment 2000자×3 swamping | `firestore.rules:56-101` | 위 항목과 함께 본인성/responseId 강제 |
| **P0** | 기능 | **설문 응답 중복 제출 race** — 두 탭 동시 제출 시 응답 doc 2개 생성 | `main.js:380-395` | `runTransaction`으로 (응답 add + student `completed` 갱신) 원자화 |
| **P0** | 성능 | **attendance 합성 인덱스 누락** — 운영 첫 출석 시 인덱스 미빌드로 차단 위험 | `attendance/firestore.indexes.json` | `(studentId, date, session) ASC` 합성 인덱스 명시 + 배포 |
| **P1** | 디자인 | **키오스크(scan.html) 결과 메시지 1.6rem** — 강의실 거리에서 시인 불가, 출결 분쟁 유발 | `attendance/scan.html:73-91` | `.scan-result-text` 2rem+, `.scan-result-sub` 색 `#e2e8f0` |
| **P1** | 보안 | **qr_tokens create 시 courseId 자기일관성 미검증** — 학생이 자신이 등록되지 않은 과정에 위장 출석 박을 수 있음 | `firestore.rules:218-237` | custom token에 `courseIds[]` claim 박고 `courseId in token.courseIds` 검증 |
| **P1** | 성능 | **과정 카드 카운트 N×3 RTT** (사내망 가장 비싼 패턴) | `admin-courses.js:248-267` | 카드별 카운트 캐시 30초 TTL 또는 `counters` 맵 비정규화 + `FieldValue.increment()` |
| **P1** | 기능 | **학생 삭제 시 회차(leadership) 응답 cascade 누락** — `rounds/*/responses`는 그대로 남음 | `admin-students.js:217, 245` | leadership 과정은 rounds 컬렉션도 함께 정리 |
| **P1** | 디자인 | **`:focus-visible` 전무 + 폼 `label for=` 누락** — WCAG 위반, 공공기관 의무 | `admin.css` 전역, `index.html:21,24` 등 | 글로벌 `:focus-visible` 룰 + 모든 input에 `for/id` 연결 |

---

## 💡 신기능 후보 (다음 분기)

1. **회차 복제 버튼** — 중견리더 과정 운영 시 동일 강사/분반 구성을 매 회차 재입력 → 회차 카드 "복제"로 일괄 시프트
2. **출결 임박 알림(담당자)** — 09:15에 미스캔 학생 → Cloud Scheduler + Functions 1개로 구현, Blaze 비용 미미
3. **만족도+출결 통합 학생 마스터** — `students` ↔ `attendance_students` 통합 → 등록 작업 절반, 학생 로그인 단일화
4. **응답률/출석률 대시보드** — 진행 중 과정 5~10개를 한 화면에서 비교
5. **결석/출결 수정 사유 입력** — `attendance_audit` 컬렉션과 결합한 한 줄 추가

---

## 📋 추천 진행 순서

1. **이번 주 (P0 5건)**: 보안 3 + 기능 1 + 인덱스 1
   - rules 한 줄 추가 + 인덱스 배포 + 트랜잭션 1건. 외부 위험 즉시 차단
2. **다음 주 (P1 5건)**: 디자인 2 + 보안 1 + 성능 1 + 기능 1
   - 사용자 직접 체감되는 UX와 사내망 성능
3. **이번 달 (MEDIUM)**: 비용 큰 항목 (강사 패널 추상화, README, audit 컬렉션) + 테스트 셋업
4. **다음 분기**: 디자인 토큰 통합 + 신기능 후보 1~2개

> **가장 먼저 칠 항목**: 루트 App Check 활성화 — 한 줄 코드 변경 + 콘솔 Enforce 한 번으로 보안 #1~#3을 모두 1차 완화

---

## 영역별 발견 항목 요약

| 영역 | HIGH | MEDIUM | LOW | 총계 |
|---|---|---|---|---|
| 보안 | 3 | 5 | 2 | 10 |
| 효율성·성능 | 4 | 5 | 4 | 13 |
| 디자인·UX | 4 | 5 | 2 | 11 |
| 기능·코드품질 | 3 | 7 | 0 | 10+신기능5 |

## 잘 되어 있는 부분 (확인됨)

- `attendance_students` 평문 메일 차단 (rules 121-130)
- `reset_*` 본인 empNo 제한 (rules 109-113)
- `qr_tokens` 15분 expiresAt 강제 (rules 235-236)
- `escapeHtml`/`escapeAttr` 유틸 일관 적용
- HSTS, X-Frame-Options DENY, frame-ancestors 'none', Referrer-Policy 정상
- attendance 로그인 응답 메시지 통일 (`LOGIN_FAIL_MSG`)
- 데이터 모델 분리 (`students` ↔ `attendance_students`)
