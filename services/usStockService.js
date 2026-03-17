const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════
// [내부 함수] 미국 주식 거래량 상위 30개 가져오기
// ════════════════════════════════════════════════════════
async function getUsTopVolumeList() {
    try {
        const result = await yahooFinance.screener({ scrIds: 'most_actives', count: 30 });
        const rawData = result.quotes;

        if (!rawData || rawData.length === 0) return [];

        return rawData.map((stock, index) => ({
            rank: index + 1,
            ticker: stock.symbol,
            name: stock.shortName,
            marketType: 'US',
            price: stock.regularMarketPrice,
            changeRate: stock.regularMarketChangePercent,
            volume: stock.regularMarketVolume,
            marketCap: stock.marketCap
        }));
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
                if (highPrice !== lowPrice) {
                    positionRatio = (price - lowPrice) / (highPrice - lowPrice);
                } else if (quote.regularMarketChangePercent > 0) {
                    positionRatio = 1;
                }

                // 기준선: 시총 1억 달러 (약 1,300억 원)
                const MIN_US_TOTAL_PRICE = 100000000;

                const isClosingBet = positionRatio > 0.8 && totalPrice >= MIN_US_TOTAL_PRICE;
                const isNewHighBreakout = price >= w52HighPrice && totalPrice >= MIN_US_TOTAL_PRICE;

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
async function getUsEnvelopeBetList() {
    console.log('👀 [DEBUG] 미국 주식 엔벨로프 하한선 스캔 시작...');

    const topStocks = await getUsTopVolumeList();
    const candidates = [];

    if (topStocks.length === 0) return { totalScanned: 0, totalScanList: [], candidates: [] };

    console.log(`👀 [DEBUG] 총 ${topStocks.length}건 스캔 중...`);

    for (const stock of topStocks) {
        try {
            // 최근 30일치 일봉 데이터 조회
            const endDate = new Date();
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - 45); // 여유있게 45일치 요청

            const historicalData = await yahooFinance.historical(stock.ticker, {
                period1: startDate,
                period2: endDate,
                interval: '1d'
            });

            if (historicalData && historicalData.length >= 20) {
                // 가장 최근 날짜 기준으로 정렬 (내림차순)
                const sorted = [...historicalData].sort((a, b) => new Date(b.date) - new Date(a.date));

                // 20일 이동평균선 계산
                let sum = 0;
                for (let i = 0; i < 20; i++) {
                    sum += sorted[i].close;
                }
                const ma20 = sum / 20;

                // 엔벨로프 하한선 계산 (20일선의 -10%, 미국주식 변동성 반영)
                const envelopeRate = 0.10;
                const lowerBand = ma20 * (1 - envelopeRate);

                const currentPrice = stock.price;
                const marketCap = stock.marketCap;

                // 기준선: 시총 10억 달러 이상
                const MIN_US_MARKET_CAP = 1000000000;

                if (currentPrice <= lowerBand && marketCap >= MIN_US_MARKET_CAP) {
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

module.exports = {
    getUsTopVolumeList,
    getUsClosingBetList,
    getUsEnvelopeBetList
};
