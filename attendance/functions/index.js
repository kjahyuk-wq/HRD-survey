const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
const auth = getAuth();

const EMAIL_PEPPER = defineSecret('EMAIL_PEPPER');

const REGION = 'asia-northeast3';
const ADMIN_EMAILS = ['kjahyuk@korea.kr'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// 로그인 실패 시 enumeration(등록 여부·비활성·과정 종료 구분 누설) 방지를 위해
// 미등록/비활성/과정종료 모두 동일 메시지 + 동일 code 로 응답한다.
const LOGIN_FAIL_MSG =
  '로그인할 수 있는 등록 정보가 없습니다. 정보를 다시 확인하시거나 담당자에게 문의해 주세요.';

// 에뮬레이터에서는 App Check 강제를 우회 (테스트 편의)
const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';
const ENFORCE_APP_CHECK = !IS_EMULATOR;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hmacEmail(email, pepper) {
  return crypto
    .createHmac('sha256', pepper)
    .update(normalizeEmail(email))
    .digest('hex');
}

async function enforceRateLimit(key, { windowMs, max }) {
  const ref = db.collection('rate_limits').doc(key);
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || now - (snap.data().windowStart || 0) > windowMs) {
      tx.set(ref, { count: 1, windowStart: now });
      return;
    }
    const data = snap.data();
    if ((data.count || 0) >= max) {
      throw new HttpsError('resource-exhausted', '잠시 후 다시 시도해 주세요.');
    }
    tx.update(ref, { count: FieldValue.increment(1) });
  });
}

function isAdmin(authCtx) {
  return !!(authCtx && authCtx.token && ADMIN_EMAILS.includes(authCtx.token.email));
}

// ── 학생 메일 로그인 ─────────────────────────────────────
exports.loginByEmail = onCall(
  {
    region: REGION,
    secrets: [EMAIL_PEPPER],
    enforceAppCheck: ENFORCE_APP_CHECK,
    maxInstances: 10,
  },
  async (request) => {
    const name = String(request.data?.name || '').trim();
    const email = normalizeEmail(request.data?.email);

    if (!name) {
      throw new HttpsError('invalid-argument', '이름을 입력해 주세요.');
    }
    if (!EMAIL_RE.test(email)) {
      throw new HttpsError('invalid-argument', '메일 형식이 올바르지 않습니다.');
    }

    const ip = request.rawRequest?.ip || 'unknown';
    await enforceRateLimit(`login_${ip}`, { windowMs: 60_000, max: 5 });

    const emailHmac = hmacEmail(email, EMAIL_PEPPER.value());

    const snap = await db
      .collectionGroup('attendance_students')
      .where('email_hmac', '==', emailHmac)
      .get();

    const allMatches = snap.docs.filter((d) => d.data().name === name);

    if (allMatches.length === 0) {
      throw new HttpsError('not-found', LOGIN_FAIL_MSG);
    }

    // 학생 본인 active 여부 + 부모 과정 active 여부 검증
    const validMatches = [];

    for (const d of allMatches) {
      if (d.data().active === false) continue;
      const courseId = d.ref.parent.parent.id;
      const courseSnap = await db.collection('courses').doc(courseId).get();
      if (!courseSnap.exists || courseSnap.data().active === false) continue;
      validMatches.push(d);
    }

    if (validMatches.length === 0) {
      throw new HttpsError('not-found', LOGIN_FAIL_MSG);
    }

    // 한 사람 = 한 uid (email_hmac 기반)
    const uid = `stu_${emailHmac.substring(0, 28)}`;

    // 본인 명의의 empNo 목록 (rules의 qr_tokens/reset_ 본인성 검증용)
    const empNos = [
      ...new Set(validMatches.map((d) => d.data().empNo).filter(Boolean)),
    ];

    const customToken = await auth.createCustomToken(uid, {
      role: 'student',
      emailHmac,
      empNos,
    });

    const candidates = validMatches.map((d) => ({
      courseId: d.ref.parent.parent.id,
      studentDocId: d.id,
      empNo: d.data().empNo || '',
    }));

    return { customToken, candidates };
  }
);

