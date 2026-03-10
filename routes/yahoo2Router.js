const express = require('express');
const router = express.Router();
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════
//  [내부 함수] 미국 주식 거래량 상위 30개 가져오기
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
//  [라우터] 🇺🇸 미국 주식 종가베팅 & 신고가 검색 API (/api/yahoo2/us-closing-bet)
// ════════════════════════════════════════════════════════
router.get('/us-closing-bet', async (req, res) => {
    console.log('👀 [DEBUG] 미국 주식 종가베팅 스캔 시작...');
    
    try {
        const topStocks = await getUsTopVolumeList();
        const candidates = [];

        if (topStocks.length === 0) {
            return res.json({ totalScanned: 0, candidates: [] });
        }

        for (const stock of topStocks) {
            try {
                // 티커 단건 상세 조회 (야후 파이낸스)
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
                        // 달러 포맷팅 ($1.5B, $300M)
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

                // 서버 보호 딜레이 (야후 서버가 차단하지 않도록 0.3초 대기)
                await delay(300);

            } catch (err) {
                console.error(`[${stock.ticker}] 상세 조회 실패:`, err.message);
            }
        }

        console.log(`✅ [DEBUG] 미국 주식 스캔 완료 (후보: ${candidates.length}건)`);
        
        // 프론트엔드로 최종 결과 JSON 응답
        res.json({
            success: true,
            totalScanned: topStocks.length,
            totalScanList: topStocks,
            count: candidates.length,
            candidates: candidates
        });

    } catch (error) {
        console.error("미국장 검색 라우터 에러:", error.message);
        res.status(500).json({ error: '미국 주식 데이터를 분석하는 중 오류가 발생했습니다.' });
    }
});

module.exports = router;