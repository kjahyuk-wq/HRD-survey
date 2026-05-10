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
      throw new HttpsError(
        'not-found',
        '등록된 수강생 정보를 찾을 수 없습니다. 이름과 메일을 확인하거나 담당자에게 문의해 주세요.'
      );
    }

    // 학생 본인 active 여부 + 부모 과정 active 여부 검증
    const validMatches = [];
    let blockedByStudent = 0;
    let blockedByCourse = 0;

    for (const d of allMatches) {
      // 학생 비활성
      if (d.data().active === false) {
        blockedByStudent++;
        continue;
      }
      // 과정 비활성
      const courseId = d.ref.parent.parent.id;
      const courseSnap = await db.collection('courses').doc(courseId).get();
      if (!courseSnap.exists || courseSnap.data().active === false) {
        blockedByCourse++;
        continue;
      }
      validMatches.push(d);
    }

    if (validMatches.length === 0) {
      if (blockedByStudent > 0 && blockedByCourse === 0) {
        throw new HttpsError(
          'failed-precondition',
          '비활성 처리된 계정입니다. 담당자에게 문의해 주세요.'
        );
      }
      throw new HttpsError(
        'failed-precondition',
        '등록된 과정이 모두 종료 처리되었습니다. 담당자에게 문의해 주세요.'
      );
    }

    // 한 사람 = 한 uid (email_hmac 기반)
    const uid = `stu_${emailHmac.substring(0, 28)}`;

    const customToken = await auth.createCustomToken(uid, {
      role: 'student',
      emailHmac,
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
      throw new HttpsError(
        'not-found',
        '등록된 수강생 정보를 찾을 수 없습니다. 이름과 교번을 확인하거나 담당자에게 문의해 주세요.'
      );
    }

    // 메일이 등록된 학생은 이름+교번 로그인 차단 — 메일 로그인 강제
    const noEmailMatches = nameMatches.filter((d) => !d.data().email_hmac);
    if (noEmailMatches.length === 0) {
      throw new HttpsError(
        'failed-precondition',
        '이 계정은 등록된 메일로 로그인해 주세요.'
      );
    }

    // 학생 + 부모 과정 active 검증
    const validMatches = [];
    let blockedByStudent = 0;
    let blockedByCourse = 0;

    for (const d of noEmailMatches) {
      if (d.data().active === false) {
        blockedByStudent++;
        continue;
      }
      const courseId = d.ref.parent.parent.id;
      const courseSnap = await db.collection('courses').doc(courseId).get();
      if (!courseSnap.exists || courseSnap.data().active === false) {
        blockedByCourse++;
        continue;
      }
      validMatches.push(d);
    }

    if (validMatches.length === 0) {
      if (blockedByStudent > 0 && blockedByCourse === 0) {
        throw new HttpsError('failed-precondition', '비활성 처리된 계정입니다. 담당자에게 문의해 주세요.');
      }
      throw new HttpsError('failed-precondition', '등록된 과정이 모두 종료 처리되었습니다. 담당자에게 문의해 주세요.');
    }

    // uid: 이름+교번 해시 기반 (메일 hmac 와 충돌 회피)
    const idHash = crypto
      .createHash('sha256')
      .update(`empno|${empNo}|${name}`)
      .digest('hex');
    const uid = `stu_${idHash.substring(0, 28)}`;

    const customToken = await auth.createCustomToken(uid, {
      role: 'student',
      loginType: 'empno',
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