// ── 학생 이름+교번 로그인 (공무직 등 메일 없는 학생) ─────
exports.loginByEmpNo = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    maxInstances: 10,
  },
  async (request) => {
    const name = String(request.data?.name || '').trim();
    const empNo = String(request.data?.empNo || '').trim();

    if (!name) {
      throw new HttpsError('invalid-argument', '이름을 입력해 주세요.');
    }
    if (!empNo) {
      throw new HttpsError('invalid-argument', '교번을 입력해 주세요.');
    }

    const ip = request.rawRequest?.ip || 'unknown';
    await enforceRateLimit(`login_${ip}`, { windowMs: 60_000, max: 5 });

    const snap = await db
      .collectionGroup('attendance_students')
      .where('empNo', '==', empNo)
      .get();

    const nameMatches = snap.docs.filter((d) => d.data().name === name);

    if (nameMatches.length === 0) {
      throw new HttpsError('not-found', LOGIN_FAIL_MSG);
    }

    // 메일이 있든 없든 이름+교번 로그인 허용. 같은 이름+교번이 여러 과정에 있으면 다음 화면에서 선택.
    // 학생 + 부모 과정 active 검증
    const validMatches = [];

    for (const d of nameMatches) {
      if (d.data().active === false) continue;
      const courseId = d.ref.parent.parent.id;
      const courseSnap = await db.collection('courses').doc(courseId).get();
      if (!courseSnap.exists || courseSnap.data().active === false) continue;
      validMatches.push(d);
    }

    if (validMatches.length === 0) {
      throw new HttpsError('not-found', LOGIN_FAIL_MSG);
    }

    // uid 결정 — 학생 doc 의 email_hmac 우선, 없으면 (이름+교번) 해시.
    // 한 학생 = 한 uid 유지 (메일 로그인과 교번 로그인이 동일 uid 발급).
    const firstWithMail = validMatches.find((d) => d.data().email_hmac);
    let uid;
    if (firstWithMail) {
      uid = `stu_${firstWithMail.data().email_hmac.substring(0, 28)}`;
    } else {
      const idHash = crypto
        .createHash('sha256')
        .update(`empno|${empNo}|${name}`)
        .digest('hex');
      uid = `stu_${idHash.substring(0, 28)}`;
    }

    const customToken = await auth.createCustomToken(uid, {
      role: 'student',
      loginType: 'empno',
      empNos: [empNo],
    });

    const candidates = validMatches.map((d) => ({
      courseId: d.ref.parent.parent.id,
      studentDocId: d.id,
      empNo: d.data().empNo || '',
    }));

    return { customToken, candidates };
  }
);

// ── 관리자: 출결용 학생 일괄 등록 (메일 평문 → HMAC 후 폐기) ───
exports.registerAttendanceStudents = onCall(
  {
    region: REGION,
    secrets: [EMAIL_PEPPER],
    enforceAppCheck: ENFORCE_APP_CHECK,
    maxInstances: 5,
  },
  async (request) => {
    if (!isAdmin(request.auth)) {
      throw new HttpsError('permission-denied', '관리자 권한이 필요합니다.');
    }

    const courseId = String(request.data?.courseId || '').trim();
    const students = Array.isArray(request.data?.students) ? request.data.students : null;

    if (!courseId || !students) {
      throw new HttpsError('invalid-argument', 'courseId와 students 배열이 필요합니다.');
    }
    if (students.length === 0) {
      throw new HttpsError('invalid-argument', '등록할 학생이 없습니다.');
    }
    if (students.length > 500) {
      throw new HttpsError('invalid-argument', '한 번에 500명까지 등록할 수 있습니다.');
    }

    const pepper = EMAIL_PEPPER.value();
    const courseRef = db.collection('courses').doc(courseId);

    // 중복 메일 검사 (같은 과정 내)
    const existing = await courseRef.collection('attendance_students').get();
    const existingHmacs = new Set(existing.docs.map((d) => d.data().email_hmac));

    const batch = db.batch();
    const errors = [];
    let added = 0;

    // 기존 (이름+교번) 조합 (메일 없는 학생) 도 중복 검사
    const existingNoEmailKeys = new Set(
      existing.docs
        .filter((d) => !d.data().email_hmac)
        .map((d) => `${d.data().name}|${d.data().empNo}`)
    );

    students.forEach((s, idx) => {
      const name = String(s?.name || '').trim();
      const empNo = String(s?.empNo || '').trim();
      const email = normalizeEmail(s?.email);

      if (!name || !empNo) {
        errors.push({ idx, reason: '이름/교번 누락' });
        return;
      }

      const docData = {
        name,
        empNo,
        active: true,
        createdAt: FieldValue.serverTimestamp(),
      };

      if (email) {
        if (!EMAIL_RE.test(email)) {
          errors.push({ idx, reason: '메일 형식 오류', name });
          return;
        }
        const emailHmac = hmacEmail(email, pepper);
        if (existingHmacs.has(emailHmac)) {
          errors.push({ idx, reason: '이미 등록된 메일', name });
          return;
        }
        existingHmacs.add(emailHmac);
        docData.email_hmac = emailHmac;
      } else {
        const key = `${name}|${empNo}`;
        if (existingNoEmailKeys.has(key)) {
          errors.push({ idx, reason: '이미 등록된 이름+교번 (메일 없음)', name });
          return;
        }
        existingNoEmailKeys.add(key);
      }

      const docRef = courseRef.collection('attendance_students').doc();
      batch.set(docRef, docData);
      added++;
    });

    if (added > 0) await batch.commit();

    // 메일 평문은 이 함수 스코프를 벗어나는 순간 GC 됨 (절대 저장 X)
    return { added, errors };
  }
);

