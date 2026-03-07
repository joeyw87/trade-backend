const originalLog = console.log;
const originalError = console.error;

function getTimestamp() {
    // Render 서버 위치와 무관하게 무조건 한국 시간(KST)으로 포맷팅
    return new Date().toLocaleString('ko-KR', { 
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Node.js의 기본 console.log 덮어쓰기
console.log = function (...args) {
    originalLog(`[${getTimestamp()}]`, ...args);
};

// Node.js의 기본 console.error 덮어쓰기
console.error = function (...args) {
    originalError(`[${getTimestamp()}]`, ...args); // 에러 표시는 기존 로직 유지
};