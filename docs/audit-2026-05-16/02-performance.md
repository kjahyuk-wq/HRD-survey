# 효율성·성능 감사 — 상세

**감사일**: 2026-05-16
**환경 특이점**: 운영 PC가 사내(행정망) — Firestore WebChannel 스트림 차단, `?proxy=1` long-polling 강제
**감사 규모**: 클라이언트 코드 약 11,121줄, admin.html은 ESM 한 진입점에서 7개 모듈 정적 import

---

## HIGH

### H1. admin.html 첫 로드에서 7개 모듈을 모두 동기 import (코드 분할 부재)

**위치**: `admin.js:4-10` (정적 import 7건)

**현재**:
admin.js가 진입하자마자 `admin-courses.js` 47KB, `admin-rounds.js` 41KB, `admin-stats.js` 23KB, `admin-students.js` 22KB, `admin-excel.js` 12KB, `admin-preview.js` 9KB, `admin-auth.js`까지 ESM 그래프 한 번에 fetch. 로그인 직후 보이는 화면은 "교육과정 탭"뿐인데 통계/엑셀/미리보기/회차 코드가 전부 다운로드된다. `firebase.json:35-38` JS Cache-Control은 `max-age=300`(5분)이라 반복 진입 시에도 5분만 지나면 7개 모듈 재검증.

**개선**:
탭 진입 핸들러(`goToCourseTab`)에서 `await import('./admin-stats.js')` 동적 import로 전환. `admin-excel.js`(317줄, 캔버스/XLSX 의존)는 사용자가 "엑셀 다운로드" 버튼 누를 때까지 지연. `admin-rounds.js`는 중견리더 카드의 "회차관리" 클릭 시점.

**예상 효과**:
초기 파서 워크로드 ~165KB → ~55KB. 행정망 long-polling 환경에서 첫 그림 1~2초 단축.

---

### H2. 과정 카드 카운트 N×3 RTT (사내망 가장 비싼 패턴)

**위치**: `admin-courses.js:248-267`

**현재**:
과정 N개에 대해 카드마다 `Promise.all([getCountFromServer(stuRef), getCountFromServer(query(stuRef, where('completed', '==', true))), getCountFromServer(instRef)])` — 3 카운트 쿼리. N개 카드를 `for-await` 없이 `forEach async`로 띄우니 동시 N×3개 long-polling 채널이 한꺼번에 열림. attendance/admin-attendance.js:165-178도 동일 패턴 1개. 캐시(`counts:${c.id}`)는 즉시 표시에만 쓰이고 TTL이 없어 fresh 호출은 항상 발생.

**개선**:
1. `lsRead(counts:${cid})`의 `at` 타임스탬프로 30초 TTL 적용 — 카드 클릭이 잦아도 30초 내 재진입은 캐시만
2. 카운트를 과정 문서의 `counters` 맵에 비정규화 + `addStudent`/`deleteStudent` 시 `FieldValue.increment()`로 갱신. 카드 1장당 RTT 3→0

**예상 효과**:
카드 10개 기준 동시 RTT 30→0(캐시 신선 시). 첫 진입도 비정규화 후엔 0개 카운트 호출.

---

### H3. main.js 학생 로그인의 active 검증 직렬 N RTT

**위치**: `main.js:47` 및 Functions `attendance/functions/index.js:98-104, 170-176`

**현재**:
- main.js: `await Promise.all(candidates.map(c => getDoc(c.ref.parent.parent)))` — 클라이언트는 병렬화 완료, 양호
- Functions: `for (const d of allMatches) { ... await db.collection('courses').doc(courseId).get(); }` — 동명이인이 K개 활성 과정에 등록돼 있으면 K RTT가 **직렬**. 한국 리전(asia-northeast3)이라 RTT 30~50ms × K. K=5면 250ms 추가

**개선**:
`Promise.all(allMatches.map(d => db.collection('courses').doc(d.ref.parent.parent.id).get()))` 후 zip하여 active 필터. courseId 중복 제거 `Map` 캐시 추가.

**예상 효과**:
다중 매치 학생 로그인 응답 시간 K×30ms → 30ms.

---

### H4. 과정 영구 삭제 시 회차 cascade가 회차당 직렬 처리

**위치**: `admin-courses.js:615-628` `deleteRoundsCascade`

**현재**:
`for (const rd of roundsSnap.docs) { ... await deleteDoc(rd.ref); }` — R개 회차이면 R번 RTT가 직렬. 각 회차 내부 instructors/responses는 `Promise.all` 처리되어 있어 그건 OK이지만 회차 자체 루프가 직렬.

**개선**:
전체 회차의 instructors/responses snapshot을 `Promise.all`로 모은 뒤 단일 `writeBatch`로 분할 커밋 (500 op/batch). 회차 문서 자체도 `Promise.all` 또는 같은 batch에 포함.

