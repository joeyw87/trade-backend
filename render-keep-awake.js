/* render 클라우드 무료 이용시 15분 마다 접속을 해야 하므로 .. 로컬에서 실행하여 호출 스케쥴링 용도!! */
// 본인의 Render 서버 주소 중 아무 종목이나 하나 넣습니다.
const TARGET_URL = 'https://trade-backend-3o2e.onrender.com/api/yahoo?ticker=005930.KS';
const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1481652022544695386/Cm2Fww0Mdq8cf8bzxXvxR3oa0kN_VydKDMkWnRSj1nKyWwtf3M-Wy2Mq_fRhMLXXvccn';
const ENVEL_URL = 'https://trade-backend-3o2e.onrender.com/api/kis/envelope?marketType=ALL';

// 14분(밀리초 단위) 설정: 14 * 60초 * 1000밀리초
const INTERVAL_MS = 14 * 60 * 1000;         // 14분 (서버 찌르기용)
const DISCORD_INTERVAL_MS = 60 * 60 * 1000; // 1시간 (디스코드 보고용)

console.log(`🚀 Render 서버 무한 동력 스크립트 가동`);
console.log(`- 찌르기 주기: 14분`);
console.log(`- 생존보고 주기: 1시간\n`);

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
// 2. 1시간마다 디스코드로 엔벨 알림 보내는 타이머
// ════════════════════════════════════════════════════════
async function sendDiscordHeartbeat() {
    try {
        const response = await fetch(ENVEL_URL);
        const time = new Date().toLocaleTimeString();
        
        if (response.ok) {
            console.log(`[${time}] 엔벨로프 조회 성공! 조건 만족 시 디스코드로 전송됩니다. (상태: ${response.status})`);
        } else {
            console.log(`[${time}] 엔벨로프 호출은 시도 했으나 서버 상태가 이상합니다. (상태: ${response.status})`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] 엔벨로프 호출 실패:`, error.message);
    }
}

// 💡 [테스트의 핵심] 스크립트를 켜자마자 일단 즉시 1번 발송합니다!
sendDiscordHeartbeat();

// 💡 그리고 그 이후부터는 딱 1시간(DISCORD_INTERVAL_MS)마다 반복해서 발송합니다.
setInterval(sendDiscordHeartbeat, DISCORD_INTERVAL_MS);