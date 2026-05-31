const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════
// [내부 함수] 미국 주식 목록 가져오기
// Yahoo Finance screener API가 인증 오류를 일으키므로
// data/usWatchList.js 200개 고정 리스트로 quote 조회 방식 사용
// ════════════════════════════════════════════════════════
const US_WATCH_LIST = require('../data/usWatchList');

async function getUsTopVolumeList(limit = US_WATCH_LIST.length) {
    try {
        const results = [];
        const targetList = US_WATCH_LIST.slice(0, limit);
        for (let i = 0; i < targetList.length; i++) {
            const watchItem = targetList[i];
            const ticker = watchItem.ticker;
            try {
                const quote = await yahooFinance.quote(ticker);
                if (quote && quote.regularMarketPrice) {
                    results.push({
                        rank: i + 1,
                        ticker: quote.symbol,
                        excd: watchItem.excd,
                        name: quote.shortName || quote.longName || ticker,
                        marketType: 'US',
                        price: quote.regularMarketPrice,
                        changeRate: quote.regularMarketChangePercent,
                        volume: quote.regularMarketVolume,
                        marketCap: quote.marketCap
                    });
                } else {
                    console.warn(`  [${ticker}] 제외됨 - regularMarketPrice 없음 (상장폐지 또는 데이터 없음)`);
                }
            } catch (err) {
                console.error(`[${ticker}] quote 조회 실패:`, err.message);
            }
            await delay(200);
        }
        console.log(`✅ 미국 주식 목록 조회 완료 (${results.length}건)`);
        return results;
    } catch (err) {
        console.error("미국 주식 랭킹 조회 실패:", err.message);
        return [];
    }
}

// ════════════════════════════════════════════════════════
// [서비스 로직 1] 미국 주식 종가베팅 & 신고가 필터링
// ════════════════════════════════════════════════════════
async function getUsClosingBetList() {
    console.log('👀 [DEBUG] 미국 주식 종가베팅 스캔 시작...');

    const topStocks = await getUsTopVolumeList();
    const candidates = [];

    if (topStocks.length === 0) return { totalScanned: 0, totalScanList: [], candidates: [] };

    for (const stock of topStocks) {
        try {
            const quote = await yahooFinance.quote(stock.ticker);

            if (quote) {
                const price = quote.regularMarketPrice;
                const highPrice = quote.regularMarketDayHigh;
                const lowPrice = quote.regularMarketDayLow;
                const w52HighPrice = quote.fiftyTwoWeekHigh;
                const totalPrice = quote.marketCap;

                let positionRatio = 0;
                if (highPrice != null && lowPrice != null && highPrice !== lowPrice) {
                    positionRatio = (price - lowPrice) / (highPrice - lowPrice);
                } else if (quote.regularMarketChangePercent > 0) {
                    positionRatio = 1;
                }

                // 기준선: 시총 1억 달러 (약 1,300억 원)
                const MIN_US_TOTAL_PRICE = 100000000;

                console.log(`  [${stock.ticker}] price=${price}, high=${highPrice}, low=${lowPrice}, posRatio=${positionRatio.toFixed(2)}, w52H=${w52HighPrice}, mktCap=${totalPrice}`);

                const isClosingBet = positionRatio > 0.8 && totalPrice != null && totalPrice >= MIN_US_TOTAL_PRICE;
                const isNewHighBreakout = price != null && w52HighPrice != null && price >= w52HighPrice && totalPrice != null && totalPrice >= MIN_US_TOTAL_PRICE;

                if (isClosingBet || isNewHighBreakout) {
                    const billion = Math.floor(totalPrice / 1000000000);
                    const formattedTotalPrice = billion > 0
                        ? `$${billion}B`
                        : `$${Math.floor(totalPrice / 1000000)}M`;

                    candidates.push({
                        ...stock,
                        price: price,
                        highPrice: highPrice,
                        lowPrice: lowPrice,
                        positionRatioPercent: (positionRatio * 100).toFixed(1),
                        totalPrice: totalPrice,
                        totalPriceFormatted: formattedTotalPrice,
                        dataFg: isNewHighBreakout ? '신고가돌파' : '종가베팅',
                        w52HighPrice: w52HighPrice
                    });
                }
            }

            await delay(500);

        } catch (err) {
            console.error(`[${stock.ticker}] 상세 조회 실패:`, err.message);
        }
    }

    console.log(`✅ [DEBUG] 미국 주식 종가베팅 스캔 완료 (후보: ${candidates.length}건)`);
    return {
        totalScanned: topStocks.length,
        totalScanList: topStocks,
        candidates: candidates
    };
}

