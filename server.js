// 로거를 실행하여 이후의 모든 console 출력을 튜닝합니다.
require('./logger');

const express = require('express');
const cors = require('cors');
// 텔레그램 모듈 불러오기
//const { sendTelegramAlert } = require('./telegram');

// 1️⃣ 추가: .env 파일에서 KIS_APP_KEY, KIS_APP_SECRET 환경변수를 불러옵니다.
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001; // 리액트(5173)와 겹치지 않게 3001번 포트 사용

// CORS 허용 설정 (매우 중요!)
// 개발할 때 쓰는 localhost와, 실제 배포된 깃허브 페이지 주소를 모두 허용합니다.
app.use(cors({
    origin: ['http://localhost:3000', 'https://joeyw87.github.io']
}));

// ════════════════════════════════════════════════════════
//  [라우터 연결부] 분리해둔 라우터 파일들을 불러와서 주소와 매핑합니다.
// ════════════════════════════════════════════════════════
const yahooRouter = require('./routes/yahooRouter');
const yahoo2Router = require('./routes/yahoo2Router');
const kisRouter = require('./routes/kisRouter');
const supabaseRouter = require('./routes/supabaseRouter');

// "/api/yahoo" 로 시작하는 모든 요청은 yahooRouter 에게 맡깁니다.
app.use('/api/yahoo', yahooRouter);
app.use('/api/yahoo2', yahoo2Router);

// "/api/kis" 로 시작하는 모든 요청은 kisRouter 에게 맡깁니다.
app.use('/api/kis', kisRouter);

//"/api/supabase" 주소로 들어오면 연결!
app.use('/api/supabase', supabaseRouter);

// 3. 서버 실행
app.listen(PORT, async() => {
    console.log(`🚀 나만의 듬직한 하이브리드 백엔드 서버가 포트 ${PORT} 에서 돌아가는 중입니다!`);

    // 서버가 켜지면 텔레그램으로 푸시 알림 전송
    //await sendTelegramAlert("🤖 <b>[알림]</b> 자동매매 백엔드 서버가 성공적으로 가동되었습니다!\n\n현재 대기 중입니다...");
});