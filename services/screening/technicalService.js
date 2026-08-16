const axios = require('axios');
const { getKisAccessToken, KIS_DOMAIN } = require('../../kisAuth');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const getKisHeaders = (token, tr_id) => ({
    authorization: `Bearer ${token}`,
    appkey: process.env.KIS_APP_KEY,
    appsecret: process.env.KIS_APP_SECRET,
    tr_id,
    custtype: 'P',
});

// ════════════════════════════════════════════════════════
// 일봉 데이터 조회 (FHKST01010400)
// 5회 호출로 약 150거래일(7개월)치 확보
// KIS API는 1회당 최대 30거래일 반환 → 30일 간격으로 end date를 앞당겨 페이지네이션
// ════════════════════════════════════════════════════════
async function getDailyPrices(ticker, token) {
    const CALLS = 5;           // 호출 횟수 (5 × 30 = 150거래일 ≈ 7개월)
    const DAYS_PER_CALL = 42;  // 호출 간격 (calendar days, 30거래일 ≈ 42일)

    const fetchPrices = async (endDateStr) => {
        const params = {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_INPUT_ISCD: ticker,
            FID_ORG_ADJ_PRC: '1',
            FID_PERIOD_DIV_CODE: 'D',
        };
        if (endDateStr) params.FID_INPUT_DATE_1 = endDateStr;

        try {
            const res = await axios.get(
                `${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/inquire-daily-price`,
                { headers: getKisHeaders(token, 'FHKST01010400'), params }
            );
            return res.data.output || [];
        } catch (err) {
            console.warn(`  [${ticker}] 일봉 조회 실패:`, err.response?.data?.msg1 || err.message);
            return [];
        }
    };

    const allData = [];
    for (let i = 0; i < CALLS; i++) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() - i * DAYS_PER_CALL);
        const endDateStr = i === 0 ? null : endDate.toISOString().slice(0, 10).replace(/-/g, '');
        const batch = await fetchPrices(endDateStr);
        allData.push(...batch);
        await delay(1100);
    }

    // 중복 제거 후 최신순 정렬
    const seen = new Set();
    return allData
        .filter((d) => {
            if (seen.has(d.stck_bsop_date)) return false;
            seen.add(d.stck_bsop_date);
            return true;
        })
        .sort((a, b) => b.stck_bsop_date.localeCompare(a.stck_bsop_date));
}

// ════════════════════════════════════════════════════════
// 이동평균 계산 (prices: 최신순 배열)
// ════════════════════════════════════════════════════════
function calcMA(prices, period) {
    if (prices.length < period) return null;
    const sum = prices.slice(0, period).reduce((acc, d) => acc + Number(d.stck_clpr), 0);
    return sum / period;
}

// ════════════════════════════════════════════════════════
// RSI(14) 계산
// ════════════════════════════════════════════════════════
function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = Number(prices[i - 1].stck_clpr) - Number(prices[i].stck_clpr);
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));
}

// ════════════════════════════════════════════════════════
// 골든크로스 감지: 최근 150거래일(7개월) 내
// MA5(5일선)가 MA20(20일선)을 하향에서 상향 돌파한 날이 있는지
// ════════════════════════════════════════════════════════
function checkGoldenCross(prices) {
    if (prices.length < 21) return false; // MA20 계산 최소 데이터
    const searchDays = Math.min(prices.length - 1, 5); // 최근 5거래일 탐색
    for (let i = 0; i < searchDays; i++) {
        const ma5Today  = calcMA(prices.slice(i), 5);
        const ma20Today = calcMA(prices.slice(i), 20);
        const ma5Prev   = calcMA(prices.slice(i + 1), 5);
        const ma20Prev  = calcMA(prices.slice(i + 1), 20);
        if (!ma5Today || !ma20Today || !ma5Prev || !ma20Prev) continue;
        if (ma5Prev < ma20Prev && ma5Today > ma20Today) return true;
    }
    return false;
}

// ════════════════════════════════════════════════════════
// 주가 모멘텀 — 기간별 수익률 (prices: 최신순 배열)
// ════════════════════════════════════════════════════════
function calcMomentum(prices) {
    const current = Number(prices[0].stck_clpr);
    const r = (idx) => prices.length > idx
        ? parseFloat(((current / Number(prices[idx].stck_clpr) - 1) * 100).toFixed(1))
        : null;
    return { w1: r(5), m1: r(20), m3: r(60) };  // 1주(5일) / 1개월(20일) / 3개월(60일)
}

// ════════════════════════════════════════════════════════
// 볼린저밴드 (20일, 2σ)
// ════════════════════════════════════════════════════════
function calcBollinger(prices, period = 20) {
    if (prices.length < period) return null;
    const closes = prices.slice(0, period).map(d => Number(d.stck_clpr));
    const ma  = closes.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(closes.reduce((s, p) => s + Math.pow(p - ma, 2), 0) / period);
    const upper = Math.round(ma + 2 * std);
    const lower = Math.round(ma - 2 * std);
    const mid   = Math.round(ma);
    const current  = Number(prices[0].stck_clpr);
    const position = upper !== lower ? Math.round((current - lower) / (upper - lower) * 100) : 50;
    return { upper, mid, lower, position };
}

