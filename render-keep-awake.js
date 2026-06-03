require('dotenv').config(); //env 설정정보 가져오기 위해

/* render 클라우드 무료 이용시 15분 마다 접속을 해야 하므로 .. 로컬에서 실행하여 호출 스케쥴링 용도!! */
// 본인의 Render 서버 주소 중 아무 종목이나 하나 넣습니다.
const TARGET_URL = 'https://trade-backend-3o2e.onrender.com/api/yahoo?ticker=005930.KS';

// 🇰🇷 국내주식 API URL
const KR_ENVEL_URL      = 'https://trade-backend-3o2e.onrender.com/api/kis/envelope?marketType=ALL';
const KR_CLOSE_BET_URL  = 'https://trade-backend-3o2e.onrender.com/api/kis/closing-bet?marketType=ALL';

// 🇺🇸 미국주식 종가베팅: Render 서버 KIS 라우터 사용
const US_CLOSE_BET_URL  = 'https://trade-backend-3o2e.onrender.com/api/kis/us-closing-bet';
// 🇰🇷 국내주식 RSI
const KR_RSI_URL        = 'https://trade-backend-3o2e.onrender.com/api/kis/kr-rsi';
// 🇺🇸 미국주식 엔벨로프 & RSI & JYP픽: Yahoo → Render에서 차단되므로 로컬 직접 호출
const usStockService = require('./services/usStockService');
// 🔍 영무문 종목 발굴 스크리닝 (로컬 실행)
const { runScreening } = require('./services/screening/screeningService');

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
async function sendDiscordHeartbeat(strategyType, limit = 200, silent = true) {
    const time = new Date().toLocaleTimeString();

    // 🇺🇸 JYP 픽 로컬 호출
    if (strategyType === 'US_JYP') {
        try {
            const stocks = await usStockService.getJypPicksStatus();
            console.log(`[${time}] JYP 픽 조회 완료! (${stocks.length}개)`);
            if (stocks.length > 0) {
                await discordService.sendJypPicksMessage(stocks);
            }
        } catch (error) {
            console.error(`[${time}] JYP 픽 로컬 실행 실패:`, error.message);
        }
        return;
    }

    // 🇺🇸 JYP 픽 당일 분봉 저점 근접 감지
    if (strategyType === 'US_JYP_LOW') {
        const threshold = (limit <= 20) ? limit : 3; // 스케줄러 기본(200) → 3%, 수동입력 → 그대로
        try {
            const alerts = await usStockService.getJypIntradayLowAlert(threshold);
            console.log(`[${time}] JYP 저점 감지 완료! (저점근접: ${alerts.length}건)`);
            if (alerts.length > 0) {
                await discordService.sendJypIntradayAlertMessage(alerts, threshold);
            } else if (!silent) {
                // 수동 명령일 때만 "없음" 피드백 전송
                await discordService.sendJypIntradayAlertMessage([], threshold);
            } else {
                console.log(`[${time}] 저점 근접 종목 없음 (기준: ±${threshold}%) — 자동실행, 알림 생략`);
            }
        } catch (error) {
            console.error(`[${time}] JYP 저점 감지 실패:`, error.message);
        }
        return;
    }

    // 🇺🇸 미국 로컬 호출 전략 (Yahoo chart → Render 차단)
    if (strategyType === 'US_ENVEL' || strategyType === 'US_RSI') {
        const isRsi = strategyType === 'US_RSI';
        const strategyName = isRsi ? 'RSI 과매도 (미국)' : '엔벨로프 (미국)';
        try {
            const result = isRsi
                ? await usStockService.getUsRsiList(limit)
                : await usStockService.getUsEnvelopeBetList(limit);
            console.log(`[${time}] ${strategyName} 조회 완료! (스캔: ${limit}개 / 포착: ${result.candidates.length}개)`);
            if (result.candidates.length > 0) {
                await discordService.sendDiscordMessage(strategyName, result.candidates);
            }
        } catch (error) {
            console.error(`[${time}] ${strategyName} 로컬 실행 실패:`, error.message);
        }
        return;
    }

    // 나머지 전략: Render 서버 API 호출
    const strategyMap = {
        'KR_ENVEL':     { url: KR_ENVEL_URL,                              name: '엔벨로프 (국내)' },
        'KR_CLOSE_BET': { url: KR_CLOSE_BET_URL,                          name: '종가베팅 (국내)' },
        'KR_RSI':       { url: KR_RSI_URL,                                name: 'RSI 과매도 (국내)' },
        'US_CLOSE_BET': { url: `${US_CLOSE_BET_URL}?limit=${limit}`,      name: '종가베팅 (미국)' },
    };

    const strategy = strategyMap[strategyType];
    if (!strategy) return;

    try {
        const response = await fetch(strategy.url);

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
        console.error(`[${time}] ${strategy.name} 호출 실패:`, error.message);
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
    if (day === 0) return;

    const formattedHour = String(hour).padStart(2, '0');
    const formattedMinute = String(minute).padStart(2, '0');
    const currentTime = `${formattedHour}:${formattedMinute}`;

    if (lastSentTime === currentTime) return;

    const scheduleMap = {
        // 🇰🇷 국내주식
        "08:30": "KR_ENVEL",
        "08:50": "KR_ENVEL",
        "09:00": "KR_ENVEL",
        "09:10": "KR_ENVEL",
        "13:00": "KR_ENVEL",
        "14:00": "KR_ENVEL",
        "15:00": "KR_ENVEL",
        "15:05": "KR_CLOSE_BET",
        "15:15": "KR_CLOSE_BET",
        "15:25": "KR_CLOSE_BET",

        // 🇺🇸 미국주식 (서머타임 기준)
        "22:10": "US_ENVEL",
        "22:20": "US_ENVEL",
        "22:30": "US_ENVEL",
        "22:35": "US_ENVEL",
        "22:40": "US_ENVEL",
        "22:50": "US_ENVEL",
        "23:00": "US_ENVEL",
        "23:30": "US_ENVEL",
        "00:00": "US_ENVEL",
        "00:30": "US_ENVEL",
        "01:00": "US_ENVEL",
        //"02:30": "US_ENVEL",
        //"04:50": "US_CLOSE_BET",
        //"05:05": "US_CLOSE_BET",
        "04:45": "US_CLOSE_BET",
        "04:55": "US_CLOSE_BET",
        "06:40": "US_CLOSE_BET",
        "07:00": "US_CLOSE_BET",
        "07:30": "US_CLOSE_BET",
        "01:02": "US_ENVEL", //TEST
        "01:03": "US_CLOSE_BET", //TEST

        // 🎯 JYP 픽 당일 저점 근접 감지 (자동, threshold 3%)
        "22:35": "US_JYP_LOW", // 장 초반
        "22:45": "US_JYP_LOW",
        "22:55": "US_JYP_LOW",
        "23:10": "US_JYP_LOW",
        "23:30": "US_JYP_LOW", // 마지막 취침 전
        "08:00": "US_JYP_LOW", // 다음날 아침 (전날 장 결과 확인)
    };

    const strategyType = scheduleMap[currentTime];

    if (strategyType) {
        lastSentTime = currentTime;
        console.log(`\n⏰ [${now.toLocaleTimeString()}] 약속된 시간이 되었습니다. 장 스캔을 시작합니다! (${strategyType})`);
        sendDiscordHeartbeat(strategyType);
    }
}, 30 * 1000); // 30초마다 시계 확인