// ── 만족도 응답 제출 (단기 + 회차 통합) ─────────────────
// 학생 직접 쓰기를 차단하고 서버에서 본인성/중복 검증 + 트랜잭션 처리.
// rules 의 students.update / responses.create 가 admin only 로 잠긴 뒤로 이 함수만 통과 경로.
exports.submitSurveyResponse = onCall(
  {
    region: REGION,
    enforceAppCheck: ENFORCE_APP_CHECK,
    maxInstances: 10,
  },
  async (request) => {
    const data = request.data || {};
    const name = String(data.name || '').trim();
    const empNo = String(data.empNo || '').trim();
    const courseId = String(data.courseId || '').trim();
    const roundId = data.roundId ? String(data.roundId).trim() : '';
    const response = data.response;

    if (!name || name.length > 50) {
      throw new HttpsError('invalid-argument', '이름이 올바르지 않습니다.');
    }
    if (!empNo || empNo.length > 20) {
      throw new HttpsError('invalid-argument', '교번이 올바르지 않습니다.');
    }
    if (!courseId || courseId.length > 100) {
      throw new HttpsError('invalid-argument', 'courseId가 올바르지 않습니다.');
    }
    if (!response || typeof response !== 'object') {
      throw new HttpsError('invalid-argument', '응답 데이터가 없습니다.');
    }

    const ip = request.rawRequest?.ip || 'unknown';
    await enforceRateLimit(`submit_${ip}`, { windowMs: 60_000, max: 10 });

    // 응답 필드 검증
    for (let i = 1; i <= 9; i++) {
      const v = response[`q${i}`];
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        throw new HttpsError('invalid-argument', `q${i} 값이 올바르지 않습니다.`);
      }
    }
    for (let i = 11; i <= 16; i++) {
      const v = response[`q${i}`];
      if (typeof v !== 'string' || v.length > 50) {
        throw new HttpsError('invalid-argument', `q${i} 값이 올바르지 않습니다.`);
      }
    }
    if (!response.instructors || typeof response.instructors !== 'object') {
      throw new HttpsError('invalid-argument', '강사 평가가 없습니다.');
    }
    for (const [k, v] of Object.entries(response.instructors)) {
      if (typeof k !== 'string' || k.length > 200) {
        throw new HttpsError('invalid-argument', '강사 키가 올바르지 않습니다.');
      }
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        throw new HttpsError('invalid-argument', '강사 평가 값이 올바르지 않습니다.');
      }
    }
    const checkLen = (field, max) => {
      const v = response[field];
      if (v == null || v === '') return;
      if (typeof v !== 'string' || v.length > max) {
        throw new HttpsError('invalid-argument', `${field} 가 올바르지 않습니다.`);
      }
    };
    checkLen('q10_comment', 1000);
    checkLen('comment1', 2000);
    checkLen('comment2', 2000);
    checkLen('comment3', 2000);

    // 과정 검증
    const courseRef = db.collection('courses').doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists) {
      throw new HttpsError('not-found', '과정을 찾을 수 없습니다.');
    }
    const courseData = courseSnap.data();
    if (courseData.active === false) {
      throw new HttpsError('failed-precondition', '비활성 과정입니다.');
    }
    const isLeadership = courseData.type === 'leadership';

    // 학생 매칭 (해당 과정 내에서만 — collectionGroup 우회 차단)
    const studentsSnap = await courseRef
      .collection('students')
      .where('empNo', '==', empNo)
      .get();
    const matches = studentsSnap.docs.filter((d) => d.data().name === name);
    if (matches.length === 0) {
      throw new HttpsError('not-found', '등록된 수강생을 찾을 수 없습니다.');
    }
    if (matches.length > 1) {
      throw new HttpsError(
        'failed-precondition',
        '동명이인 수강생이 있어 자동 매칭이 어렵습니다. 담당자에게 문의해 주세요.'
      );
    }
    const studentRef = matches[0].ref;

    // 회차 검증 (leadership)
    let roundData = null;
    if (isLeadership) {
      if (!roundId || roundId.length > 100) {
        throw new HttpsError('invalid-argument', '회차 정보가 필요합니다.');
      }
      const roundSnap = await courseRef.collection('rounds').doc(roundId).get();
      if (!roundSnap.exists) {
        throw new HttpsError('not-found', '회차를 찾을 수 없습니다.');
      }
      roundData = roundSnap.data();
      if (roundData.active === false) {
        throw new HttpsError('failed-precondition', '비활성 회차입니다.');
      }
    } else if (roundId) {
      throw new HttpsError('invalid-argument', '단기과정은 회차 정보가 없어야 합니다.');
    }

    // 응답 본문 — 클라이언트 입력에서 받되 name/empNo/course 는 서버 신뢰 값으로 강제
    const respBase = {
      name,
      empNo,
      course: String(courseData.name || ''),
      q1: response.q1, q2: response.q2, q3: response.q3, q4: response.q4, q5: response.q5,
      q6: response.q6, q7: response.q7, q8: response.q8, q9: response.q9,
      q10_comment: typeof response.q10_comment === 'string' ? response.q10_comment : '',
      q11: response.q11, q12: response.q12, q13: response.q13,
      q14: response.q14, q15: response.q15, q16: response.q16,
      instructors: response.instructors,
      comment1: typeof response.comment1 === 'string' ? response.comment1 : '',
      comment2: typeof response.comment2 === 'string' ? response.comment2 : '',
      comment3: typeof response.comment3 === 'string' ? response.comment3 : '',
      submittedAt: FieldValue.serverTimestamp(),
    };

    if (isLeadership) {
      respBase.roundNumber = roundData.number;
      respBase.roundName = roundData.name || '';
      if (typeof response.groupName === 'string' && response.groupName.length > 0
          && response.groupName.length <= 50) {
        respBase.groupName = response.groupName;
      }
    }

    // 트랜잭션: 학생 doc 최신 상태 확인 후 응답 생성 + 완료 마킹
    const responseCol = isLeadership
      ? courseRef.collection('rounds').doc(roundId).collection('responses')
      : courseRef.collection('responses');
    const newResponseRef = responseCol.doc();

    await db.runTransaction(async (tx) => {
      const freshStudent = await tx.get(studentRef);
      if (!freshStudent.exists) {
        throw new HttpsError('not-found', '수강생 정보가 사라졌습니다.');
      }
      const freshData = freshStudent.data();
      if (isLeadership) {
        const completed = Array.isArray(freshData.completedRounds)
          ? freshData.completedRounds
          : [];
        if (completed.includes(roundId)) {
          throw new HttpsError('already-exists', '이미 응답하신 회차입니다.');
        }
        tx.set(newResponseRef, respBase);
        tx.update(studentRef, {
          completedRounds: FieldValue.arrayUnion(roundId),
          completedAt: FieldValue.serverTimestamp(),
        });
      } else {
        if (freshData.completed === true) {
          throw new HttpsError('already-exists', '이미 응답하셨습니다.');
        }
        tx.set(newResponseRef, respBase);
        tx.update(studentRef, {
          completed: true,
          completedAt: FieldValue.serverTimestamp(),
        });
      }
    });

    return { ok: true };
  }
);

