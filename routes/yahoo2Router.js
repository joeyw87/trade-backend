const express = require('express');
const router = express.Router();
const kisService = require('../services/kisService');

// ════════════════════════════════════════════════════════
// [API 1] 미국 주식 종가베팅 & 신고가 검색 (KIS API)
// GET /api/yahoo2/us-closing-bet
// ════════════════════════════════════════════════════════
router.get('/us-closing-bet', async (req, res) => {
    try {
        const result = await kisService.getUsClosingBetListByKis();
        res.json({
            success: true,
            totalScanned: result.totalScanned,
            totalScanList: result.totalScanList,
            count: result.candidates.length,
            candidates: result.candidates
        });
    } catch (error) {
        console.error("미국 주식 종가베팅 라우터 에러:", error.message);
        res.status(500).json({ success: false, error: '미국 주식 종가베팅 분석 중 오류가 발생했습니다.' });
    }
});

// ════════════════════════════════════════════════════════
// [API 2] 미국 주식 엔벨로프 하한선(낙폭과대) 검색 (KIS API)
// GET /api/yahoo2/us-envelope
// ════════════════════════════════════════════════════════
router.get('/us-envelope', async (req, res) => {
    try {
        const result = await kisService.getUsEnvelopeBetListByKis();
        res.json({
            success: true,
            count: result.candidates.length,
            ...result
        });
    } catch (error) {
        console.error("미국 주식 엔벨로프 라우터 에러:", error.message);
        res.status(500).json({ success: false, error: '미국 주식 엔벨로프 스캔 중 오류가 발생했습니다.' });
    }
});

module.exports = router;
