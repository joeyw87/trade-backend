const axios = require('axios');
require('dotenv').config();

const KIS_APP_KEY = process.env.KIS_APP_KEY;
const KIS_APP_SECRET = process.env.KIS_APP_SECRET;

// 🚨 실전투자 전용 도메인
const KIS_DOMAIN = 'https://openapi.koreainvestment.com:9443';
// 🚨 모의투자 전용 도메인
//const KIS_DOMAIN = 'https://openapivts.koreainvestment.com:29443';

// 메모리에 토큰과 만료 시간을 저장해둘 변수
let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * KIS 접근 토큰(Access Token)을 발급 및 유지하는 함수
 */
async function getKisAccessToken() {
    const now = Date.now();
    
    // 1. 토큰이 존재하고, 만료 시간까지 1시간(3600초) 이상 넉넉히 남았다면 기존 토큰 재사용
    if (cachedToken && tokenExpiresAt > now + (3600 * 1000)) {
        console.log("🔄 기존에 발급받은 KIS 토큰을 재사용합니다.");
        return cachedToken;
    }

    // 2. 토큰이 없거나 만료가 임박했다면 한국투자증권 서버에 새로 요청
    console.log("⚠️ KIS 토큰이 없거나 만료 임박! 새로 발급을 요청합니다...");
    
    try {
        const response = await axios.post(`${KIS_DOMAIN}/oauth2/tokenP`, {
            grant_type: "client_credentials",
            appkey: KIS_APP_KEY,
            appsecret: KIS_APP_SECRET
        });

        // 새로 발급받은 토큰을 메모리에 저장
        cachedToken = response.data.access_token;
        
        // KIS API는 토큰 유효기간(expires_in)을 초(sec) 단위로 줍니다. (보통 86400초 = 24시간)
        // 이를 밀리초(ms)로 변환하여 만료 시간 업데이트
        const expiresInMs = response.data.expires_in * 1000;
        tokenExpiresAt = now + expiresInMs;

        console.log("✅ KIS Access Token 신규 발급 완료! (유효기간 24시간)");
        return cachedToken;

    } catch (error) {
        console.error("❌ KIS 토큰 발급 실패:", error.response?.data || error.message);
        throw new Error("증권사 API 토큰 발급에 실패했습니다.");
    }
}

// 다른 파일에서 이 함수를 끌어다 쓸 수 있도록 내보내기
module.exports = { getKisAccessToken, KIS_DOMAIN };