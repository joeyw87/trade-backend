const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════
// [내부 함수] 미국 주식 거래량 상위 종목 가져오기
// Yahoo Finance screener API가 인증 오류를 일으키므로
// 고정 티커 리스트로 quote 조회 방식으로 대체
// ════════════════════════════════════════════════════════
const US_TOP_TICKERS = [
    'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'TSLA', 'AVGO', 'AMD',
    'PLTR', 'INTC', 'ORCL', 'NFLX', 'CRM', 'UBER', 'SHOP', 'SOFI', 'SMCI',
    'ARM', 'MU', 'MRVL', 'AMAT', 'PANW', 'SNOW', 'COIN', 'RBLX', 'MSTR',
    'SQ', 'HOOD', 'RIVN', 'LCID', 'NIO', 'BABA', 'JD', 'SNAP', 'PINS',
    'LYFT', 'DASH', 'ABNB', 'SPOT', 'PYPL', 'AFRM', 'UPST', 'U', 'DKNG',
    'SIRI', 'F', 'GM', 'BAC', 'C'
];

async function getUsTopVolumeList() {
    try {
        const results = [];
        for (let i = 0; i < US_TOP_TICKERS.length; i++) {
            const ticker = US_TOP_TICKERS[i];
            try {
                const quote = await yahooFinance.quote(ticker);
                if (quote && quote.regularMarketPrice) {
                    results.push({
                        rank: i + 1,
                        ticker: quote.symbol,
                        name: quote.shortName || quote.longName || ticker,
                        marketType: 'US',
                        price: quote.regularMarketPrice,
                        changeRate: quote.regularMarketChangePercent,
                        volume: quote.regularMarketVolume,
                        marketCap: quote.marketCap
                    });
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

module.exports = {
    getUsTopVolumeList,
    getUsClosingBetList,
    getUsEnvelopeBetList
};
