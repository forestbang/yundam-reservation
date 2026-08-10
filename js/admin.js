// 관리자 공통 기능 (로그인 확인, 로그아웃)
function requireLogin(onReady) {
  auth.onAuthStateChanged((user) => {
    if (!user) { location.href = "index.html"; return; }
    if (onReady) onReady(user);
  });
}

function logout() {
  auth.signOut().then(() => location.href = "index.html");
}

const STATUS_COLOR_CLASS = {
  "예약": "st-예약", "도착": "st-도착", "착석": "st-착석",
  "이용중": "st-이용중", "완료": "st-완료", "취소": "st-취소", "노쇼": "st-노쇼",
};