// ── 관리자: 출결용 학생 단건 등록 ─────────────────────
exports.registerAttendanceStudent = onCall(
  {
    region: REGION,
    secrets: [EMAIL_PEPPER],
    enforceAppCheck: ENFORCE_APP_CHECK,
    maxInstances: 5,
  },
  async (request) => {
    if (!isAdmin(request.auth)) {
      throw new HttpsError('permission-denied', '관리자 권한이 필요합니다.');
    }

    const courseId = String(request.data?.courseId || '').trim();
    const name = String(request.data?.name || '').trim();
    const empNo = String(request.data?.empNo || '').trim();
    const email = normalizeEmail(request.data?.email);

    if (!courseId || !name || !empNo) {
      throw new HttpsError('invalid-argument', '이름과 교번을 입력해 주세요.');
    }

    const courseRef = db.collection('courses').doc(courseId);
    const docData = {
      name,
      empNo,
      active: true,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (email) {
      if (!EMAIL_RE.test(email)) {
        throw new HttpsError('invalid-argument', '메일 형식이 올바르지 않습니다.');
      }
      const pepper = EMAIL_PEPPER.value();
      const emailHmac = hmacEmail(email, pepper);

      const dup = await courseRef
        .collection('attendance_students')
        .where('email_hmac', '==', emailHmac)
        .limit(1)
        .get();
      if (!dup.empty) {
        throw new HttpsError('already-exists', '같은 과정에 이미 등록된 메일입니다.');
      }
      docData.email_hmac = emailHmac;
    } else {
      // 메일 없는 학생 — 이름+교번 중복 검사
      const dupSnap = await courseRef
        .collection('attendance_students')
        .where('empNo', '==', empNo)
        .get();
      const collision = dupSnap.docs.find(
        (d) => d.data().name === name && !d.data().email_hmac
      );
      if (collision) {
        throw new HttpsError(
          'already-exists',
          '같은 과정에 이미 등록된 이름+교번 입니다 (메일 없음).'
        );
      }
    }

    const docRef = await courseRef.collection('attendance_students').add(docData);
    return { id: docRef.id };
  }
);
