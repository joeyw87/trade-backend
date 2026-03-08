const express = require('express');
const router = express.Router();

// 앞서 만든 Supabase 연결 모듈 불러오기
const supabase = require('../supabaseClient'); 

// ════════════════════════════════════════════════════════
//  [Supabase 전용 API] 종목 검색 
//  실제 호출 URL: /api/supabase/searchTicker?keyword=삼성
// ════════════════════════════════════════════════════════
router.get('/searchTicker', async (req, res) => {
    const keyword = req.query.keyword;

    if (!keyword) {
        return res.status(400).json({ success: false, message: '검색어(keyword)를 입력해주세요.' });
    }

    try {
        const { data, error } = await supabase
            .from('T_TICKER_MST')
            .select('ticker_cd, ticker_nm, ticker_nmas, market_type')      // 💡 스키마에 맞게 'name'을 'ticker_nm'으로 변경!
            .ilike('ticker_nm', `%${keyword}%`)  // 💡 검색 조건도 'ticker_nm'으로 변경!
            .limit(10);

        if (error) {
            throw error;
        }

        res.json({
            success: true,
            count: data.length,
            results: data
        });

    } catch (error) {
        console.error("Supabase 검색 API 에러:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "종목 검색 중 오류가 발생했습니다.", 
            detail: error.message 
        });
    }
});

module.exports = router;