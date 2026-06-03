const { getTopVolumeList } = require('../kisService');
const KR_WATCH_LIST = require('../../data/krWatchList');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ════════════════════════════════════════════════════════
// 종목 풀 구성
// A. KIS 거래대금 상위 (동적): KOSPI 30 + KOSDAQ 30
// B. 고정 워치리스트 (정적): data/krWatchList.js
// 두 리스트 합산 후 중복 제거
// ════════════════════════════════════════════════════════
async function getStockPool() {
    // A. 동적 풀
    const kospiStocks = await getTopVolumeList('KOSPI');
    await delay(1100);
    const kosdaqStocks = await getTopVolumeList('KOSDAQ');

    // B. 동적 풀에 이미 있는 티커를 워치리스트에서 사전 제거
    const dynamicTickers = new Set([...kospiStocks, ...kosdaqStocks].map((s) => s.ticker));
    const uniqueWatchList = KR_WATCH_LIST
        .filter((item) => !dynamicTickers.has(item.ticker))
        .map((item) => ({
            ticker: item.ticker,
            name: item.name,
            sector: item.sector,
            price: 0,        // 실제 가격은 technicalService에서 일봉 조회 시 확보
            tradeValue: 0,   // 거래대금 없음 → 정렬 시 후순위
            _fromWatchList: true,
        }));

    // 동적 풀(거래대금 순) + 워치리스트(중복 제거된) 순서로 합산
    const pool = [...kospiStocks, ...kosdaqStocks, ...uniqueWatchList]
        .sort((a, b) => b.tradeValue - a.tradeValue);

    const dupCount = KR_WATCH_LIST.length - uniqueWatchList.length;
    console.log(`  📋 동적 풀: ${kospiStocks.length + kosdaqStocks.length}개 / 워치리스트: ${uniqueWatchList.length}개 (중복제거 ${dupCount}개) / 최종: ${pool.length}개`);
    return pool;
}

module.exports = { getStockPool };
