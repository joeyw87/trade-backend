// 로거를 실행하여 이후의 모든 console 출력을 튜닝합니다.
require('./logger');

const express = require('express');
const cors = require('cors');
const axios = require('axios');

// 1️⃣ 추가: .env 파일에서 KIS_APP_KEY, KIS_APP_SECRET 환경변수를 불러옵니다.
require('dotenv').config();

// 2️⃣ 추가: 아까 분리해서 만든 KIS 토큰 관리 모듈을 불러옵니다.
const { getKisAccessToken } = require('./kisAuth');

const app = express();
const PORT = process.env.PORT || 3001; // 리액트(5173)와 겹치지 않게 3001번 포트 사용

// CORS 허용 설정 (매우 중요!)
// 개발할 때 쓰는 localhost와, 실제 배포된 깃허브 페이지 주소를 모두 허용합니다.
app.use(cors({
    origin: ['http://localhost:3000', 'https://joeyw87.github.io']
}));

// ════════════════════════════════════════════════════════
//  [라우터 1] 야후 파이낸스 API 프록시 (나만의 프록시 주소) - 대시보드 등 사용
// ════════════════════════════════════════════════════════
app.get('/api/yahoo', async (req, res) => {
    const ticker = req.query.ticker; // 예: 005930.KS

    if (!ticker) {
        return res.status(400).json({ error: '종목 코드(ticker)가 필요합니다.' });
    }

    try {
        const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo`;
        
        // 💡 핵심 꿀팁: 야후 서버가 봇으로 의심하지 않도록 '진짜 브라우저'인 척 속이는 헤더 추가
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        // 야후에서 받은 데이터를 그대로 프론트엔드(React)로 전달
        res.json(response.data);
        console.log(`[${ticker}] 데이터 전달 완료 ✅`);

    } catch (error) {
        console.error(`[${ticker}] 야후 API 호출 실패:`, error.message);
        res.status(500).json({ error: '데이터를 가져오는데 실패했습니다.' });
    }
});

// ════════════════════════════════════════════════════════
//  [라우터 2] KIS API 토큰 발급 테스트 (신규 추가)
//  npm install dotenv 필요.
// ════════════════════════════════════════════════════════
app.get('/api/kis/test-token', async (req, res) => {
    try {
        // kisAuth.js에 있는 함수를 호출하면 알아서 토큰을 가져오거나 갱신합니다!
        const token = await getKisAccessToken();
        
        res.json({ 
            success: true, 
            message: "KIS 토큰 발급 로직이 완벽하게 작동합니다!", 
            tokenPreview: token.substring(0, 15) + "..." // 보안상 앞 15자리만 보여줌
        });
    } catch (error) {
        console.error("토큰 테스트 라우터 에러:", error);
        res.status(500).json({ success: false, message: "토큰 발급 에러" });
    }
});

// ════════════════════════════════════════════════════════
//  [라우터 3] KIS API 당일 거래대금 상위 50~100개 종목 조회 (주도주 스캐닝)
// ════════════════════════════════════════════════════════
app.get('/api/kis/top-volume', async (req, res) => {
    try {
        const token = await getKisAccessToken();
        
        // 🚨 랭킹 API는 실전 도메인에서만 정상 작동할 확률이 높습니다.
        const KIS_DOMAIN = 'https://openapivts.koreainvestment.com:29443'; 

        const response = await axios.get(`${KIS_DOMAIN}/uapi/domestic-stock/v1/quotations/volume-rank`, {
            headers: {
                'authorization': `Bearer ${token}`,
                'appkey': process.env.KIS_APP_KEY,
                'appsecret': process.env.KIS_APP_SECRET,
                'tr_id': 'FHPST01710000', // 거래대금 상위 랭킹 TR_ID
                'custtype': 'P'           // 개인(P)
            },
            params: {
                FID_COND_MRKT_DIV_CODE: 'J', // J: 주식 전체 (코스피+코스닥)
                FID_COND_SCR_DIV_CODE: '20171', // 화면분류코드 (고정값)
                FID_INPUT_ISCD: '0000',      // 0000: 전체 종목
                FID_DIV_CLS_CODE: '0',       // 0:(전체) 1:(보통주) 2:(우선주)
                FID_BLNG_CLS_CODE: '0',      // 0: 평균거래량 1:거래증가율 2:평균거래회전율 3:거래금액순 4:평균거래금액회전율
                FID_TRGT_CLS_CODE: '111111111', // 타겟 클래스 (보통주 등)
                FID_TRGT_EXLS_CLS_CODE: '0000000000', // 제외 클래스 (우선주, 관리종목 등 제외 설정 가능)
                FID_INPUT_PRICE_1: '',
                FID_INPUT_PRICE_2: '',
                FID_VOL_CNT: '',
                FID_INPUT_DATE_1: ''
            }
        });

        // KIS API 응답에서 종목 리스트 추출
        const rawData = response.data.output;

        if (!rawData || rawData.length === 0) {
            return res.json({ success: true, topStocks: [], message: "조회된 데이터가 없습니다." });
        }

        // 프론트엔드에서 쓰기 편하게 데이터 가공 (필요한 것만 뽑기)
        // KIS는 기본적으로 상위 30~50개를 배열로 줍니다.
        const topStocks = rawData.map((stock, index) => ({
            // 1️⃣ 프론트엔드 대시보드나 로직에서 바로 쓰기 편하게 가공한 핵심 데이터
            rank: index + 1,
            ticker: stock.mksc_shrn_iscd,           // 종목코드
            name: stock.hts_kor_isnm,               // 종목명
            price: Number(stock.stck_prpr),         // 현재가
            changeRate: Number(stock.prdy_ctrt),    // 전일 대비 등락률 (%)
            changeAmount: Number(stock.prdy_vrss),  // 전일 대비 대비금액 (원)
            changeSign: stock.prdy_vrss_sign,       // 전일 대비 부호 (1:상한, 2:상승, 3:보합, 4:하한, 5:하락)
            volume: Number(stock.acml_vol),         // 누적 거래량 (주)
            tradeValue: Number(stock.acml_tr_pbmn), // 누적 거래대금 (원)
            openPrice: Number(stock.stck_oprc),     // 시가
            highPrice: Number(stock.stck_hgpr),     // 고가
            lowPrice: Number(stock.stck_lwpr),      // 저가

            // 2️⃣ KIS API가 응답한 나머지 모든 필드(데이터)를 객체 안에 통째로 쓸어 담기!
            ...stock
        }));
        res.json({
            success: true,
            count: topStocks.length,
            topStocks: topStocks
        });

    } catch (error) {
        console.error("거래대금 상위 조회 에러:", error.response?.data || error.message);
        res.status(500).json({ 
            success: false, 
            message: "거래대금 상위 종목을 불러오지 못했습니다.",
            detail: error.response?.data?.msg1 || "Unknown error"
        });
    }
});

// 3. 서버 실행
app.listen(PORT, () => {
    console.log(`🚀 나만의 듬직한 하이브리드 백엔드 서버가 포트 ${PORT} 에서 돌아가는 중입니다!`);
});