**예상 효과**:
회차 10개 삭제 RTT 10+ → 2~3회 batch.

---

## MEDIUM

### M1. 정렬 누락 강사 백필이 매번 트리거됨 (잠재적 쓰기 폭발)

**위치**: `admin-courses.js:778-797`, `admin-rounds.js:304-326`

**현재**:
`loadInstructors` 진입할 때마다 `order undefined`인 doc을 검사하고 `writeBatch`로 백필. 데이터가 마이그레이션된 후에도 매 열람 시 missingOrder 계산이 돌고, 한 번 실패하면 다음 열람 때도 동일 batch가 발생.

**개선**:
백필 성공 후 `lsWrite('migrated:instructors', courseId)` 기록 또는 백필 자체를 일회성 admin 스크립트로 분리. 일반 path에서는 missingOrder 검사만 하고 0이면 즉시 스킵.

---

### M2. attendance 컬렉션 합성 인덱스 누락

**위치**: `attendance/checkin.js:316-321`, `attendance/firestore.indexes.json:2`

**현재**:
`where('studentId','==',uid) AND where('date','==',today) AND where('session','==',session)` 3등호 합성 쿼리. `firestore.indexes.json`의 `indexes` 배열은 `[]`. Firestore가 단일 필드 자동 인덱스만 만들고 합성 쿼리는 첫 실행 시 콘솔에 인덱스 생성 링크를 떨굼. 행정망에서 운영 직전에 발견되면 학생 출석이 막힘.

**개선**:
`attendance` 컬렉션에 `(studentId ASC, date ASC, session ASC)` 합성 인덱스 명시. `admin-attendance.js:1310`의 `where('studentId','==',uid)` 단일 등호는 자동 인덱스로 충분.

**예상 효과**:
첫 운영 배포 시 인덱스 미빌드 장애 사전 차단. 쿼리 응답 일관성.

---

### M3. responses 컬렉션 풀스캔 다발 (선택 삭제·단건 삭제)

**위치**: `admin-students.js:217, 245`

**현재**:
`deleteSelectedStudents`에서 응답 전체 `getDocs(...'responses')` 풀스캔 후 메모리 매칭. 단건 `deleteStudent`는 `where('empNo','==',empNo)`로 좁히긴 함. 응답이 수만 건이 되면 풀스캔 비용이 큼.

**개선**:
응답 문서에 `studentId` 필드를 박고 `where('studentId','in', batchOf10)`로 좁히는 방식. 또는 `where('empNo','in', [...selectedEmpNos])` 10개씩 chunk 후 name 매칭.

**예상 효과**:
응답 1만건/선택 50명 기준 1 풀스캔 → 5 batched 쿼리. 메모리 사용량 감소.

---

### M4. CSS 1개 파일 46KB · 322 선택자 · 데드 룰 가능성

**위치**: `admin.css` (1872줄, 322 클래스 선택자), `admin.html:7-8` (`style.css?v=32`, `admin.css?v=32`)

**현재**:
admin.css는 admin.html과 1:1 매칭이라 attendance/admin-attendance.html에서 쓰지 않음. style.css는 학생용. admin.html 표시되는 화면은 한 번에 하나의 탭(courses/stats/preview)이지만 모든 탭의 스타일이 항상 파싱됨.

**개선**:
PurgeCSS/uncss 등으로 admin.html과 cross-check해 미사용 룰 제거. 최소 minify로 30% 감량 기대. 또한 `admin.css?v=32` 쿼리 캐시는 max-age=300(`firebase.json:37`)이라 매 5분마다 304 검증. JS/CSS는 `immutable` 정책 + 해시드 파일명으로 변경.

**예상 효과**:
admin.css 46KB → 30KB 추정. 304 RTT도 1년 단위로 제거.

---

### M5. CDN 자산 preconnect/preload 누락

**위치**: `admin.html:7-9, 390`, `attendance/admin-attendance.html:190`, `attendance/scan.html:189`

**현재**:
`<head>`에 `<link rel="preconnect" href="https://www.gstatic.com">` 없음. firebase-firestore.js, firebase-auth.js, firebase-functions.js를 ESM에서 `https://www.gstatic.com/firebasejs/12.10.0/...` URL로 동적 import. attendance에서는 html5-qrcode/xlsx CDN도 일반 `<script>`. 행정망에서 DNS+TLS 핸드셰이크가 직렬로 일어남.

**개선**:
각 HTML `<head>` 상단에 추가:
```html
<link rel="preconnect" href="https://www.gstatic.com" crossorigin>
<link rel="dns-prefetch" href="https://firestore.googleapis.com">
<!-- scan/admin-attendance.html은 추가로 -->
<link rel="preload" as="script" href="..xlsx..">
```

