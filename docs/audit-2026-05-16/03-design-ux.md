# 디자인·UX·접근성 감사 — 상세

**감사일**: 2026-05-16
**감사 범위**: `admin.html`/`admin.css`, `index.html`/`style.css`, `attendance/checkin.html`, `attendance/scan.html`, `attendance/admin-attendance.html`, `attendance/attendance.css`

---

## HIGH — 사용자 영향도 큼

### 1. 키보드 포커스 인디케이터 전면 제거 — WCAG 2.4.7 위반

**위치**: `admin.css:114, 321, 364, 381, 403, 678, 828, 1027, 1070`, `style.css:55, 337` 등 전역 `outline: none` 후 `:focus`에 `border-color`만 부여

**현재**:
모든 입력에 `outline:none`을 두고 `border-color`만 바꿈. `:focus-visible` 미사용. radio/checkbox(`display:none`)와 `rating-btn`엔 포커스 표시가 아예 없음.

**개선**:
라디오(rating/choice) 시각 대용에 `:focus-within` 링 추가, 키보드 사용자가 어디 있는지 식별 가능하게.
```css
.rating-label input:focus-visible + .rating-btn,
.choice-label input:focus-visible + .choice-btn {
  outline: 3px solid #1d4ed8;
  outline-offset: 2px;
}
*:focus-visible { outline: 3px solid #1d4ed8; outline-offset: 2px; }
```

**영향**:
키보드/스위치 사용자, 시각장애 사용자, 행정망 PC 환경(마우스 비활성 상황)에서 입력 위치 인지 불가.

---

### 2. 폼 라벨이 input과 프로그래밍적으로 연결되지 않음

**위치**: `index.html:21, 24` (`<label>이름</label><input id="input-name">`), `attendance/checkin.html:82-87, 107-112`, `attendance/admin-attendance.html:112`

**현재**:
label에 `for`가 없고 input에 `id`는 있지만 연결이 안 됨. 스크린리더가 "편집창, 이름 없음"으로 읽음. 관리자 비밀번호 입력(`admin.html:17`)은 label 자체가 없음.

**개선**:
```html
<label for="input-name">이름</label>
<input id="input-name" type="text" ...>
<!-- admin.html pw-input은 -->
<label for="pw-input" class="sr-only">관리자 비밀번호</label>
```

**영향**:
보이스오버/내레이터 사용자 로그인 불가. 공공기관 서비스 의무 사항(웹접근성 인증 마크 대상).

---

### 3. 키오스크(scan.html) 결과 메시지의 대비/지속시간이 거리 사용 환경에 부적합

**위치**: `attendance/scan.html:73-74, 84-91`

**현재**:
결과 카드 `.scan-result-text`가 1.6rem(약 26px). 강의실 문 앞에서 1~2m 거리에서 보기엔 작음. 또 success 박스는 `#052e16` 배경에 흰 글씨로 명료하나, sub 텍스트 `#cbd5e1`는 어두운 카드 대비 충분히 가독되지 않음. 카메라 전환 UI도 opacity 0.45로 운영자도 못 찾을 수준.

**개선**:
결과 메시지 최소 2rem, sub는 `#e2e8f0` 이상. 자동 닫힘 타이밍이 코드에 있다면 3~4초 보장(거리에서 학생이 읽을 시간).
```css
.scan-result-text { font-size: 2.2rem; }
.scan-result-sub { font-size: 1.15rem; color: #e2e8f0; }
.camera-switch { opacity: 0.7; }
```

**영향**:
키오스크가 "사실상 시인 불가" 상태로 출결 분쟁 유발. 가장 자주 사용되는 화면.

---

### 4. 학생 별점/선택 버튼이 라디오인데 시각상 버튼처럼 보임 + 키보드 미동작

**위치**: `index.html:94, 207-213`, `style.css:288-327, 417-439`

**현재**:
`input[type="radio"] { display: none; }`이라 키보드 Tab 진입은 되지만 화살표키 이동/선택은 라벨 시각이 안 바뀌어 보이지 않음. 포커스 링도 위 1번과 같이 없음.

