const axios = require('axios');
const { getKisAccessToken } = require('../kisAuth');

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ════════════════════════════════════════════════════════
// 💡 공통 설정 (도메인 & 헤더 생성기)
// ════════════════════════════════════════════════════════
const KIS_DOMAIN = 'https://openapivts.koreainvestment.com:29443';

// 토큰과 TR_ID만 넣으면 KIS가 원하는 헤더를 찍어내는 공용 함수
const getKisHeaders = (token, tr_id) => ({
    'authorization': `Bearer ${token}`,
    'appkey': process.env.KIS_APP_KEY,
    'appsecret': process.env.KIS_APP_SECRET,
    'tr_id': tr_id,
    'custtype': 'P'
});


// ════════════════════════════════════════════════════════
// [서비스 로직 1] KIS API 거래대금 상위 종목 리스트 가져오기 (최대 30개)
// ════════════════════════════════════════════════════════
async function getTopVolumeList(marketType = 'ALL', exclCode = '111111111') {
    const token = await getKisAccessToken();

    //marketType 구분
    let marketIscd = '0000'; //전체
    if (marketType === 'KOSPI') marketIscd = '0001';
    else if (marketType === 'KOSDAQ') marketIscd = '1001';

    const requestParam = {
        headers: getKisHeaders(token, 'FHPST01710000'), // 공통 헤더
        params: {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_COND_SCR_DIV_CODE: '20171',
            FID_INPUT_ISCD: marketIscd, // 0000: 전체, 0001: 코스피, 1001: 코스닥
            FID_DIV_CLS_CODE: '0',
            FID_BLNG_CLS_CODE: '0',
            FID_TRGT_CLS_CODE: '111111111',
            FID_TRGT_EXLS_CLS_CODE: exclCode,
            FID_INPUT_PRICE_1: '',
            FID_INPUT_PRICE_2: '',
            FID_VOL_CNT: '',
            FID_INPUT_DATE_1: ''
        }
    };

    //디버그 모드일 때만 파라미터 출력
    if (process.env.DEBUG_MODE === 'true') {
        console.log('=================================================');
        console.log('👀 [DEBUG] KIS 거래대금 상위 API 요청 파라미터');
        console.log(JSON.stringify(requestParam.params));
        console.log('=================================================');
    }

    const response = await axios.get(`${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/volume-rank`, requestParam);
    const rawData = response.data.output;

    if (process.env.DEBUG_MODE === 'true') {
        console.log('=================================================');
        console.log(`✅ [DEBUG] KIS 응답 완료 (총 ${rawData ? rawData.length : 0}건)`);
        // 데이터가 30~50개면 너무 기니까, 첫 번째 데이터만 샘플로 찍어줍니다.
        if (rawData && rawData.length > 0) {
            console.log('📌 [첫 번째 종목 샘플]:', JSON.stringify(rawData[0]));
        }
        console.log('=================================================');
    }

    if (!rawData || rawData.length === 0) return [];

    // 프론트엔드에서 쓰기 편하게 데이터 가공 후 배열 그대로 리턴
    return rawData.map((stock) => ({
        rank: Number(stock.data_rank),              // 순위 (배열 index 대신 실제 응답 rank 사용)
        ticker: stock.mksc_shrn_iscd,               // 종목코드
        name: stock.hts_kor_isnm,                   // 종목명
        marketType: marketType !== 'ALL' ? marketType : 'UNKNOWN', //코스피, 코스닥 구분 (전체조회면 UNKNOWN)
        price: Number(stock.stck_prpr),             // 현재가
        changeRate: Number(stock.prdy_ctrt),        // 전일 대비 등락률 (%)
        changeAmount: Number(stock.prdy_vrss),      // 전일 대비 대비금액 (원)
        changeSign: stock.prdy_vrss_sign,           // 전일 대비 부호 (1:상한, 2:상승, 3:보합, 4:하한, 5:하락)
        
        // 📊 거래량 & 거래대금 핵심 지표 (새로 추가)
        volume: Number(stock.acml_vol),             // 당일 누적 거래량
        prevVolume: Number(stock.prdy_vol),         // 전일 거래량
        volumeIncreaseRate: Number(stock.vol_inrt), // 거래량 급증비율 (%) - "어제보다 얼마나 터졌나?"
        turnoverRate: Number(stock.vol_tnrt),       // 거래량 회전율 (%) - "주인이 얼마나 자주 바뀌었나?"
        tradeValue: Number(stock.acml_tr_pbmn),     // 누적 거래대금 (원)
        listedShares: Number(stock.lstn_stcn),      // 상장 주식 수
        
        // 🚨 시가/고가/저가는 이 API 응답에 없으므로 (NaN 방지를 위해) 뺐습니다.
        // 종가베팅 수식에 필요한 고가/저가는 getClosingBetList의 '단건 상세조회 API'가 다시 채워줄 것입니다!

        // 나머지 KIS 원본 데이터도 통째로 유지
        ...stock
    }));
}