**예상 효과**:
첫 RTT 50~150ms 단축 (DNS+TLS 병렬화).

---

## LOW

### L1. attendance/admin-attendance.html은 XLSX를 페이지 진입 즉시 동기 로드

**위치**: `attendance/admin-attendance.html:190`

**현재**:
`<script src="https://cdn.sheetjs.com/xlsx-0.20.0/...">` 한 줄로 즉시 로드. 약 1MB+. admin-excel.js의 `loadXLSX()` (`admin-excel.js:19-28`)는 lazy 패턴인데 attendance 쪽만 즉시.

**개선**:
attendance/admin-attendance.html에서 XLSX `<script>` 제거 후 admin-attendance.js에서도 동일한 `loadXLSX()` lazy 패턴. 사용자가 "엑셀 다운로드"/"엑셀 일괄 등록" 클릭 시 동적 삽입.

**예상 효과**:
출결 관리자 첫 로드 ~1MB 절감.

---

### L2. lsCache(courses) 단일 키 — stats/preview/courses 화면 간 캐시 공유는 좋지만 변경 무효화 누락 케이스

**위치**: `admin-rounds.js:144, 211, 233, 256, 790, 822, 854`

**현재**:
`addRound`, `saveEditRound`, `toggleRoundActive`, `deleteRound`, `addRoundGroup`, `renameRoundGroup`, `deleteRoundGroup` 후 `loadRounds()`만 호출하고 `lsInvalidate('courses')`나 회차 캐시 무효화는 호출하지 않음. stats/preview의 `populateRoundSelect` 결과(`roundsByCourse[courseId]`, `previewRoundsByCourse[courseId]`)도 메모리 캐시라 다른 탭에서 안 보임. 분반 추가 후 stats 탭 진입하면 stale.

**개선**:
회차 mutation 후 `lastPopulatedRoundCourseId = null`, `lastPopulatedPreviewRoundCourseId = null`, `delete roundsByCourse[courseId]` 등 cross-module 무효화 헬퍼.

**예상 효과**:
사용자 혼동 제거 (성능보단 일관성).

---

### L3. computeStats DOM 렌더가 카테고리 평균 재계산 중복

**위치**: `admin-stats.js:387-400, 449-457`

**현재**:
`renderStats` 안에서 `validIdx.reduce`로 카테고리 합계, 그 뒤 다시 `validAvgs`로 전체 평균 — `hasData`/`dists`/`avgs` 같은 동일 데이터를 두 번 순회. n이 작아 비용은 미미하나 `exportResultsExcel`도 같은 계산을 또 함.

**개선**:
`computeStats` 결과에 `categoryAvgs`, `overallAvg`까지 포함시켜 호출자는 읽기만. 동시에 `exportResultsExcel`은 `state.lastComputedStats` 활용 (이미 함).

**예상 효과**:
미미. 가독성 개선 위주.

---

### L4. Functions `maxInstances: 10` (loginByEmail/loginByEmpNo)

**위치**: `attendance/functions/index.js:66, 139, 218, 311`

**현재**:
학생 로그인 류 maxInstances=10. 한 교육과정 30명이 동시 로그인 시 콜드스타트 누적 가능. asia-northeast3 콜드 ~700ms-1.5s. rate_limits 트랜잭션도 IP당이라 같은 사무실 NAT 뒤 학생들이 한 IP로 묶이면 `60s/5건` 제한에 쉽게 부딪힘.

**개선**:
로그인 함수만 `maxInstances: 30` + `minInstances: 1`(워밍업)로 변경. rate-limit 키를 `${ip}_${empNo[0:3]}`처럼 학생 일부 식별자와 결합해 NAT 충돌 완화. App Check가 어뷰즈 1차 방어이므로 rate-limit은 좀 더 관대해도 OK.

**예상 효과**:
동시 입실 시 응답 시간 분산, 단체 로그인 차단 사고 제거.

---

## 우선순위 요약

1. **H1**: 동적 import 도입 (탭별 코드 분할)
2. **H2**: 카운트 비정규화 또는 캐시 TTL 적용
3. **H3**: Functions 직렬 `for-await` → `Promise.all`
4. **H4**: `deleteRoundsCascade` 회차 루프 병렬화
5. **M1**: order 백필 일회성 처리
6. **M2**: attendance 합성 인덱스 명시
7. **M3**: responses 풀스캔을 `where('empNo','in',...)`로 좁힘
8. **M4-M5**: CSS 정리 + preconnect 추가
9. **L1**: attendance/admin-attendance.html XLSX 동기 → lazy
10. **L4**: 학생 로그인 Functions `minInstances` 워밍업

상위 4건만 적용해도 행정망 환경에서 카드 진입 1~2초, 로그인 다중매치 200ms+, 회차 cascade 수초 단축 기대.