// ════════════════════════════════════════════════════════
// [서비스 로직 2] 미국 주식 엔벨로프 하한선(낙폭과대) 필터링
// 20일 이동평균선의 -4% 지점 이하로 내려온 종목 포착
// ════════════════════════════════════════════════════════
async function getUsEnvelopeBetList(limit = 200) {
    console.log(`👀 [DEBUG] 미국 주식 엔벨로프 하한선 스캔 시작... (${limit}개)`);

    const topStocks = await getUsTopVolumeList(limit);
    const candidates = [];

    if (topStocks.length === 0) return { totalScanned: 0, totalScanList: [], candidates: [] };

    console.log(`👀 [DEBUG] 총 ${topStocks.length}건 스캔 중...`);

    for (const stock of topStocks) {
        try {
            // 최근 30일치 일봉 데이터 조회
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 45); // 여유있게 45일치 요청

            const chartResult = await yahooFinance.chart(stock.ticker, {
                period1: startDate,
                period2: endDate,
                interval: '1d'
            });

            // 장 중 당일 캔들은 close가 null일 수 있으므로 유효한 데이터만 사용
            const validData = chartResult?.quotes ? chartResult.quotes.filter(d => d.close !== null) : [];

            if (validData.length >= 20) {
                // 가장 최근 날짜 기준으로 정렬 (내림차순)
                const sorted = [...validData].sort((a, b) => new Date(b.date) - new Date(a.date));

                // 20일 이동평균선 계산
                // 단순 종가(close)가 아니라, 액면분할과 배당락이 모두 반영된 **수정주가(adjclose)**를 사용해야.. (반드시 '수정주가' 사용!)
                let sum = 0;
                for (let i = 0; i < 20; i++) {
                    // adjclose가 있으면 쓰고, 없으면 close를 쓰는 안전장치
                    const priceToUse = sorted[i].adjclose ? sorted[i].adjclose : sorted[i].close;
                    sum += priceToUse;
                }
                const ma20 = sum / 20;

                // 엔벨로프 하한선 계산 (20일선의 -10%, 미국주식 변동성 반영)
                const envelopeRate = 0.10;
                const lowerBand = ma20 * (1 - envelopeRate);

                const currentPrice = stock.price;
                const marketCap = stock.marketCap;

                // 기준선: 시총 6억 달러 이상 (9천억 정도)
                const MIN_US_MARKET_CAP = 600000000;

                if (marketCap && currentPrice <= lowerBand && marketCap >= MIN_US_MARKET_CAP) {
                    const billion = Math.floor(marketCap / 1000000000);
                    const formattedTotalPrice = billion > 0
                        ? `$${billion}B`
                        : `$${Math.floor(marketCap / 1000000)}M`;

                    candidates.push({
                        ...stock,
                        ma20: parseFloat(ma20.toFixed(2)),
                        lowerBand: parseFloat(lowerBand.toFixed(2)),
                        totalPriceFormatted: formattedTotalPrice,
                        gapFromLowerBand: (((currentPrice / lowerBand) - 1) * 100).toFixed(2),
                        dataFg: '엔벨하한'
                    });
                }
            }

            await delay(300);

        } catch (err) {
            console.error(`[${stock.ticker}] 일봉 데이터 조회 실패:`, err.message);
        }
    }

    console.log(`✅ [DEBUG] 미국 주식 엔벨로프 스캔 완료 (후보: ${candidates.length}건)`);
    return {
        totalScanned: topStocks.length,
        totalScanList: topStocks,
        candidates: candidates
    };
}

