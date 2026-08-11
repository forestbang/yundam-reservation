// ============================================================
// 예약 생성 / 조회 / 취소 / 자동 배정 / 중복 예약 방지 로직
// 데이터 구조:
//   reservations/{id}          예약 기록
//   tableBookingIndex/{date}   그날 테이블별 사용중인 30분 슬롯 (충돌 방지용 잠금)
//   counters/{date}            그날 예약번호 순번
// ============================================================

// 특정 날짜의 테이블 사용 현황(잠금 인덱스) 가져오기
async function getBookingIndex(date) {
  const snap = await db.ref(`tableBookingIndex/${date}`).get();
  return snap.val() || {};
}

// 인원수에 맞는 예약 가능 시간 목록 계산
async function getAvailableTimesForParty(date, partySize) {
  const groups = candidateGroupsForParty(partySize);
  if (groups.length === 0) return [];
  const idx = await getBookingIndex(date);
  const slots = generateTimeSlots();
  return slots.filter((slot) => {
    const needed = neededSlots(slot);
    return groups.some((g) => isGroupFree(idx, g, needed));
  });
}

async function nextSequence(date) {
  const ref = db.ref(`counters/${date}`);
  const result = await ref.transaction((cur) => (cur || 0) + 1);
  return result.snapshot.val();
}

// 특정 테이블 조합의 특정 슬롯을 원자적으로 잠근다 (동시 예약 충돌 방지)
async function tryLockGroup(date, group, needed, reservationId) {
  const idxRef = db.ref(`tableBookingIndex/${date}`);
  const result = await idxRef.transaction((current) => {
    current = current || {};
    for (const t of group) {
      const tSlots = current[t] || {};
      for (const s of needed) {
        if (tSlots[s]) return; // 이미 사용중 -> 트랜잭션 중단(충돌)
      }
    }
    for (const t of group) {
      if (!current[t]) current[t] = {};
      for (const s of needed) current[t][s] = reservationId;
    }
    return current;
  });
  return result.committed;
}

async function releaseGroupSlots(date, group, needed) {
  const idxRef = db.ref(`tableBookingIndex/${date}`);
  await idxRef.transaction((current) => {
    if (!current) return current;
    for (const t of group) {
      if (current[t]) {
        for (const s of needed) delete current[t][s];
        if (Object.keys(current[t]).length === 0) delete current[t];
      }
    }
    return current;
  });
}

// 공통 예약 생성 로직 (자동배정 그룹 후보를 순서대로 시도)
async function attemptReservation({ date, startTime, partySize, name, phone, note, source, forcedGroup }) {
  const dateCheck = isDateBookable(date);
  if (!dateCheck.ok && source === "online") return { success: false, message: dateCheck.reason };

  if (!isValidName(name)) return { success: false, message: "예약자명은 2글자 이상 입력해 주세요." };
  if (!isValidPhone(phone)) return { success: false, message: "전화번호를 정확히 입력해 주세요." };

  const needed = neededSlots(startTime);
  const endTime = minToTime(timeToMin(startTime) + BUSINESS.duration);
  const groups = forcedGroup ? [forcedGroup] : candidateGroupsForParty(partySize);
  if (groups.length === 0) {
    return { success: false, message: "5명 이상은 온라인/자동배정이 불가합니다. 관리자가 테이블을 직접 지정해 주세요." };
  }

  const reservationRef = db.ref("reservations").push();
  const reservationId = reservationRef.key;

  for (const group of groups) {
    const ok = await tryLockGroup(date, group, needed, reservationId);
    if (ok) {
      try {
        const seq = await nextSequence(date);
        const reservationNumber = generateReservationNumber(date, seq);
        await reservationRef.set({
          reservationNumber,
          date,
          startTime,
          endTime,
          partySize,
          customerName: name.trim(),
          phone: phone.trim(),
          note: note ? note.trim() : "",
          tableIds: group,
          status: "예약",
          source: source || "online",
          createdAt: firebase.database.ServerValue.TIMESTAMP,
        });
        return { success: true, reservationNumber, tableIds: group, reservationId, date, startTime, endTime, partySize, name };
      } catch (e) {
        // 예약 기록 저장에 실패하면 잠갔던 자리를 즉시 반납한다 (유령 잠금 방지)
        await releaseGroupSlots(date, group, needed);
        return { success: false, message: "예약 처리 중 오류가 발생했습니다. 다시 시도해 주세요." };
      }
    }
  }
  return { success: false, message: "선택하신 시간에 예약 가능한 자리가 없습니다. 다른 시간을 선택해 주세요." };
}

function generateReservationNumber(dateStr, seq) {
  return `R${dateStr.replace(/-/g, "")}-${String(seq).padStart(3, "0")}`;
}

// 상태 변경 (관리자 화면에서 사용). 완료/취소/노쇼가 되면 테이블을 즉시 반납(잠금 해제)한다.
async function changeReservationStatus(reservationId, newStatus) {
  const snap = await db.ref(`reservations/${reservationId}`).get();
  const r = snap.val();
  if (!r) return { success: false, message: "예약 정보를 찾을 수 없습니다." };
  const prevStatus = r.status; // 변경 전 상태를 먼저 저장해둔다 (덮어쓰기 전에)
  await db.ref(`reservations/${reservationId}/status`).set(newStatus);
  if (CLOSED_STATUSES.includes(newStatus) && !CLOSED_STATUSES.includes(prevStatus)) {
    const needed = neededSlots(r.startTime);
    await releaseGroupSlots(r.date, r.tableIds || [], needed);
  }
  return { success: true };
}

// 예약번호 + 전화번호로 조회 (고객용)
async function findReservationByNumberAndPhone(reservationNumber, phone) {
  const snap = await db.ref("reservations")
    .orderByChild("reservationNumber")
    .equalTo(reservationNumber.trim())
    .get();
  if (!snap.exists()) return null;
  let found = null;
  snap.forEach((child) => {
    const val = child.val();
    if ((val.phone || "").replace(/[^0-9]/g, "") === (phone || "").replace(/[^0-9]/g, "")) {
      found = { id: child.key, ...val };
    }
  });
  return found;
}

// 고객 취소
async function cancelReservationByCustomer(reservationId) {
  return changeReservationStatus(reservationId, "취소");
}
