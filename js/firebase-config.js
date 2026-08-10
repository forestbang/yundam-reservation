// yundam-reservation Firebase 설정
// (이 값들은 공개되어도 안전한 값입니다. 실제 보안은 Realtime Database 규칙과 로그인으로 지킵니다.)
const firebaseConfig = {
  apiKey: "AIzaSyBMhHMpf3HRz0vEVgLeTG6HkqpN2qiKQNQ",
  authDomain: "yundam-reservation.firebaseapp.com",
  databaseURL: "https://yundam-reservation-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "yundam-reservation",
  storageBucket: "yundam-reservation.firebasestorage.app",
  messagingSenderId: "785025495902",
  appId: "1:785025495902:web:dc6902321754596927d5cf",
  measurementId: "G-XGJP05R0RM"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();