**개선**:
`display:none` 대신 시각적으로 숨기되 포커스 가능하게:
```css
.rating-label input[type="radio"] {
  position: absolute; opacity: 0; pointer-events: none;
}
```
+ 포커스 스타일(1번 참고). 라디오 그룹에 `role="radiogroup"`과 `aria-label`("Q1 응답") 추가 권장.

**영향**:
휴대폰 외장 키보드, 행정망 PC, 모터 장애 사용자.

---

## MEDIUM — 주요 UX/디자인 일관성

### 5. 디자인 토큰(색·간격) 미정의 — 청색/회색/보라 값이 하드코딩 산발

**위치**: 전 CSS. 예: 동일한 brand blue가 `#0066cc`(admin.css:120 등)와 `#003d99`(admin.css:5, 1163)로 혼재, gray가 `#888`/`#94a3b8`/`#9ca3af`/`#aaa`/`#bbb`/`#64748b`로 6종 사용(`admin.css:160, 231, 387, 539, 561, 645, 810` 등).

**현재**:
다크/라이트 전환, 일괄 테마 변경 불가. PR마다 새 hex가 추가됨.

**개선**:
`:root` 변수 도입.
```css
:root {
  --brand-700:#003d99; --brand-500:#0066cc; --brand-50:#eff6ff;
  --gray-500:#64748b; --gray-400:#94a3b8; --gray-300:#cbd5e1;
  --danger:#dc2626; --success:#15803d; --warn:#d97706;
  --space-1:.25rem; --space-2:.5rem; --space-3:.8rem; --radius-md:10px;
}
```

**영향**:
유지보수 비용↑, 컬러 불일치(예: `#888`과 `#94a3b8` 혼용으로 카드 라벨 톤이 화면마다 달라 보임).

---

### 6. 키오스크 외 viewport에 `maximum-scale=1.0` 잔존 — 핀치 줌 차단

**위치**: `attendance/checkin.html:5`

**현재**:
`maximum-scale=1.0`은 학생 본인 핀치 줌을 막아 WCAG 1.4.4 위반. iOS Safari는 무시하지만 안드로이드 Chrome은 차단.

**개선**:
`<meta name="viewport" content="width=device-width, initial-scale=1.0">`로 정리. scan.html처럼 키오스크에서는 `user-scalable=no`가 의미있지만, 학생 체크인 페이지는 일반 모바일 사용자라 줌 허용 필수.

**영향**:
시각약자(저시력) — checkin.html은 학생용 핵심 진입점.

---

### 7. 학생 페이지 회차 선택 버튼·돌아가기 버튼의 터치 타깃 일관성 부족

**위치**: `admin.css:1442-1452`(모바일 36px 보장), `style.css:189-198`(회차 버튼은 OK), 그러나 `admin.css:769-781` `.goto-btn`은 데스크톱 `padding 0.3rem 0.7rem`로 약 28px 높이, 모바일에서도 `0.28rem 0.55rem`(약 26px) → 44×44px 권고 미달

**현재**:
관리자 과정 카드 액션(`미리보기`/`설문결과`) 가 모바일에서 양옆 간격이 좁고 작아 잘못 누름.

**개선**:
```css
.goto-btn { min-height: 36px; padding: .42rem .85rem; }
@media(max-width:600px){ .goto-btn { min-height: 40px; padding: .5rem .8rem; font-size:.8rem; } }
```

**영향**:
행정망 PC에선 OK지만, 외근 중 모바일 사용 관리자 오탭 빈도.

---

### 8. 빈 상태/에러/로딩 톤이 화면마다 달라 일관성 깨짐

**위치**: `admin.html:71, 73, 98, 99, 100`, `index.html:294` (`⚠️ 모든 문항에 응답해 주세요.`), `checkin.html:117-119` (`⚠️ ...담당자에게 문의...`), `attendance.css:389` (`.loading` 단순 텍스트)

