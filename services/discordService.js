const axios = require('axios');

async function sendDiscordMessage(strategyName, candidates) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    
    if (!webhookUrl || candidates.length === 0) return;

    try {
        const isEnvelope = strategyName.includes('엔벨로프');
        const cardColor = isEnvelope ? 16711680 : 65280; 
        const icon = isEnvelope ? '🩸' : '🔥'; 

        // 💡 1. 각각의 종목을 한 줄짜리 깔끔한 텍스트로 압축합니다.
        const stockLines = candidates.map((stock, index) => {
            const isUS = stock.marketType === 'US';
            const currency = isUS ? '$' : '원';
            
            // 이름 클릭 시 바로 차트로 이동하는 링크
            const chartUrl = isUS 
                ? `https://finance.yahoo.com/quote/${stock.ticker}` 
                : `https://finance.naver.com/item/main.naver?code=${stock.ticker}`; 

            // 점수 또는 괴리율 텍스트 세팅
            let scoreText = '';
            if (stock.score) {
                scoreText = `(💯 ${stock.score}점)`;
            } else if (stock.gapFromLowerBand) {
                scoreText = `(📉 이격 ${stock.gapFromLowerBand}%)`;
            }

            // 🔹 출력 포맷: "1. [삼성전자](링크) : 75,000원 (📉 이격 -4.2%)"
            return `**${index + 1}. [${stock.name || stock.ticker}](${chartUrl})** : ${stock.price.toLocaleString()}${currency} ${scoreText}`;
        });

        // 💡 2. 만들어진 여러 줄의 텍스트를 엔터(\n)로 묶어서 하나의 본문으로 합칩니다.
        // 종목이 너무 많아서 디스코드 본문 글자 수 제한(4096자)을 넘을 경우를 대비해 30개까지만 자릅니다.
        const descriptionString = stockLines.slice(0, 30).join('\n\n');

        // 💡 3. 단일 카드로 예쁘게 포장합니다.
        const embed = {
            title: `${icon} [${strategyName}] 주도주 포착 (총 ${candidates.length}건)`,
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