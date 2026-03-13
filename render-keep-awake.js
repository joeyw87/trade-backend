/* render 클라우드 무료 이용시 15분 마다 접속을 해야 하므로 .. 로컬에서 실행하여 호출 스케쥴링 용도!! */
// 본인의 Render 서버 주소 중 아무 종목이나 하나 넣습니다.
const TARGET_URL = 'https://trade-backend-3o2e.onrender.com/api/yahoo?ticker=005930.KS';
const ENVEL_URL = 'https://trade-backend-3o2e.onrender.com/api/kis/envelope?marketType=ALL';
const CLOSE_BET_URL = 'https://trade-backend-3o2e.onrender.com/api/kis/closing-bet?marketType=ALL';

// 디스코드 서비스
const discordService = require('./services/discordService');

// 14분(밀리초 단위) 설정: 14 * 60초 * 1000밀리초
const INTERVAL_MS = 14 * 60 * 1000;         // 14분 (서버 찌르기용)

console.log(`🚀 Render 서버 무한 동력 스크립트 가동`);
console.log(`- 찌르기 주기: 14분`);
console.log(`- 디스코드 알림 주기 타이머 \n`);

// ════════════════════════════════════════════════════════
// 1. 14분마다 한 번씩 실행되는 Render 서버 깨우기 타이머
// ════════════════════════════════════════════════════════
setInterval(async () => {
    try {
        const response = await fetch(TARGET_URL);
        const time = new Date().toLocaleTimeString();
        
        if (response.ok) {
            console.log(`[${time}] 콕 찔러주기 성공! 서버가 깨어있습니다. (상태: ${response.status})`);
        } else {
            console.log(`[${time}] 통신은 했으나 서버 상태가 이상합니다. (상태: ${response.status})`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] 서버 찌르기 실패:`, error.message);
    }
}, INTERVAL_MS);

// ════════════════════════════════════════════════════════
// 2. 디스코드로 엔벨 알림 보내는 타이머 (8:30, 9:00, 15:00)
// ════════════════════════════════════════════════════════
async function sendDiscordHeartbeat(strategyType) {
    try {
        let response;
        let strategyName = "";
        if (strategyType === 'CLOSE_BET') {
            response = await fetch(CLOSE_BET_URL); 
            strategyName = "종가베팅";
        }else{
            response = await fetch(ENVEL_URL); 
            strategyName = "엔벨로프";
        }

        const time = new Date().toLocaleTimeString();
        
        if (response.ok) {
            const data = await response.json();
            console.log(`[${time}] ${strategyName} 조회 완료! (포착 종목 수: ${data.candidates ? data.candidates.length : 0}개)`);

            if (data.candidates && data.candidates.length > 0) {
                await discordService.sendDiscordMessage(strategyName, data.candidates);
            }
        } else {
            console.log(`[${time}] 엔벨로프 호출 시도 했으나 서버 상태가 이상합니다. (상태: ${response.status})`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] 엔벨로프 호출 실패:`, error.message);
    }
}


// ════════════════════════════════════════════════════════
// 💡 3. 알람 시계 타이머 (8:30, 9:00, 15:00 정각에만 발송)
// ════════════════════════════════════════════════════════
let lastSentTime = ""; // 같은 시간에 여러 번 중복 발송되는 것을 막는 방어막

// 봇이 30초마다 현재 시간을 확인합니다.
setInterval(() => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 1. 주말(토=6, 일=0)에는 시계를 봐도 아무것도 안 하고 패스!
    if (day === 0 || day === 6) return;

    const formattedHour = String(hour).padStart(2, '0');
    const formattedMinute = String(minute).padStart(2, '0');
    const currentTime = `${formattedHour}:${formattedMinute}`; // 예: 9시 5분 -> "09:05"

    // 3. 만약 방금 알림을 보낸 시간이라면 무시합니다. (1분 내내 쏘는 것 방지)
    if (lastSentTime === currentTime) return;

    // 4. 🎯 우리가 약속한 시간인지 확인합니다!
    const scheduleMap = {
        "08:30": "ENVEL",
        "09:00": "ENVEL",
        "13:00": "ENVEL",
        "14:00": "ENVEL",
        "15:00": "ENVEL",
        "15:05": "CLOSE_BET",   //종가베팅
        "15:15": "CLOSE_BET"
    };

    const strategyType = scheduleMap[currentTime];

    if (strategyType) {
        lastSentTime = currentTime; // "나 방금 8시 30분 알림 보냈어!" 하고 기록
        console.log(`\n⏰ [${now.toLocaleTimeString()}] 약속된 시간이 되었습니다. 장 스캔을 시작합니다!`);
        
        sendDiscordHeartbeat(strategyType); // 스캔 및 디스코드 발송 지시!
    }
}, 30 * 1000); // 30초(30,000ms)마다 시계 확인