// ============================================================
// 윤담 예약 시스템 공통 설정 (매장 정보, 테이블, 영업시간, 메뉴)
// ============================================================

const RESTAURANT = { name: "윤담", phone: "" }; // phone: 전화문의 번호를 나중에 채워주세요

// 테이블 정의
const FOUR_SEAT = ["T1", "T2", "T3", "T4", "T5"];
const TWO_SEAT = ["T6"];
const COUNTER_SEATS = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"];
const ADJACENT_PAIRS = [
  ["C1", "C2"], ["C2", "C3"],
  ["C4", "C5"], ["C5", "C6"], ["C6", "C7"], ["C7", "C8"],
];
const ALL_TABLES = [
  ...FOUR_SEAT.map((id) => ({ id, capacity: 4, type: "table" })),
  ...TWO_SEAT.map((id) => ({ id, capacity: 2, type: "table" })),
  ...COUNTER_SEATS.map((id) => ({ id, capacity: 1, type: "counter" })),
];

// 영업시간 / 예약 규칙 (사장님 확정 내용)
const BUSINESS = {
  closedDay: 0, // 0 = 일요일
  lunchStart: "11:30",
  lunchLastOrder: "14:00",
  breakStart: "14:30",
  breakEnd: "17:00",
  dinnerStart: "17:00",
  dinnerLastOrder: "20:30",
  closeTime: "21:00",
  interval: 30, // 예약 가능 간격(분)
  duration: 60, // 기본 이용시간(분)
  bookingWindowDays: 14, // 온라인 예약은 오늘부터 14일까지만
  maxOnlinePartySize: 4,
};

// 메뉴 (이름 · 가격만 노출, 설명 없음)
const MENU = [
  { name: "사시미백반", price: 18000 },
  { name: "가지고기튀김 정식", price: 16000 },
  { name: "닭튀김정식", price: 13000 },
  { name: "야채회비빔밥", price: 13000 },
  { name: "육회비빔밥", price: 13000 },
  { name: "돌솥 알밥", price: 16000 },
  { name: "돌솥알밥 아와세 (한정판매)", price: 31000 },
  { name: "야채회비빔밥 아와세 (한정판매)", price: 28000 },
  { name: "육회비빔밥 아와세 (한정판매)", price: 28000 },
  { name: "닭튀김 아와세 (한정판매)", price: 28000 },
  { name: "사시미 아와세 (한정판매)", price: 33000 },
  { name: "메로구이 정식", price: 23000 },
  { name: "작은사시미 정식", price: 25000 },
];

const STATUS_LIST = ["예약", "도착", "착석", "이용중", "완료", "취소", "노쇼"];
const CLOSED_STATUSES = ["완료", "취소", "노쇼"]; // 이 상태가 되면 테이블은 즉시 반납됨

// ---------------- 시간 / 날짜 유틸 ----------------
function pad2(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function timeToMin(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function minToTime(m) { return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; }
function todayStr() { return toDateStr(new Date()); }

function generateTimeSlots() {
  const slots = [];
  for (let t = timeToMin(BUSINESS.lunchStart); t <= timeToMin(BUSINESS.lunchLastOrder); t += BUSINESS.interval) {
    slots.push(minToTime(t));
  }
  for (let t = timeToMin(BUSINESS.dinnerStart); t <= timeToMin(BUSINESS.dinnerLastOrder); t += BUSINESS.interval) {
    slots.push(minToTime(t));
  }
  return slots;
}

// 예약 하나가 차지하는 30분 단위 슬롯들 (기본 60분 = 슬롯 2개)
function neededSlots(startTime, durationMin) {
  durationMin = durationMin || BUSINESS.duration;
  const slots = [];
  const startMin = timeToMin(startTime);
  for (let m = startMin; m < startMin + durationMin; m += BUSINESS.interval) {
    slots.push(minToTime(m));
  }
  return slots;
}

function isDateBookable(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  const diffDays = Math.round((target - today) / 86400000);
  if (isNaN(diffDays)) return { ok: false, reason: "날짜를 확인해 주세요." };
  if (diffDays < 0) return { ok: false, reason: "지난 날짜는 예약할 수 없습니다." };
  if (diffDays > BUSINESS.bookingWindowDays) return { ok: false, reason: "2주 이후 날짜는 전화로 문의해 주세요." };
  if (target.getDay() === BUSINESS.closedDay) return { ok: false, reason: "일요일은 휴무일입니다." };
  return { ok: true };
}

function formatDateKorean(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

function isValidName(name) {
  return !!name && name.trim().length >= 2;
}

function isValidPhone(phone) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  return digits.length >= 9 && digits.length <= 11;
}

// ---------------- 테이블 자동 배정 후보 순서 (사장님 확정 로직) ----------------
function candidateGroupsForParty(partySize) {
  if (partySize === 1) {
    return [...COUNTER_SEATS.map((c) => [c]), ...TWO_SEAT.map((t) => [t])];
  }
  if (partySize === 2) {
    return [...FOUR_SEAT.map((t) => [t]), ...TWO_SEAT.map((t) => [t]), ...ADJACENT_PAIRS];
  }
  if (partySize === 3 || partySize === 4) {
    return FOUR_SEAT.map((t) => [t]);
  }
  return []; // 5명 이상은 온라인 자동배정 대상 아님 (전화문의 / 관리자가 직접 배정)
}

function isGroupFree(indexForDate, group, needed) {
  for (const t of group) {
    const tSlots = (indexForDate && indexForDate[t]) || {};
    for (const s of needed) {
      if (tSlots[s]) return false;
    }
  }
  return true;
}
