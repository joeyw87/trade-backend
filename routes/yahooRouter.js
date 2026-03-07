const express = require('express');
const router = express.Router();
const axios = require('axios');

// ════════════════════════════════════════════════════════
//  [라우터 1] 야후 파이낸스 API 프록시 (나만의 프록시 주소) - 대시보드 등 사용
//  (메인 server.js에서 /api/yahoo 로 넘겨주므로 여기선 / 로 받습니다)
// ════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
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

module.exports = router;