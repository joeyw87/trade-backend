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
let lastSentTime = "";        // 중복 발송 방지
let lastWiseReportDate = ""; // 영욱문 리포트 자동 브리핑 날짜 추적

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

    // ── 평일 08:00 영욱문 리포트 자동 브리핑 ──
    if (currentTime === '08:00' && day >= 1 && day <= 5) {
        const todayStr = now.toISOString().slice(0, 10);
        if (lastWiseReportDate !== todayStr) {
            lastWiseReportDate = todayStr;
            console.log(`\n⏰ [${now.toLocaleTimeString()}] 영욱문 리포트 자동 브리핑 시작`);
            (async () => {
                try {
                    const { scrapeWiseReportSummary, scrapeWiseReportIndustrySummary } = require('./services/screening/naverScraper');
                    const [companyReports, industryReports] = await Promise.all([
                        scrapeWiseReportSummary(),
                        scrapeWiseReportIndustrySummary(),
                    ]);
                    if (companyReports.length)  await discordService.sendWiseReportSummaryMessage(companyReports);
                    if (industryReports.length) await discordService.sendWiseReportIndustrySummaryMessage(industryReports);
                    console.log('✅ 영욱문 리포트 자동 브리핑 완료');
                } catch (err) {
                    console.error('❌ 영욱문 리포트 자동 브리핑 실패:', err.message);
                }
            })();
        }
    }

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

    } else if (command === '!영무문2') {
        console.log(`[${time}] 유저 명령 수신: !영무문2`);
        await message.reply('📋 [영무문2] 네이버 최근 리포트 90건 분석 중입니다. (약 1~2분 소요)');
        try {
            const { scrapeRecentReports, scrapeReportDetail, scrapeConsensus, delay: nd } = require('./services/screening/naverScraper');
            const { getStockCurrentPrice } = require('./services/screening/technicalService');
            const { getKisAccessToken: getToken } = require('./kisAuth');

            // 1. 리스트 수집
            const rows = await scrapeRecentReports(90);

            // 2. 종목별 그룹핑 — 증권사별 최신 리포트 href 1개만 보존
            const stockMap = {};
            for (const row of rows) {
                if (!stockMap[row.name]) {
                    stockMap[row.name] = { name: row.name, ticker: row.ticker, count: 0, firmMap: {} };
                }
                const s = stockMap[row.name];
                s.count++;
                if (row.firm && !s.firmMap[row.firm]) {
                    s.firmMap[row.firm] = { href: row.reportHref, opinion: null, target: null };
                }
            }

            // 3. 상위 15종목
            const top15 = Object.values(stockMap)
                .sort((a, b) => b.count - a.count)
                .slice(0, 15);

            // 4. 각 증권사 최신 리포트 상세 조회 (투자의견 + 목표주가)
            for (const stock of top15) {
                for (const info of Object.values(stock.firmMap)) {
                    if (info.href) {
                        const detail = await scrapeReportDetail(info.href);
                        info.opinion = detail.opinion;
                        info.target  = detail.target;
                        await nd(400);
                    }
                }
            }

            // 5. 현재가 조회
            const token = await getToken();
            const priceMap = {};
            for (const stock of top15) {
                if (stock.ticker) {
                    const info = await getStockCurrentPrice(stock.ticker, token);
                    if (info) priceMap[stock.ticker] = info;
                    await nd(300);
                }
            }

            // 6. 컨센서스 조회
            const consensusMap = {};
            for (const stock of top15) {
                if (stock.ticker) {
                    consensusMap[stock.ticker] = await scrapeConsensus(stock.ticker);
                    await nd(500);
                }
            }

            // 7. 재정렬: 건수 동일 시 최고 목표가 괴리율(상승여력) 큰 순
            top15.sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                const pa = priceMap[a.ticker]?.price;
                const pb = priceMap[b.ticker]?.price;
                const maxTa = Math.max(0, ...Object.values(a.firmMap).map(f => f.target || 0));
                const maxTb = Math.max(0, ...Object.values(b.firmMap).map(f => f.target || 0));
                const upsideA = (pa && maxTa) ? (maxTa / pa - 1) : -Infinity;
                const upsideB = (pb && maxTb) ? (maxTb / pb - 1) : -Infinity;
                return upsideB - upsideA;
            });
            const top10 = top15.slice(0, 12);

            // 8. 디스코드 전송
            await discordService.sendMoo2Message(top10, priceMap, consensusMap);
        } catch (err) {
            console.error(`[${time}] 영무문2 실패:`, err.message);
            await message.reply('❌ 리포트 수집 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.');
        }

    } else if (command.startsWith('!매도')) {
        if (command === '!매도사용법' || command === '!매도도움말') {
        const sellHelp = `**📤 매도 타이밍 분석 사용법 & 판단 기준**

━━━━━━━━━━━━━━━━━━━━━━━━
📌 **명령어**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!매도종목명\`
└ 예) \`!매도삼성전자\`, \`!매도005930\`

\`!매도종목명 매수가\`
└ 예) \`!매도삼성전자 70000\`
└ 매수가 입력 시 정확한 손절 라인 계산

━━━━━━━━━━━━━━━━━━━━━━━━
🎯 **분할 매도 전략**
━━━━━━━━━━━━━━━━━━━━━━━━
**1차 매도 (30% 물량)**
└ 현재가 바로 위 첫 번째 저항선
└ 근거: MA20, MA60, 피보나치 38.2%
└ 목적: 단기 이익 확보, 리스크 축소

**2차 매도 (30% 물량)**
└ 중기 저항선 또는 전고점
└ 근거: MA120, 최근 고점, 피보나치 61.8%, 목표가 하단
└ 목적: 중기 수익 실현

**3차 매도 (나머지 40%)**
└ 장기 목표 완료 구간
└ 근거: MA240, 피보나치 100%, 목표가 상단
└ 목적: 최대 수익 실현

━━━━━━━━━━━━━━━━━━━━━━━━
🔴 **손절 라인 판단 기준**
━━━━━━━━━━━━━━━━━━━━━━━━
└ 매수가 입력 시: 매수가 -5% 또는 MA60 이탈 중 유리한 쪽
└ 매수가 없을 시: MA20 또는 MA60 이탈가의 -1%
└ **손절선 돌파 시 즉시 매도 원칙**

━━━━━━━━━━━━━━━━━━━━━━━━
📊 **기술 지표 해석**
━━━━━━━━━━━━━━━━━━━━━━━━
**RSI (과매수/과매도 지수)**
└ 🟢 60 미만: 정상 범위, 추가 상승 여력
└ 🟡 60~70: 상승 추세, 경계 시작
└ 🟠 70~80: 과매수 경계, 1~2차 익절 고려
└ 🔴 80 이상: 과매수 강함, 단기 고점 가능성

**이동평균선 (MA)**
└ 현재가 > MA → 저항선으로 작동
└ 현재가 < MA → 지지선으로 작동
└ MA20 < MA60 < MA120 순으로 저항 강도 ↑

**피보나치 확장**
└ 최근 저점~고점 폭 기준 상승 목표 구간
└ 38.2% → 1차 / 61.8% → 2차 / 100% → 3차

━━━━━━━━━━━━━━━━━━━━━━━━
📋 **리서치 분석 해석**
━━━━━━━━━━━━━━━━━━━━━━━━
**목표가 추이**
└ ✅ 상향 우세: 애널리스트들이 전망 상향 → 3차까지 보유 근거
└ ❌ 하향 우세: 전망 악화 → 1~2차에서 조기 익절 고려
└ ➡️ 유지: 현 수준 적정 판단

**목표가 달성률 (현재가 ÷ 목표가 중간값)**
└ 💚 50% 미만: 저평가 → 장기 보유 가능
└ 🟢 50~75%: 여유 있음 → 3차까지 보유 유효
└ 🟡 75~90%: 중간 → 2차 매도 구간
└ 🟠 90~98%: 목표가 근접 → 1~2차 익절 고려
└ 🔴 98% 이상: 목표가 도달 → 매도 적극 검토

**컨센서스 스프레드 (증권사 간 목표가 차이)**
└ ✅ 5% 미만: 의견 일치 → 목표가 신뢰도 높음
└ 🟡 5~15%: 일부 차이 → 중간값 기준 판단
└ 🟠 15% 이상: 불확실 → 보수적으로 하단 기준 접근

━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ **주의사항**
━━━━━━━━━━━━━━━━━━━━━━━━
└ 본 분석은 기술적 지표 기반 참고용입니다
└ 급등락, 공시, 시장 급변 상황은 반영되지 않습니다
└ 최종 투자 결정은 반드시 본인 판단으로 하세요`;

            await message.reply(sellHelp);

        } else {
            const rawInput = message.content.trim().slice('!매도'.length).trim();
            const parts    = rawInput.split(/\s+/);

            // 마지막 토큰이 숫자면 매수가, 나머지 전체가 종목명 (공백 포함 종목명 지원)
            const lastPart = parts[parts.length - 1];
            const lastIsNumber = parts.length > 1 && /^[\d,]+$/.test(lastPart);
            const stockInput = lastIsNumber ? parts.slice(0, -1).join(' ') : rawInput;
            const buyPrice   = lastIsNumber ? Math.round(parseFloat(lastPart.replace(/,/g, ''))) : null;

            if (!stockInput) {
                await message.reply('사용법: `!매도종목명` 또는 `!매도종목명 매수가`\n예) `!매도삼성전자` 또는 `!매도삼성전자 70000`');
            } else {
                const KR_LIST       = require('./data/krWatchList');
                const KR_STOCK_LIST = require('./data/krStockList');
                let ticker = null, stockName = stockInput;
                const inputLower = stockInput.toLowerCase();

                if (/^\d{6}$/.test(stockInput)) {
                    ticker = stockInput;
                    const found = KR_LIST.find(s => s.ticker === stockInput)
                               || KR_STOCK_LIST.find(s => s.ticker === stockInput);
                    if (found) stockName = found.name;
                } else {
                    const found = KR_LIST.find(s =>
                                      s.name.toLowerCase() === inputLower ||
                                      s.name.toLowerCase().includes(inputLower)
                                  ) || KR_STOCK_LIST.find(s =>
                                      s.name.toLowerCase() === inputLower ||
                                      s.name.toLowerCase().includes(inputLower)
                                  );
                    if (found) { ticker = found.ticker; stockName = found.name; }
                }

                if (!ticker) {
                    await message.reply(`❌ "${stockInput}" 종목을 찾을 수 없습니다.\n티커 코드(6자리 숫자)로 직접 입력하거나 워치리스트에 없는 종목인지 확인해 주세요.`);
                } else {
                    console.log(`[${time}] 매도 분석 요청: ${stockName}(${ticker}) 매수가=${buyPrice ?? '없음'}`);
                    await message.reply(`📊 [${stockName}] 매도 타이밍 분석 중입니다... (약 20~30초 소요)`);
                    try {
                        const { analyzeSellSignals } = require('./services/screening/technicalService');
                        const { scrapeAnalystTarget } = require('./services/screening/naverScraper');
                        const { getKisAccessToken: getToken } = require('./kisAuth');

                        const token = await getToken();
                        const [signals, analystData] = await Promise.all([
                            analyzeSellSignals(ticker, token),
                            scrapeAnalystTarget(ticker),
                        ]);

                        if (!signals) {
                            await message.reply('❌ 가격 데이터를 가져올 수 없습니다.');
                        } else {
                            await discordService.sendSellAnalysisMessage(stockName, ticker, signals, analystData, buyPrice);
                            await message.reply(`✅ 분석 완료! 매도타이밍 채널을 확인해 주세요.`);
                        }
                    } catch (err) {
                        console.error(`[${time}] 매도 분석 실패:`, err.message);
                        await message.reply('❌ 분석 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.');
                    }
                }
            }
        }

    } else if (command.startsWith('!영욱문')) {
        const rawInput = message.content.trim().slice('!영욱문'.length).trim();

        if (command === '!영욱문리포트산업') {
            console.log(`[${time}] 유저 명령 수신: !영욱문리포트산업`);
            await message.reply('📊 [영욱문리포트산업] WiseReport 산업 리포트 서머리 수집 중입니다...');
            try {
                const { scrapeWiseReportIndustrySummary } = require('./services/screening/naverScraper');
                const reports = await scrapeWiseReportIndustrySummary();
                if (!reports.length) {
                    await message.reply('❌ 오늘 산업 리포트 데이터가 없습니다.');
                } else {
                    await discordService.sendWiseReportIndustrySummaryMessage(reports);
                    await message.reply(`✅ 완료! 영욱문 채널을 확인해 주세요.`);
                }
            } catch (err) {
                console.error(`[${time}] 영욱문리포트산업 실패:`, err.message);
                await message.reply('❌ 리포트 수집 중 오류가 발생했습니다.');
            }

        } else if (command === '!영욱문리포트') {
            console.log(`[${time}] 유저 명령 수신: !영욱문리포트`);
            await message.reply('📋 [영욱문리포트] WiseReport 기업 리포트 서머리 수집 중입니다...');
            try {
                const { scrapeWiseReportSummary } = require('./services/screening/naverScraper');
                const reports = await scrapeWiseReportSummary();
                if (!reports.length) {
                    await message.reply('❌ 오늘 리포트 데이터가 없습니다. (장 마감 후 또는 휴장일일 수 있습니다)');
                } else {
                    await discordService.sendWiseReportSummaryMessage(reports);
                    await message.reply(`✅ 완료! 영욱문 채널을 확인해 주세요.`);
                }
            } catch (err) {
                console.error(`[${time}] 영욱문리포트 실패:`, err.message);
                await message.reply('❌ 리포트 수집 중 오류가 발생했습니다.');
            }

        } else if (!rawInput) {
            await message.reply('사용법: `!영욱문종목명` 또는 `!영욱문티커`\n예) `!영욱문삼성전자` 또는 `!영욱문005930`');
        } else {
            const KR_LIST      = require('./data/krWatchList');
            const KR_STOCK_LIST = require('./data/krStockList');
            let ticker = null, stockName = rawInput;
            const inputLower = rawInput.toLowerCase();

            if (/^\d{6}$/.test(rawInput)) {
                ticker = rawInput;
                const found = KR_LIST.find(s => s.ticker === rawInput)
                           || KR_STOCK_LIST.find(s => s.ticker === rawInput);
                if (found) stockName = found.name;
            } else {
                const found = KR_LIST.find(s =>
                                  s.name.toLowerCase() === inputLower ||
                                  s.name.toLowerCase().includes(inputLower)
                              ) || KR_STOCK_LIST.find(s =>
                                  s.name.toLowerCase() === inputLower ||
                                  s.name.toLowerCase().includes(inputLower)
                              );
                if (found) { ticker = found.ticker; stockName = found.name; }
            }

            if (!ticker) {
                await message.reply(`❌ "${rawInput}" 종목을 찾을 수 없습니다.\n티커 코드(6자리 숫자)로 직접 입력해 주세요. 예) \`!영욱문005930\``);
            } else {
                console.log(`[${time}] 영욱문 분석 요청: ${stockName}(${ticker})`);
                await message.reply(`🔍 [${stockName}] 종목 분석 중입니다... (약 20~30초 소요)`);
                try {
                    const { analyzeTechnicals, getInvestorTrend, getStockCurrentPrice } = require('./services/screening/technicalService');
                    const { scrapeAnalystTarget, scrapeConsensus, scrapeDividendInfo } = require('./services/screening/naverScraper');
                    const { getKisAccessToken: getToken } = require('./kisAuth');

                    const token = await getToken();

                    // 워치리스트에 없는 종목(티커 직접 입력): KIS에서 종목명 조회
                    if (stockName === rawInput && /^\d{6}$/.test(stockName)) {
                        const priceInfo = await getStockCurrentPrice(ticker, token);
                        if (priceInfo?.name) stockName = priceInfo.name;
                    }

                    // KIS 호출(기술지표+수급)과 Naver 스크래핑을 병렬 실행
                    const [[tech, investor], [analystData, consensus, dividendInfo]] = await Promise.all([
                        (async () => {
                            const t   = await analyzeTechnicals(ticker, token);
                            const inv = await getInvestorTrend(ticker, token);
                            return [t, inv];
                        })(),
                        (async () => {
                            const a = await scrapeAnalystTarget(ticker, { maxDaysOld: null });
                            const c = await scrapeConsensus(ticker);
                            const d = await scrapeDividendInfo(ticker);
                            return [a, c, d];
                        })(),
                    ]);

                    await discordService.sendYoungookMessage(stockName, ticker, tech, investor, analystData, consensus, dividendInfo);
                    await message.reply(`✅ 분석 완료! 영욱문 채널을 확인해 주세요.`);
                } catch (err) {
                    console.error(`[${time}] 영욱문 분석 실패:`, err.message);
                    await message.reply('❌ 분석 중 오류가 발생했습니다. 콘솔 로그를 확인해 주세요.');
                }
            }
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

\`!영무문2\`
└ 네이버 종목분석 리포트 최근 90건 수집
└ 종목별 그룹핑 후 리포트 수 순위 + 목표주가 범위 표시

\`!영욱문종목명\` / \`!영욱문티커\`
└ 단일 종목 종합 심층 분석
└ 증권사 목표가(90일) · 컨센서스 영업이익 · PER/PBR 추이
└ MA정배열 · RSI · 골든크로스 · 외국인/기관 수급 동향
└ 예: \`!영욱문삼성전자\` 또는 \`!영욱문005930\`
└ 결과는 **영욱문** 채널로 전송

\`!영욱문리포트\`
└ 당일 WiseReport 기업 리포트 서머리
└ Buy 종목 상승여력 순 상위 10건 · 목표가/전일가/핵심요약 표시
└ 결과는 **영욱문** 채널로 전송

\`!영욱문리포트산업\`
└ 당일 WiseReport 산업 리포트 서머리
└ 투자의견 변경(상향↑/하향↓) 표시 · 핵심요약 2포인트 표시
└ 결과는 **영욱문** 채널로 전송

━━━━━━━━━━━━━━━━━━━━━━━━
📤 **매도 타이밍 분석**
━━━━━━━━━━━━━━━━━━━━━━━━
\`!매도종목명\` / \`!매도종목명 매수가\`
└ 1차/2차/3차 분할 매도가 + 손절 라인 분석
└ MA·피보나치·애널리스트 목표가 기반
└ 예: \`!매도삼성전자\` 또는 \`!매도삼성전자 70000\`
└ 결과는 **매도타이밍** 채널로 전송

━━━━━━━━━━━━━━━━━━━━━━━━
📌 \`!도움말\` 또는 \`!사용법\` 으로 이 화면을 다시 볼 수 있습니다.`;
        message.reply(helpText);
    }
});

// 💡 .env 금고에 넣어둔 토큰으로 디스코드 서버에 접속(로그인)합니다.
client.login(process.env.DISCORD_BOT_TOKEN);