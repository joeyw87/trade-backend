// routes/kisRouter.js
const express = require('express');
const router = express.Router();

// 💡 1. 비즈니스 로직(Service) 모듈 불러오기
const { getTopVolumeList, getClosingBetList } = require('../services/kisService');

// 💡 2. 인증 모듈 불러오기 (테스트 라우터용)
const { getKisAccessToken } = require('../kisAuth');

// ════════════════════════════════════════════════════════
//  [테스트 API] KIS API 토큰 발급 확인
// ════════════════════════════════════════════════════════
router.get('/test-token', async (req, res) => {
    try {
        const token = await getKisAccessToken();
        res.json({
            success: true,
            message: "KIS 토큰 발급 로직이 완벽하게 작동합니다!",
            tokenPreview: token.substring(0, 15) + "..."
        });
    } catch (error) {
        console.error("토큰 테스트 라우터 에러:", error);
        res.status(500).json({ success: false, message: "토큰 발급 에러" });
    }
});

// ════════════════════════════════════════════════════════
//  [검색 API 1] 거래대금 상위 종목 조회 (Controller)
//  호출 URL: /api/kis/top-volume?exclCode=0000000000
// ════════════════════════════════════════════════════════
router.get('/top-volume', async (req, res) => {
    try {
        const exclCode = req.query.exclCode || '0000000000';

        // 💡 Service 함수 호출 (데이터만 딱 받아옵니다)
        const topStocks = await getTopVolumeList(exclCode);

        res.json({
            success: true,
            count: topStocks.length,
            topStocks: topStocks
        });

    } catch (error) {
        console.error("거래대금 상위 조회 에러:", error.message);
        res.status(500).json({ success: false, message: "거래대금 상위 종목 조회 실패" });
    }
});

// ════════════════════════════════════════════════════════
//  [검색 API 2] 종가베팅 필터링 조회 (Controller)
//  호출 URL: /api/kis/closing-bet?exclCode=0000000000
// ════════════════════════════════════════════════════════
router.get('/closing-bet', async (req, res) => {
    try {
        const exclCode = req.query.exclCode || '0000000000';

        // 💡 Service 함수 호출 (이름 변경 완료!)
        const result = await getClosingBetList(exclCode);

        res.json({
            success: true,
            totalScanned: result.totalScanned,
            count: result.candidates.length,
            candidates: result.candidates
        });

    } catch (error) {
        console.error("종가베팅 조회 에러:", error.message);
        res.status(500).json({ success: false, message: "종가베팅 후보 검색 실패" });
    }
});

module.exports = router;