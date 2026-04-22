const axios = require('axios');
require('dotenv').config();

async function sendDiscordMessage(strategyName, candidates) {
    const isEnvelope = strategyName.includes('엔벨로프');
    const isRSI = strategyName.includes('RSI');

    let webhookUrl;
    if (isRSI)          webhookUrl = process.env.DISCORD_WEBHOOK_RSI_URL;
    else if (isEnvelope) webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    else                 webhookUrl = process.env.DISCORD_WEBHOOK_CLOSEBET_URL;
    
    if (!webhookUrl || candidates.length === 0) return;

    try {
        const cardColor = isEnvelope ? 16711680 : isRSI ? 16744192 : 65280;
        const icon = isEnvelope ? '🩸' : isRSI ? '📊' : '🔥';

        // 💡 1. 종목 한 줄 텍스트 생성 함수
        const toLine = (stock, index) => {
            const isUS = stock.marketType === 'US';
            const currency = isUS ? '$' : '원';
            const chartUrl = isUS
                ? `https://finance.yahoo.com/quote/${stock.ticker}`
                : `https://finance.naver.com/item/main.naver?code=${stock.ticker}`;

            let extraText = '';
            if (isRSI) {
                // 📊 RSI 과매도 전략일 때
                extraText = stock.rsi != null ? `(📊 RSI ${stock.rsi})` : '(📊 RSI 과매도)';
            } else if (isEnvelope) {
                // 🩸 엔벨로프 전략일 때
                if (stock.score)                extraText = `(💯 ${stock.score}점)`;
                else if (stock.gapFromLowerBand) extraText = `(📉 이격 ${stock.gapFromLowerBand}%)`;
                else                             extraText = `(🩸 낙폭과대)`;
            } else {
                // 🔥 종가베팅 전략일 때
                if (stock.changeRate) extraText = `(🔥 ${stock.changeRate > 0 ? '+' : ''}${stock.changeRate}%)`;
                else                  extraText = `(🎯 조건돌파)`;
            }

            const displayName = stock.name ? `${stock.name} (${stock.ticker})` : stock.ticker;
            return `**${index + 1}. [${displayName}](${chartUrl})** : ${stock.price.toLocaleString()}${currency} ${extraText}`;
        };

        // 💡 2. 전략별 설명 텍스트 구성
        let descriptionString = '';
        if (isEnvelope || isRSI) {
            descriptionString = candidates.slice(0, 30).map(toLine).join('\n\n');
        } else {
            const closingBets  = candidates.filter(s => s.dataFg !== '신고가돌파');
            const newHighBreaks = candidates.filter(s => s.dataFg === '신고가돌파');

            const parts = [];
            if (closingBets.length > 0) {
                parts.push(`🔥 **종가베팅** (${closingBets.length}건)`);
                parts.push(closingBets.slice(0, 15).map(toLine).join('\n\n'));
            }
            if (newHighBreaks.length > 0) {
                if (parts.length > 0) parts.push('');
                parts.push(`🚀 **신고가돌파** (${newHighBreaks.length}건)`);
                parts.push(newHighBreaks.slice(0, 15).map(toLine).join('\n\n'));
            }
            descriptionString = parts.join('\n');
        }

        // 💡 3. 단일 카드로 예쁘게 포장합니다.
        const embed = {
            title: `${icon} [${strategyName}] 종목 포착 (총 ${candidates.length}건)`,
            description: descriptionString,
            color: cardColor,
            footer: { text: '종목 이름을 터치하면 차트로 이동합니다.' },
            timestamp: new Date().toISOString()
        };

        // 💡 4. 배열에 카드 딱 1개만 담아서 전송!
        await axios.post(webhookUrl, {
            embeds: [embed]
        });

        console.log(`✅ [디스코드] ${strategyName} 통합 메시지 전송 완료!`);

    } catch (error) {
        console.error('❌ [디스코드] 메시지 전송 실패:', error.message);
    }
}

module.exports = {
    sendDiscordMessage
};