// ════════════════════════════════════════════════════════
// 기술적 지표 종합 분석
// ════════════════════════════════════════════════════════
async function analyzeTechnicals(ticker, token) {
    const prices = await getDailyPrices(ticker, token);

    if (prices.length < 22) {
        return { valid: false, goldenCross: false };
    }

    const goldenCross = checkGoldenCross(prices);

    const ma5  = calcMA(prices, 5);
    const ma20 = calcMA(prices, 20);
    const ma60 = prices.length >= 60 ? calcMA(prices, 60) : null;

    // 이동평균 정배열: MA5 > MA20 > MA60 (데이터 충분 시)
    let maAlignment = ma5 != null && ma20 != null && ma5 > ma20;
    if (ma60 != null) maAlignment = maAlignment && ma20 > ma60;

    // 거래량 급증: 최근 5일 평균 / 20일 평균 >= 1.5
    const getVol = (d) => Number(d.acml_vol || d.stck_vol || 0);
    const vol5  = prices.slice(0, 5).reduce((s, d) => s + getVol(d), 0) / 5;
    const vol20 = prices.slice(0, 20).reduce((s, d) => s + getVol(d), 0) / 20;
    const volumeSpike = vol20 > 0 && vol5 / vol20 >= 1.3;

    // RSI 모멘텀: 50 이상 65 이하
    const rsi = calcRSI(prices);
    const rsiMomentum = rsi !== null && rsi >= 50 && rsi <= 65;

    const momentum  = calcMomentum(prices);
    const bollinger = calcBollinger(prices);

    return {
        valid: true,
        goldenCross,
        maAlignment,
        volumeSpike,
        rsi,
        rsiMomentum,
        currentPrice: Number(prices[0]?.stck_clpr) || 0,
        ma5:  ma5  ? Math.round(ma5)  : null,
        ma20: ma20 ? Math.round(ma20) : null,
        ma60: ma60 ? Math.round(ma60) : null,
        momentum,
        bollinger,
    };
}

// ════════════════════════════════════════════════════════
// 외국인/기관 투자자 동향 (FHKST01010900)
// 최근 3일 연속 순매수 여부 체크
// ════════════════════════════════════════════════════════
async function getInvestorTrend(ticker, token) {
    try {
        const res = await axios.get(
            `${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/inquire-investor`,
            {
                headers: getKisHeaders(token, 'FHKST01010900'),
                params: {
                    FID_COND_MRKT_DIV_CODE: 'J',
                    FID_INPUT_ISCD: ticker,
                },
            }
        );

        const data = res.data.output;
        if (!Array.isArray(data) || data.length < 3) {
            return { foreignBuy: false, instBuy: false };
        }

        const recent3 = data.slice(0, 3);
        const foreignBuy = recent3.every((d) => Number(d.frgn_ntby_qty || 0) > 0);
        const instBuy    = recent3.every((d) => Number(d.orgn_ntby_qty || 0) > 0);

        return { foreignBuy, instBuy };
    } catch (err) {
        console.warn(`  [${ticker}] 투자자동향 조회 실패:`, err.response?.data?.msg1 || err.message);
        return { foreignBuy: false, instBuy: false };
    }
}

// ════════════════════════════════════════════════════════
// 현재가 단일 조회 (FHKST01010100) — 영무문2용 경량 호출
// ════════════════════════════════════════════════════════
async function getStockCurrentPrice(ticker, token) {
    try {
        const res = await axios.get(
            `${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/inquire-price`,
            {
                headers: getKisHeaders(token, 'FHKST01010100'),
                params: { FID_COND_MRKT_DIV_CODE: 'J', FID_INPUT_ISCD: ticker },
            }
        );
        const o = res.data.output;
        if (!o) return null;
        return {
            name:       o.hts_kor_isnm?.trim() || null,
            price:      Number(o.stck_prpr),
            changeRate: Number(o.prdy_ctrt),
        };
    } catch (err) {
        console.warn(`  [${ticker}] 현재가 조회 실패:`, err.response?.data?.msg1 || err.message);
        return null;
    }
}

// ════════════════════════════════════════════════════════
// 매도 타이밍 분석 — 저항선·피보나치·RSI 종합
// ════════════════════════════════════════════════════════
async function analyzeSellSignals(ticker, token) {
    const prices = await getDailyPrices(ticker, token);
    if (prices.length < 22) return null;

    const currentPrice = Number(prices[0].stck_clpr);

    const ma20  = prices.length >= 20  ? Math.round(calcMA(prices, 20))  : null;
    const ma60  = prices.length >= 60  ? Math.round(calcMA(prices, 60))  : null;
    const ma120 = prices.length >= 120 ? Math.round(calcMA(prices, 120)) : null;
    const ma240 = prices.length >= 240 ? Math.round(calcMA(prices, 240)) : null;
    const rsi   = calcRSI(prices);

    // 최근 고점 / 저점 (수집된 전체 데이터 기준, 약 7개월)
    const recentHigh = Math.max(...prices.map(d => Number(d.stck_hgpr || d.stck_clpr)));
    const recentLow  = Math.min(...prices.map(d => Number(d.stck_lwpr || d.stck_clpr)));

    // 피보나치 확장 (최근 저점 → 최근 고점 기준)
    const fibRange = recentHigh - recentLow;
    const fib382 = Math.round(recentHigh + fibRange * 0.382);
    const fib618 = Math.round(recentHigh + fibRange * 0.618);
    const fib100 = Math.round(recentHigh + fibRange * 1.0);

    return { currentPrice, ma20, ma60, ma120, ma240, rsi, recentHigh, recentLow, fib382, fib618, fib100 };
}

module.exports = { analyzeTechnicals, getInvestorTrend, getStockCurrentPrice, analyzeSellSignals };
