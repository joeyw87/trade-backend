const axios = require('axios');
const { getKisAccessToken } = require('../kisAuth');

// ════════════════════════════════════════════════════════
// [서비스 로직 1] KIS API 거래대금 상위 종목 리스트 가져오기
// ════════════════════════════════════════════════════════
async function getTopVolumeList(exclCode = '0000000000') {
    const token = await getKisAccessToken();
    const KIS_DOMAIN = 'https://openapivts.koreainvestment.com:29443';

    const response = await axios.get(`${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/volume-rank`, {
        headers: {
            'authorization': `Bearer ${token}`,
            'appkey': process.env.KIS_APP_KEY,
            'appsecret': process.env.KIS_APP_SECRET,
            'tr_id': 'FHPST01710000',
            'custtype': 'P'
        },
        params: {
            FID_COND_MRKT_DIV_CODE: 'J',
            FID_COND_SCR_DIV_CODE: '20171',
            FID_INPUT_ISCD: '0000',
            FID_DIV_CLS_CODE: '0',
            FID_BLNG_CLS_CODE: '0',
            FID_TRGT_CLS_CODE: '111111111',
            FID_TRGT_EXLS_CLS_CODE: exclCode,
            FID_INPUT_PRICE_1: '',
            FID_INPUT_PRICE_2: '',
            FID_VOL_CNT: '',
            FID_INPUT_DATE_1: ''
        }
    });

    const rawData = response.data.output;
    if (!rawData || rawData.length === 0) return [];

    // 프론트엔드에서 쓰기 편하게 데이터 가공 후 배열 그대로 리턴
    return rawData.map((stock, index) => ({
        rank: index + 1,
        ticker: stock.mksc_shrn_iscd,
        name: stock.hts_kor_isnm,
        price: Number(stock.stck_prpr),
        changeRate: Number(stock.prdy_ctrt),
        changeAmount: Number(stock.prdy_vrss),
        changeSign: stock.prdy_vrss_sign,
        volume: Number(stock.acml_vol),
        tradeValue: Number(stock.acml_tr_pbmn),
        openPrice: Number(stock.stck_oprc),
        highPrice: Number(stock.stck_hgpr),
        lowPrice: Number(stock.stck_lwpr),
        ...stock
    }));
}

// ════════════════════════════════════════════════════════
// [서비스 로직 2] 종가베팅 조건(윗꼬리 짧음)에 맞는 종목 필터링
// ════════════════════════════════════════════════════════
async function getClosingBetList(exclCode = '0000000000') {
    // 💡 방금 위에서 만든 함수를 재사용하여 일단 거래대금 상위 데이터를 다 가져옵니다!
    const topStocks = await getTopVolumeList(exclCode);
    const candidates = [];

    topStocks.forEach((stock) => {
        const price = stock.price;
        const highPrice = stock.highPrice;
        const lowPrice = stock.lowPrice;
        const changeRate = stock.changeRate;

        let positionRatio = 0;

        // 방어 로직: 고가와 저가가 같은 경우 (점상한가 등)
        if (highPrice === lowPrice) {
            if (changeRate > 0) positionRatio = 1;
        } else {
            // 회원님의 핵심 로직: 캔들 몸통 위치 계산 수식!
            positionRatio = (price - lowPrice) / (highPrice - lowPrice);
        }

        // 조건: 윗꼬리가 짧고(고가 부근) 캔들 위쪽 80% 이상에 위치하는 종목
        if (positionRatio > 0.8) {
            candidates.push({
                ...stock,
                positionRatioPercent: (positionRatio * 100).toFixed(1) // 퍼센트로 보기 좋게 변환
            });
        }
    });

    return {
        totalScanned: topStocks.length,
        candidates: candidates
    };
}

module.exports = {
    getTopVolumeList,
    getClosingBetList
};