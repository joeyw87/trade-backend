/* render 클라우드 무료 이용시 15분 마다 접속을 해야 하므로 .. 로컬에서 실행하여 호출 스케쥴링 용도!! */
// 본인의 Render 서버 주소 중 아무 종목이나 하나 넣습니다.
const TARGET_URL = 'https://trade-backend-3o2e.onrender.com/api/yahoo?ticker=005930.KS';

// 14분(밀리초 단위) 설정: 14 * 60초 * 1000밀리초
const INTERVAL_MS = 14 * 60 * 1000;

console.log(`🚀 Render 서버 무한 동력 스크립트 가동 (14분 주기)`);
console.log(`타겟 URL: ${TARGET_URL}\n`);

// 14분마다 한 번씩 실행되는 반복 타이머
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