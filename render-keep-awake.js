require('dotenv').config(); //env 설정정보 가져오기 위해

/* render 클라우드 무료 이용시 15분 마다 접속을 해야 하므로 .. 로컬에서 실행하여 호출 스케쥴링 용도!! */
// 본인의 Render 서버 주소 중 아무 종목이나 하나 넣습니다.
const TARGET_URL = 'https://trade-backend-3o2e.onrender.com/api/yahoo?ticker=005930.KS';

// 🇰🇷 국내주식 API URL
const KR_ENVEL_URL      = 'https://trade-backend-3o2e.onrender.com/api/kis/envelope?marketType=ALL';
const KR_CLOSE_BET_URL  = 'https://trade-backend-3o2e.onrender.com/api/kis/closing-bet?marketType=ALL';

// 🇺🇸 미국주식 API URL
const US_ENVEL_URL      = 'https://trade-backend-3o2e.onrender.com/api/yahoo2/us-envelope';
const US_CLOSE_BET_URL  = 'https://trade-backend-3o2e.onrender.com/api/yahoo2/us-closing-bet';

// Supabase DB정보 세팅 (7일동안 호출없으면 일시정지 되므로..)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TARGET_TABLE = 'T_TICKER_MST'; // 예: users, stocks, keep_alive 등

// 디스코드 서비스
const discordService = require('./services/discordService');

// 14분(밀리초 단위) 설정: 14 * 60초 * 1000밀리초
const INTERVAL_MS = 14 * 60 * 1000;         // 14분 (서버 찌르기용)

console.log(`🚀 Render 서버 무한 동력 스크립트 가동`);
console.log(`- 찌르기 주기: 14분`);
console.log(`- 디스코드 알림 주기 타이머 \n`);
console.log(`- Supabase DB 생명연장: 1시간 주기 \n`);

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
// Supabase DB 생명 연장 함수 및 타이머
// ════════════════════════════════════════════════════════
async function wakeUpSupabase() {
    try {
        // Supabase REST API를 이용해 데이터 딱 1건만 가볍게 조회
        const response = await fetch(`${SUPABASE_URL}/rest/v1/${TARGET_TABLE}?select=*&limit=1`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });

        const time = new Date().toLocaleTimeString();
        if (response.ok) {
            console.log(`[${time}] 🟢 Supabase DB 찌르기 성공! (절대 잠들지 않음)`);
        } else {
            console.log(`[${time}] 🟡 Supabase 통신 상태 이상 (상태: ${response.status})`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] ❌ Supabase 찌르기 실패:`, error.message);
    }
}

// 1시간(60분 * 60초 * 1000)마다 Supabase 찌르기 실행
setInterval(wakeUpSupabase, 60 * 60 * 1000); 

// 스크립트 켜자마자 즉시 1번 실행 (테스트용)
wakeUpSupabase();

// ════════════════════════════════════════════════════════
// 2. 디스코드 알림 발송 함수
// ════════════════════════════════════════════════════════
async function sendDiscordHeartbeat(strategyType) {
    // strategyType별 URL과 전략명 매핑
    const strategyMap = {
        'KR_ENVEL':     { url: KR_ENVEL_URL,     name: '엔벨로프 (국내)' },
        'KR_CLOSE_BET': { url: KR_CLOSE_BET_URL, name: '종가베팅 (국내)' },
        'US_ENVEL':     { url: US_ENVEL_URL,     name: '엔벨로프 (미국)' },
        'US_CLOSE_BET': { url: US_CLOSE_BET_URL, name: '종가베팅 (미국)' },
    };

    const strategy = strategyMap[strategyType];
    if (!strategy) return;

    try {
        const response = await fetch(strategy.url);
        const time = new Date().toLocaleTimeString();

        if (response.ok) {
            const data = await response.json();
            console.log(`[${time}] ${strategy.name} 조회 완료! (포착 종목 수: ${data.candidates ? data.candidates.length : 0}개)`);

            if (data.candidates && data.candidates.length > 0) {
                await discordService.sendDiscordMessage(strategy.name, data.candidates);
            }
        } else {
            console.log(`[${time}] ${strategy.name} 호출 시도 했으나 서버 상태가 이상합니다. (상태: ${response.status})`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] ${strategy.name} 호출 실패:`, error.message);
    }
}


// ════════════════════════════════════════════════════════
// 💡 3. 알람 시계 타이머
//
// 🇰🇷 국내주식 (KST 기준)
//   - 엔벨로프: 08:30, 09:00, 13:00, 14:00, 15:00
//   - 종가베팅: 15:05, 15:15
//
// 🇺🇸 미국주식 (KST 기준, 서머타임: 22:30~05:00 / 겨울타임: 23:30~06:00)
//   - 엔벨로프: 22:30, 00:30, 02:30
//   - 종가베팅: 04:50, 05:05 (서머타임 장마감 직전/직후)
// ════════════════════════════════════════════════════════
let lastSentTime = ""; // 중복 발송 방지

setInterval(() => {
    const now = new Date();
    const day = now.getDay();
    const hour = now.getHours();
    const minute = now.getMinutes();

    // 주말(토=6, 일=0)에는 아무것도 안 하고 패스
    //if (day === 0 || day === 6) return;

    const formattedHour = String(hour).padStart(2, '0');
    const formattedMinute = String(minute).padStart(2, '0');
    const currentTime = `${formattedHour}:${formattedMinute}`;

    if (lastSentTime === currentTime) return;

    const scheduleMap = {
        // 🇰🇷 국내주식
        "08:30": "KR_ENVEL",
        "09:00": "KR_ENVEL",
        "13:00": "KR_ENVEL",
        "14:00": "KR_ENVEL",
        "15:00": "KR_ENVEL",
        "15:05": "KR_CLOSE_BET",
        "15:15": "KR_CLOSE_BET",
        "15:25": "KR_CLOSE_BET",

        // 🇺🇸 미국주식 (서머타임 기준)
        "22:15": "US_ENVEL",
        "22:30": "US_ENVEL",
        "23:00": "US_ENVEL",
        "23:30": "US_ENVEL",
        "00:00": "US_ENVEL",
        "00:30": "US_ENVEL",
        "01:00": "US_ENVEL",
        //"02:30": "US_ENVEL",
        //"04:50": "US_CLOSE_BET",
        //"05:05": "US_CLOSE_BET",
        "06:40": "US_CLOSE_BET",
        "07:00": "US_CLOSE_BET",
        "07:30": "US_CLOSE_BET",
        //"23:57": "US_ENVEL", //TEST
        //"00:00": "US_CLOSE_BET", //TEST
    };

    const strategyType = scheduleMap[currentTime];

    if (strategyType) {
        lastSentTime = currentTime;
        console.log(`\n⏰ [${now.toLocaleTimeString()}] 약속된 시간이 되었습니다. 장 스캔을 시작합니다! (${strategyType})`);
        sendDiscordHeartbeat(strategyType);
    }
}, 30 * 1000); // 30초마다 시계 확인
