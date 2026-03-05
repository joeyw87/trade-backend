const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = 3001; // 리액트(5173)와 겹치지 않게 3001번 포트 사용

// 1. CORS 허용 설정 (매우 중요!)
// 개발할 때 쓰는 localhost와, 실제 배포된 깃허브 페이지 주소를 모두 허용합니다.
app.use(cors({
    origin: ['http://localhost:3000', 'https://joeyw87.github.io']
}));

// 2. 야후 파이낸스 데이터 요청 라우터 (나만의 프록시 주소)
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

// 3. 서버 실행
app.listen(PORT, () => {
    console.log(`🚀 나만의 듬직한 프록시 서버가 http://localhost:${PORT} 에서 돌아가는 중입니다!`);
});