**현재**:
로딩은 "불러오는 중...", "통계를 불러오는 중...", "관리자 인증" 등 표현·아이콘·배경이 매번 다름. 스켈레톤 UI 없음. 에러도 빨강 배너/이모지/일반 텍스트가 섞임.

**개선**:
공통 컴포넌트화 — `.state-empty`/`.state-loading`/`.state-error` 클래스로 통일, 같은 아이콘 패턴과 톤 사용. 큰 작업(과정 통계 로딩)엔 skeleton bar 추가.

**영향**:
시스템 신뢰성/완성도 인상 저하. 특히 관리자가 다수 화면을 전환 사용하므로 두드러짐.

---

### 9. 다크 모드/사용자 색 선호 미지원

**위치**: 전 CSS 파일 — `prefers-color-scheme` 매치 없음

**현재**:
행정망 PC는 다크 모드 거의 없으나, 학생 모바일은 시스템 다크 모드 사용자가 다수. 흰 카드(`#fff`) + `#222` 텍스트 강제로 야간 사용 시 눈부심.

**개선**:
최소한의 다크 토큰 대응(전체 재설계 불필요):
```css
@media (prefers-color-scheme: dark) {
  body { background:#0f172a; color:#e2e8f0; }
  .q-card, .confirm-card { background:#1e293b; color:#e2e8f0; box-shadow:none; }
  .rating-btn { background:#0f172a; color:#cbd5e1; border-color:#334155; }
}
```

**영향**:
학생 야간 응답 환경 가독성.

---

## LOW — 코드 품질·디테일

### 10. `!important` 남발과 전역 `button { width:100% }` 패턴

**위치**: `admin.css:268-291` (`.icon-refresh-btn` 13개 `!important`), `admin.css:837-838, 1459, 1469, 1486`

**현재**:
`style.css:354-373`의 전역 `button { width:100%; box-shadow:... }`를 깨려고 admin 측에서 모든 작은 버튼에 `width:auto; box-shadow:none; transform:none` 반복(`admin.css:467-481, 691-712, 715-766, 769-781, 1095-1109` 등).

**개선**:
전역 `button` 스타일을 `.btn-primary-cta` 같은 단일 클래스로 좁히고, 작은 버튼은 그대로 두기.
```css
/* style.css */
.cta-btn { display:block; width:100%; padding:1rem; ... }
/* 그리고 index.html의 큰 버튼만 class="cta-btn" */
```

**영향**:
향후 새 버튼 추가 시 또 `!important` 추가하게 됨. 빌드 사이즈/리뷰 비용↑.

---

### 11. 의미 없는 `<a href="#">`로 동작 버튼 표현

**위치**: `attendance/checkin.html:92, 122`

**현재**:
`<a href="#" onclick="event.preventDefault();showEmpNoLogin();">`. 스크린리더는 "링크"로 읽고, 새 탭 열기 시도 가능. 키보드 Enter는 작동하지만 Space 미작동.

**개선**:
`<button type="button" class="link-btn" onclick="...">` + 시각 스타일은 그대로(언더라인 텍스트).

**영향**:
보조기기 라벨 오인. 인라인 스타일도 같이 정리 가능.

---

## 권장 진행 순서

1. **(HIGH 1·4) `:focus-visible` 글로벌 추가 + 라디오 시각 숨김 방식 교체** — 1시간 작업, 접근성 점수 즉시 상승
2. **(HIGH 2) 모든 폼 `<label for>` 연결** + admin pw-input에 sr-only label — 30분
3. **(HIGH 3) 키오스크 결과 카드 폰트 키우기**·카메라 스위치 opacity 상향 — 15분
4. **(MED 5) `:root` 변수로 brand/gray 토큰 통합** — 2시간(나중 다크모드 9번까지 같이)
5. **(MED 6) checkin.html viewport `maximum-scale=1.0` 제거** — 1분
6. **(LOW 10) 전역 `button` 클래스화** — 다음 리팩터 PR

긴급도 기준으로 1~3번은 사용자 직접 영향이 즉시 발생하므로 다음 PR에 포함 권장.