// ════════════════════════════════════════════════════════
// 🤖 [신규] 디스코드 양방향 채팅 봇 로직 (영욱문AI비서)
// ════════════════════════════════════════════════════════
const { Client, GatewayIntentBits } = require('discord.js');

// 💡 봇이 디스코드에서 할 수 있는 행동 반경(권한)을 설정합니다.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent // ⭐️ 유저가 친 채팅 내용을 읽기 위해 절대적으로 필요!
    ]
});

// 봇이 켜졌을 때 딱 한 번 실행되는 인사
client.once('clientReady', () => {
    console.log(`\n💬 디스코드 양방향 통신 준비 완료! AI비서 ...`);
});

// 채팅방에 메시지가 올라올 때마다 실행되는 핵심 로직!
client.on('messageCreate', async (message) => {
    // 1. 봇이 스스로 보낸 메시지거나, '!'로 시작하지 않는 일반 대화는 무시합니다.
    if (message.author.bot || !message.content.startsWith('!')) return;

    const command = message.content.trim().toUpperCase();
    const time = new Date().toLocaleTimeString();

    // 숫자 suffix 파싱 헬퍼 (예: '!미국종가50' → limit=50, '!미국종가' → limit=200)
    const parseLimit = (prefix) => {
        const numStr = command.slice(prefix.length);
        const parsed = parseInt(numStr, 10);
        return (!numStr || isNaN(parsed) || parsed <= 0) ? 200 : Math.min(parsed, 200);
    };

    // 2. 명령어 분기 처리 + 도움말
    if (command.startsWith('!국내엔벨')) {
        console.log(`[${time}] 유저 명령 수신: ${command}`);
        await message.reply('🔎 넵! 즉시 [🇰🇷 국내 주식 엔벨로프 낙주] 타점을 스캔해 오겠습니다. (약 3~5초 소요)');
        await sendDiscordHeartbeat('KR_ENVEL');

    } else if (command.startsWith('!미국엔벨')) {
        const limit = parseLimit('!미국엔벨');
        console.log(`[${time}] 유저 명령 수신: !미국엔벨 (limit: ${limit})`);
        await message.reply(`🦅 [🇺🇸 미국 주식 엔벨로프] ${limit}개 종목 스캔 시작합니다. (약 ${Math.ceil(limit * 1.5 / 60)}~${Math.ceil(limit * 2 / 60)}분 소요)`);
        await sendDiscordHeartbeat('US_ENVEL', limit);

    } else if (command.startsWith('!국내종가')) {
        console.log(`[${time}] 유저 명령 수신: ${command}`);
        await message.reply('🌙 [🇰🇷 국내 주식 종가베팅] 타점을 긁어오는 중입니다...');
        await sendDiscordHeartbeat('KR_CLOSE_BET');

    } else if (command.startsWith('!미국종가')) {
        const limit = parseLimit('!미국종가');
        console.log(`[${time}] 유저 명령 수신: !미국종가 (limit: ${limit})`);
        await message.reply(`🗽 [🇺🇸 미국 주식 종가베팅] ${limit}개 종목 스캔 시작합니다. (약 ${Math.ceil(limit * 1.1 / 60)}~${Math.ceil(limit * 1.3 / 60)}분 소요)`);
        await sendDiscordHeartbeat('US_CLOSE_BET', limit);

    } else if (command.startsWith('!미국JYP저점')) {
        const numStr = command.slice('!미국JYP저점'.length);
        const parsed = parseInt(numStr, 10);
        const threshold = (!numStr || isNaN(parsed) || parsed <= 0) ? 3 : Math.min(parsed, 20);
        console.log(`[${time}] 유저 명령 수신: ${command} (threshold: ${threshold}%)`);
        await message.reply(`📍 [JYP 픽] 당일 저점 근접 감지 중... (기준: 저점 대비 +${threshold}% 이내)`);
        await sendDiscordHeartbeat('US_JYP_LOW', threshold, false);

    } else if (command.startsWith('!미국JYP')) {
        console.log(`[${time}] 유저 명령 수신: ${command}`);
        await message.reply('🎯 [JYP 픽] 관심종목 현황 조회 중입니다...');
        await sendDiscordHeartbeat('US_JYP');

    } else if (command.startsWith('!국내RSI')) {
        console.log(`[${time}] 유저 명령 수신: ${command}`);
        await message.reply('📊 [🇰🇷 국내주식 RSI 과매도] 스캔 시작합니다. (약 1~2분 소요)');
        await sendDiscordHeartbeat('KR_RSI');

    } else if (command.startsWith('!미국RSI')) {
        const limit = parseLimit('!미국RSI');
        console.log(`[${time}] 유저 명령 수신: !미국RSI (limit: ${limit})`);
        await message.reply(`📊 [🇺🇸 미국주식 RSI 과매도] ${limit}개 종목 스캔 시작합니다.`);
        await sendDiscordHeartbeat('US_RSI', limit);

    } else if (command === '!영무문') {
        console.log(`[${time}] 유저 명령 수신: !영무문`);
        await message.reply('🔍 [영무문] 종목 발굴 스크리닝 시작합니다. (골든크로스 → 기술/투자자 지표 → 네이버 스크래핑 순 분석, 약 5~10분 소요)');
        try {
            const result = await runScreening();
            await discordService.sendMooScreeningMessage(result);
        } catch (err) {
            console.error(`[${time}] 영무문 스크리닝 실패:`, err.message);
            await message.reply('❌ 스크리닝 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.');
        }

    } else if (command === '!도움말' || command === '!사용법') {
        const helpText = `**🤖 영욱문AI비서 명령어 사용법**

━━━━━━━━━━━━━━━━━━━━━━━━
🇰🇷 **국내주식**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!국내엔벨\`
└ 20일 이동평균선 -10% 이하로 내려온 낙폭과대 종목 스캔
└ 자동 실행: 08:30 / 09:00 / 13:00 / 14:00 / 15:00

\`!국내종가\`
└ 당일 고저가 대비 상단 80% 이상 위치한 종가베팅 후보 스캔
└ 자동 실행: 15:05 / 15:15 / 15:25

\`!국내RSI\`
└ RSI(14) 30 이하 과매도 종목 스캔 (반등 타점 탐색)

━━━━━━━━━━━━━━━━━━━━━━━━
🇺🇸 **미국주식**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!미국엔벨\` / \`!미국엔벨[숫자]\`
└ 20일선 -10% 이하 낙폭과대 종목 스캔
└ 예: \`!미국엔벨50\` → 상위 50개만 스캔 (기본값 200)
└ 자동 실행: 22:30 / 00:30 / 01:00 등 장 초반

\`!미국종가\` / \`!미국종가[숫자]\`
└ 당일 고저가 상단 80% + 시총 1억달러 이상 종가베팅 후보 스캔
└ 예: \`!미국종가100\` → 상위 100개만 스캔 (기본값 200)
└ 자동 실행: 04:45 / 04:55 (서머타임 장마감 직전)

\`!미국RSI\` / \`!미국RSI[숫자]\`
└ RSI(14) 30 이하 과매도 종목 스캔
└ 예: \`!미국RSI50\` → 상위 50개만 스캔 (기본값 200)

━━━━━━━━━━━━━━━━━━━━━━━━
🎯 **JYP 픽 관심종목**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!미국JYP\`
└ JYP 픽 전종목 현재 시세 조회
└ 섹터별 그룹 표시 / 등락률 / 52주 고가 대비 위치 표시

\`!미국JYP저점\` / \`!미국JYP저점[숫자]\`
└ 당일 5분봉 기준 장중 최저가 근처에 있는 종목만 알림
└ 숫자는 최저가 대비 허용 오차(%) — 낮을수록 더 타이트
└ 예: \`!미국JYP저점3\` → 저점 대비 +3% 이내 (기본값 3%)
└ 예: \`!미국JYP저점5\` → 저점 대비 +5% 이내
└ ⚠️ 미국 장 시간(KST 22:30~05:00) 중에만 의미 있는 데이터

━━━━━━━━━━━━━━━━━━━━━━━━
🔍 **종목 발굴**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!영무문\`
└ 골든크로스 기본조건 통과 종목에 다중 지표 스코어링
└ 정배열·거래량급증·외국인/기관순매수·RSI·목표가상향·컨센서스상회
└ 8점 이상 종목만 영무문 채널 전송 (약 5~10분 소요)

━━━━━━━━━━━━━━━━━━━━━━━━
📌 \`!도움말\` 또는 \`!사용법\` 으로 이 화면을 다시 볼 수 있습니다.`;
        message.reply(helpText);
    }
});

// 💡 .env 금고에 넣어둔 토큰으로 디스코드 서버에 접속(로그인)합니다.
client.login(process.env.DISCORD_BOT_TOKEN);