// ════════════════════════════════════════════════════════
// [공통] RSI(14) 계산 함수
// closePrices: 최신순 배열 [오늘, 어제, ...]
// ════════════════════════════════════════════════════════
function calcRSI(closePrices, period = 14) {
    if (closePrices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = closePrices[i - 1] - closePrices[i];
        if (diff > 0) gains += diff;
        else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return parseFloat((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));
}

// ════════════════════════════════════════════════════════
// [서비스] 미국주식 RSI 과매도 종목 스캔 (Yahoo chart 로컬 호출)
// ════════════════════════════════════════════════════════
async function getUsRsiList(limit = 200, rsiThreshold = 30) {
    console.log(`👀 [DEBUG] 미국주식 RSI 과매도 스캔 시작... (${limit}개 / 기준: RSI <= ${rsiThreshold})`);

    const topStocks = await getUsTopVolumeList(limit);
    const candidates = [];

    for (const stock of topStocks) {
        try {
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 45);

            const chartResult = await yahooFinance.chart(stock.ticker, {
                period1: startDate,
                period2: endDate,
                interval: '1d'
            });

            const validData = chartResult?.quotes?.filter(d => d.close !== null) || [];

            if (validData.length >= 15) {
                const sorted = [...validData].sort((a, b) => new Date(b.date) - new Date(a.date));
                const closePrices = sorted.map(d => d.adjclose || d.close);
                const rsi = calcRSI(closePrices);

                if (rsi !== null && rsi <= rsiThreshold) {
                    const marketCap = stock.marketCap;
                    const billion = marketCap ? Math.floor(marketCap / 1000000000) : 0;
                    const formattedTotalPrice = marketCap
                        ? (billion > 0 ? `$${billion}B` : `$${Math.floor(marketCap / 1000000)}M`)
                        : 'N/A';

                    candidates.push({
                        ...stock,
                        rsi,
                        totalPriceFormatted: formattedTotalPrice,
                        dataFg: 'RSI과매도'
                    });
                }
            }

            await delay(300);
        } catch (err) {
            console.error(`[${stock.ticker}] RSI 조회 실패:`, err.message);
        }
    }

    console.log(`✅ [DEBUG] 미국주식 RSI 스캔 완료 (후보: ${candidates.length}건)`);
    return { totalScanned: topStocks.length, candidates };
}

// ════════════════════════════════════════════════════════
// [서비스] JYP 픽 관심종목 현재 시세 조회
// 필터 없이 전종목 현황 반환 (섹터 정보 포함)
// ════════════════════════════════════════════════════════
const JYP_PICK_LIST = require('../data/jypPickList');

async function getJypPicksStatus() {
    console.log(`👀 [DEBUG] JYP 픽 시세 조회 시작... (${JYP_PICK_LIST.length}개)`);
    const results = [];

    for (const item of JYP_PICK_LIST) {
        try {
            const quote = await yahooFinance.quote(item.ticker);
            if (quote && quote.regularMarketPrice) {
                const price = quote.regularMarketPrice;
                const changeRate = quote.regularMarketChangePercent ?? 0;
                const w52High = quote.fiftyTwoWeekHigh;

                // 52주 고가 대비 현재가 위치 (%)
                const fromHigh = w52High
                    ? (((price / w52High) - 1) * 100).toFixed(1)
                    : null;

                results.push({
                    ticker: item.ticker,
                    name: item.name,
                    sector: item.sector,
                    marketType: 'US',
                    price,
                    changeRate: parseFloat(changeRate.toFixed(2)),
                    w52High,
                    fromHigh,   // 52주 고가 대비 (음수 = 고점 아래)
                });
            } else {
                console.warn(`  [${item.ticker}] 시세 없음`);
            }
        } catch (err) {
            console.error(`[${item.ticker}] JYP 시세 조회 실패:`, err.message);
        }
        await delay(200);
    }

    console.log(`✅ [DEBUG] JYP 픽 조회 완료 (${results.length}건)`);
    return results;
}

