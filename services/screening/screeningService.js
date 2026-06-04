const { getKisAccessToken } = require('../../kisAuth');
const { getStockPool }       = require('./poolService');
const { analyzeTechnicals, getInvestorTrend } = require('./technicalService');
const { scrapeAnalystTarget, scrapeConsensus, delay } = require('./naverScraper');
const { calcScore, getGrade, gradeEmoji, SCORE_THRESHOLD } = require('./scoringEngine');
const KR_WATCH_LIST = require('../../data/krWatchList');

// 테스트용: 여기에 티커를 넣으면 해당 종목만 빠르게 처리 (풀 구성 생략)
// 빈 배열이면 정상 풀 스크리닝 실행
//const TEST_GOLDEN_CROSS_BYPASS = ['005930']; // 테스트 완료 후 [] 로 비워주세요
const TEST_GOLDEN_CROSS_BYPASS = [];

// ════════════════════════════════════════════════════════
// 전체 스크리닝 오케스트레이터
// ════════════════════════════════════════════════════════
async function runScreening() {
    console.log('\n🔍 [영무문] 종목 발굴 스크리닝 시작...');
    const startTime = Date.now();

    let pool;
    const isTestMode = TEST_GOLDEN_CROSS_BYPASS.length > 0;

    if (isTestMode) {
        // 테스트 모드: 지정 티커만 처리 (KIS 풀 조회 생략)
        console.log(`🧪 [테스트 모드] KIS 풀 생략 — 지정 종목만 처리: ${TEST_GOLDEN_CROSS_BYPASS.join(', ')}`);
        pool = TEST_GOLDEN_CROSS_BYPASS.map((ticker) => {
            const found = KR_WATCH_LIST.find((s) => s.ticker === ticker);
            return { ticker, name: found?.name ?? ticker, price: 0, _fromWatchList: true };
        });
    } else {
        // 정상 모드: 전체 풀 구성
        pool = await getStockPool();
        console.log(`📋 [1단계] 종목 풀 구성 완료: ${pool.length}개`);
        if (pool.length === 0) {
            console.warn('⚠️ 종목 풀이 비어있습니다. 장 마감 후 거래대금 조회 불가 상태일 수 있습니다.');
            return { totalScanned: 0, goldenCrossPass: 0, results: [] };
        }
    }

    const token = await getKisAccessToken();
    let goldenCrossPass = 0;
    const results = [];

    for (const stock of pool) {
        const ticker = stock.ticker;
        const name   = stock.name;
        console.log(`\n  🔎 [${name}(${ticker})] 분석 중...`);

        try {
            // 2단계: 기술적 지표 (일봉 2회 호출 + 투자자동향 1회)
            const tech = await analyzeTechnicals(ticker, token);

            // 골든크로스 미통과 → 즉시 제외 (테스트 우회 목록 제외)
            const isBypassed = TEST_GOLDEN_CROSS_BYPASS.includes(ticker);
            if (!tech.valid || (!tech.goldenCross && !isBypassed)) {
                console.log(`  ↳ 골든크로스 미통과 → 제외`);
                continue;
            }
            if (isBypassed && !tech.goldenCross) {
                console.log(`  ⚠️ [테스트] 골든크로스 우회 적용 (${ticker})`);
            }

            goldenCrossPass++;
            console.log(`  ✅ 골든크로스 통과! (MA5:${tech.ma5} / MA20:${tech.ma20} / MA60:${tech.ma60})`);

            await delay(1100);
            const investor = await getInvestorTrend(ticker, token);
            await delay(500);

            // 3단계: 네이버 목표가 스크래핑
            const analystData = await scrapeAnalystTarget(ticker);
            await delay(500);

            // 4단계: 네이버 컨센서스 스크래핑
            const consensusData = await scrapeConsensus(ticker);
            await delay(500);

            // 점수 산정
            const scoreData = {
                maAlignment:   tech.maAlignment,
                volumeSpike:   tech.volumeSpike,
                foreignBuy:    investor.foreignBuy,
                instBuy:       investor.instBuy,
                rsiMomentum:   tech.rsiMomentum,
                rsi:           tech.rsi,
                targetRaised:  analystData.targetRaised,
                targetDown:    analystData.targetDown,
                beatConsensus: consensusData.beatConsensus,
            };

            const { score, breakdown } = calcScore(scoreData);
            const grade = getGrade(score);

            console.log(`  📊 점수: ${score}/16점 (${grade || '미달'}) | ${breakdown.join(', ')}`);
            console.log(`     기술지표: 정배열=${tech.maAlignment} 거래량급증=${tech.volumeSpike} RSI=${tech.rsi}(${tech.rsiMomentum})`);
            console.log(`     투자자: 외국인=${investor.foreignBuy} 기관=${investor.instBuy}`);
            console.log(`     목표가: 상향=${analystData.targetRaised} 하향=${analystData.targetDown} (최근=${analystData.latestTarget} 이전=${analystData.prevTarget})`);
            console.log(`     컨센서스: 상회=${consensusData.beatConsensus} (실제=${consensusData.actual} 추정=${consensusData.consensus})`);

            // 테스트 우회 종목은 기준 미달이어도 디스코드로 디버그 결과 전송
            if (!grade) {
                if (isBypassed) {
                    results.push({
                        ticker, name, price: stock.price || tech.currentPrice || 0,
                        score, grade: 'DEBUG', breakdown,
                        tech, investor,
                        analyst: analystData,
                        consensus: consensusData,
                        _isDebug: true,
                    });
                }
                continue;
            }

            results.push({
                ticker,
                name,
                price: stock.price || tech.currentPrice || 0,
                score,
                grade,
                breakdown,
                tech,
                investor,
                analyst: analystData,
                consensus: consensusData,
            });

        } catch (err) {
            console.error(`  ❌ [${name}(${ticker})] 처리 중 오류:`, err.message);
        }
    }

    // 점수 내림차순 정렬
    results.sort((a, b) => b.score - a.score);

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n✅ [영무문] 스크리닝 완료 — 총 ${pool.length}개 스캔 / 골든크로스 통과: ${goldenCrossPass}개 / 최종: ${results.length}개 (${elapsed}초 소요)`);

    return {
        totalScanned: pool.length,
        goldenCrossPass,
        results,
        elapsedSec: elapsed,
    };
}

module.exports = { runScreening };
