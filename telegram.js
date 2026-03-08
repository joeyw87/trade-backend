const axios = require('axios');
require('dotenv').config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * 텔레그램으로 알림 메시지를 보내는 함수
 * @param {string} message 보낼 텍스트 메시지
 */
async function sendTelegramAlert(message) {
    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        console.error("❌ 텔레그램 설정이 누락되었습니다. (.env 파일을 확인하세요)");
        return;
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    
    try {
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML' // HTML 태그를 사용해 굵은 글씨 등을 표현할 수 있게 합니다.
        });
        console.log("📱 텔레그램 알림 전송 완료!");
    } catch (error) {
        console.error("❌ 텔레그램 알림 전송 실패:", error.response?.data || error.message);
    }
}

module.exports = { sendTelegramAlert };