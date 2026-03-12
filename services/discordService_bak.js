const axios = require('axios');

async function sendDiscordMessage(strategyName, candidates) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    
    // 웹훅 URL이 없거나, 포착된 종목이 없으면 조용히 종료
    if (!webhookUrl || candidates.length === 0) return;

    try {
        // 💡 디스코드 Embed 카드로 예쁘게 꾸미기
        // const embeds = candidates.map(stock => {
        //     // 엔벨로프(낙폭과대)는 빨간색, 종가베팅(돌파)은 초록색으로 카드 색상 변경
        //     const cardColor = strategyName.includes('엔벨로프') ? 16711680 : 65280; 

        //     return {
        //         title: `🎯 [${strategyName}] ${stock.name || stock.ticker}`,
        //         description: `티커: ${stock.ticker} | 시장: ${stock.marketType || 'KOR'}`,
        //         color: cardColor,
        //         fields: [
        //             { name: '현재가', value: `${stock.price.toLocaleString()}${stock.marketType === 'US' ? '$' : '원'}`, inline: true },
        //             { name: '시가총액', value: stock.totalPriceFormatted, inline: true },
        //             { name: '포착 시그널', value: stock.dataFg || '조건 만족', inline: false }
        //         ],
        //         footer: { text: 'Algo Trading Bot 🤖' },
        //         timestamp: new Date().toISOString()
        //     };
        // });

        const embeds = candidates.map(stock => {
            const isUS = stock.marketType === 'US';
            const currency = isUS ? '$' : '원';
            
            // 전략에 따른 아이콘과 색상 분리 (엔벨로프=빨강/하락, 종가베팅=초록/상승)
            const isEnvelope = strategyName.includes('엔벨로프');
            const cardColor = isEnvelope ? 16711680 : 65280; 
            const icon = isEnvelope ? '🩸' : '🔥'; 

            // 💡 터치 한 번에 차트를 띄울 수 있도록 다이렉트 링크 생성
            const chartUrl = isUS 
                ? `https://finance.yahoo.com/quote/${stock.ticker}` 
                : `https://finance.naver.com/item/main.naver?code=${stock.ticker}`; 

            // 💡 [신규] 신호점수 표시 로직
            // 1. 백엔드에서 넘겨준 stock.score가 있으면 그걸 씁니다 (예: 95점)
            // 2. score가 없고 엔벨로프 전략이면, 아까 만든 '괴리율'을 점수처럼 보여줍니다 (예: 하단 이격 -2.5%)
            // 3. 둘 다 없으면 기본 텍스트 출력
            let displayScore = '⭐ 강력 포착';
            if (stock.score) {
                displayScore = `**${stock.score}점** 💯`;
            } else if (stock.gapFromLowerBand) {
                displayScore = `**하단 이격 ${stock.gapFromLowerBand}%** 📉`;
            }

            // 모바일 화면에서 줄바꿈이 예쁘게 떨어지도록 텍스트 압축
            const desc = `**💰 ${stock.price.toLocaleString()}${currency}** (시총: ${stock.totalPriceFormatted})\n` +
                         `🎯 **신호점수:** ${displayScore}\n` +
                         `📝 **포착근거:** ${stock.dataFg || '조건 만족'}\n\n` +
                         `🔗 **[👉 여기를 눌러 차트 바로보기](${chartUrl})**`;

            return {
                title: `${icon} [${strategyName}] ${stock.name || stock.ticker}`,
                description: desc,
                color: cardColor,
                timestamp: new Date().toISOString()
            };
        });

        // 디스코드는 한 번에 최대 10개의 Embed 카드만 보낼 수 있습니다. (안전장치)
        const safeEmbeds = embeds.slice(0, 10);

        await axios.post(webhookUrl, {
            content: `🚨 **새로운 주도주 포착 완료!** (${candidates.length}건)`,
            embeds: safeEmbeds
        });

        console.log(`✅ [디스코드] ${strategyName} 알림 전송 완료!`);

    } catch (error) {
        console.error('❌ [디스코드] 메시지 전송 실패:', error.message);
    }
}

module.exports = {
    sendDiscordMessage
};