// ════════════════════════════════════════════════════════
// [서비스] JYP 픽 당일 분봉 최저가 근접 감지
// Yahoo Finance 5분봉으로 오늘 장중 최저가를 계산하고
// 현재가가 그 최저가 대비 threshold% 이내인 종목 반환
// ════════════════════════════════════════════════════════
// 미국 동부시간 DST 여부 판별 (2nd Sunday of March ~ 1st Sunday of November)
function isUSEasternDST(date) {
    const year = date.getFullYear();
    const marchFirst = new Date(Date.UTC(year, 2, 1));
    const dstStart = new Date(Date.UTC(year, 2, 8 + (7 - marchFirst.getUTCDay()) % 7, 7)); // 2nd Sun Mar 02:00 EST
    const novFirst = new Date(Date.UTC(year, 10, 1));
    const dstEnd   = new Date(Date.UTC(year, 10, 1 + (7 - novFirst.getUTCDay()) % 7, 6));  // 1st Sun Nov 02:00 EDT
    return date >= dstStart && date < dstEnd;
}

async function getJypIntradayLowAlert(threshold = 3) {
    console.log(`👀 [DEBUG] JYP 픽 당일 분봉 저점 감지 시작... (최저가 ±${threshold}% 이내)`);
    const alerts = [];

    for (const item of JYP_PICK_LIST) {
        try {
            // 서머타임: NYSE 09:30 ET = 13:30 UTC / 겨울타임: 09:30 ET = 14:30 UTC
            const now = new Date();
            const todayStart = new Date(now);
            const isDST = isUSEasternDST(now);
            todayStart.setUTCHours(isDST ? 13 : 14, 30, 0, 0);
            console.log(`  [${item.ticker}] 장시작 기준: ${isDST ? '서머타임(13:30 UTC)' : '겨울타임(14:30 UTC)'}`);

            const chartResult = await yahooFinance.chart(item.ticker, {
                period1: todayStart,
                period2: now,
                interval: '5m'
            });

            const bars = chartResult?.quotes?.filter(d => d.low != null && d.close != null) || [];

            if (bars.length === 0) {
                console.warn(`  [${item.ticker}] 오늘 분봉 데이터 없음 (장 마감 또는 휴장)`);
                continue;
            }

            // 당일 분봉 최저가 (low 기준)
            const intradayLow = Math.min(...bars.map(d => d.low));
            // 현재가: 마지막 봉의 close
            const currentPrice = bars[bars.length - 1].close;

            // 현재가가 최저가 대비 얼마나 위에 있는지 (%)
            const gapFromLow = ((currentPrice - intradayLow) / intradayLow) * 100;

            console.log(`  [${item.ticker}] 현재가: $${currentPrice}, 당일저점: $${intradayLow.toFixed(2)}, 저점대비: +${gapFromLow.toFixed(2)}%`);

            if (gapFromLow <= threshold) {
                alerts.push({
                    ticker: item.ticker,
                    name: item.name,
                    sector: item.sector,
                    marketType: 'US',
                    price: currentPrice,
                    intradayLow: parseFloat(intradayLow.toFixed(2)),
                    gapFromLow: parseFloat(gapFromLow.toFixed(2)),
                    barsCount: bars.length,
                });
            }

            await delay(300);
        } catch (err) {
            console.error(`[${item.ticker}] 분봉 조회 실패:`, err.message);
        }
    }

    console.log(`✅ [DEBUG] JYP 분봉 저점 감지 완료 (저점근접: ${alerts.length}건)`);
    return alerts;
}

module.exports = {
    getUsTopVolumeList,
    getUsClosingBetList,
    getUsEnvelopeBetList,
    getUsRsiList,
    getJypPicksStatus,
    getJypIntradayLowAlert
};