// ════════════════════════════════════════════════════════
// [서비스 로직 2] 종가베팅 조건(윗꼬리 짧음)에 맞는 종목 필터링
// 시가총액 1000억 이상 
// ════════════════════════════════════════════════════════
async function getClosingBetList(marketType = 'ALL', exclCode = '111111111') {
    const token = await getKisAccessToken();
    let topStocks = [];

    if(marketType === 'ALL'){
        // 코스피 30개, 코스닥 30개 순위 가져옴
        const [kospiData, kosdaqData] = await Promise.all([
            getTopVolumeList('KOSPI', exclCode),
            getTopVolumeList('KOSDAQ', exclCode)
        ]);

        // 두 결과 합치고 거래대금 순으로 정렬 (자르지 않고 60개 전부 사용!)
        let combinedData = [...kospiData, ...kosdaqData];
        combinedData.sort((a, b) => b.tradeValue - a.tradeValue);
        topStocks = combinedData;
    }else{
        //코스피, 나스닥 개별 30건 조회
        topStocks = await getTopVolumeList(marketType, exclCode);
    }

    const candidates = [];
    if (topStocks.length === 0) return { totalScanned: 0, candidates: [] };

    //60개 종목을 돌면서 고가/저가 상세 데이터를 꼼꼼히 채워 넣습니다.
    for (const stock of topStocks) {
        try {
            const detailRes = await axios.get(`${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/inquire-price`, {
                headers: getKisHeaders(token, 'FHKST01010100'),
                params: {
                    FID_COND_MRKT_DIV_CODE: 'J',
                    FID_INPUT_ISCD: stock.ticker
                }
            });

            const detail = detailRes.data.output;

            if (detail) {
                const price = Number(detail.stck_prpr);
                const highPrice = Number(detail.stck_hgpr); 
                const lowPrice = Number(detail.stck_lwpr);  
                const changeRate = Number(detail.prdy_ctrt);

                // 💡 52주 최고가(신고가) 및 비율 데이터 추출
                const w52HighPrice = Number(detail.w52_hgpr); 
                const rateFromHigh = Number(detail.d250_hgpr_vrss_prpr_rate);

                let positionRatio = 0;

                // 방어 로직: 고가와 저가가 같은 경우 (점상한가 등)
                if (highPrice === lowPrice) {
                    if (changeRate > 0) positionRatio = 1;
                } else {
                    // 회원님의 핵심 로직: 캔들 몸통 위치 계산 수식!
                    positionRatio = (price - lowPrice) / (highPrice - lowPrice);
                }

                // 시가총액 계산 (현재가 * 상장주식수)
                const totalPrice = price * stock.listedShares; 
                const MIN_TOTAL_PRICE = 100000000000; // 기준선: 1,000억 원

                // 💡 [전략 1] 종가베팅: 윗꼬리가 짧고(80% 이상) && 1,000억 이상
                const isClosingBet = positionRatio > 0.8 && totalPrice >= MIN_TOTAL_PRICE;

                // 💡 [전략 2] 신고가 돌파: 현재가가 52주 최고가를 넘었거나 같음 && 1,000억 이상
                const isNewHighBreakout = price >= w52HighPrice && totalPrice >= MIN_TOTAL_PRICE;

                // 조건: 종가베팅이거나 신고가를 돌파한 강력한 종목이라면 추가!
                if (isClosingBet || isNewHighBreakout) {

                    // 💡 '조'와 '억' 단위 깔끔하게 포맷팅 (삼항 연산자)
                    const eok = Math.floor(totalPrice / 100000000); 
                    const formattedTotalPrice = eok >= 10000 
                        ? `${Math.floor(eok / 10000)}조 ${eok % 10000}억` 
                        : `${eok}억`;

                    candidates.push({
                        ...stock,
                        price: price,         
                        highPrice: highPrice, 
                        lowPrice: lowPrice,   
                        positionRatioPercent: (positionRatio * 100).toFixed(1),
                        totalPrice: totalPrice,
                        totalPriceFormatted: formattedTotalPrice, //시가총액 조/억 텍스트
                        dataFg: isNewHighBreakout ? '신고가돌파' : '종가베팅',
                        w52HighPrice: w52HighPrice,
                        rateFromHigh: rateFromHigh
                    });
                }
            }

            // KIS 서버 요청 중간 딜레이 추가
            await delay(500);

        } catch (err) {
            const kisErrorMsg = err.response?.data?.msg1 || err.message;
            console.error(`[${stock.name}] 상세 조회 실패:`, kisErrorMsg);
        }
    }

    return {
        totalScanned: topStocks.length, // ALL일 경우 60으로 찍힙니다!
        totalScanList: topStocks, //전제 조회 종목
        candidates: candidates //로직 필터 종목
    };
}

module.exports = {
    getTopVolumeList,
    getClosingBetList
};