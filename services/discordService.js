const axios = require('axios');
require('dotenv').config();

async function sendDiscordMessage(strategyName, candidates) {
    const isEnvelope = strategyName.includes('엔벨로프');
    const webhookUrl = isEnvelope ? process.env.DISCORD_WEBHOOK_URL : process.env.DISCORD_WEBHOOK_CLOSEBET_URL;
    
    if (!webhookUrl || candidates.length === 0) return;

    try {
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
            let extraText = '';
            
            if (isEnvelope) {
                // 🩸 엔벨로프 전략일 때
                if (stock.score) {
                    extraText = `(💯 ${stock.score}점)`;
                } else if (stock.gapFromLowerBand) {
                    extraText = `(📉 이격 ${stock.gapFromLowerBand}%)`;
                } else {
                    extraText = `(🩸 낙폭과대)`;
                }
            } else {
                // 🔥 종가베팅 전략일 때 (점수가 없으므로 돌파 포착 문구로 대체)
                // 만약 나중에 백엔드에서 stock.changeRate(등락률)을 넘겨준다면 `(🔥 +5.2%)` 처럼 쓸 수도 있습니다!
                if (stock.changeRate) {
                    extraText = `(🔥 ${stock.changeRate > 0 ? '+' : ''}${stock.changeRate}%)`;
                } else {
                    extraText = `(🎯 조건돌파)`;
                }
            }

            // 🔹 출력 포맷 
            // 엔벨로프: "1. [삼성전자](링크) : 75,000원 (📉 이격 -4.2%)"
            // 종가베팅: "1. [SK하이닉스](링크) : 150,000원 (🎯 조건돌파)"
            return `**${index + 1}. [${stock.name || stock.ticker}](${chartUrl})** : ${stock.price.toLocaleString()}${currency} ${extraText}`;
        });

        // 💡 2. 만들어진 여러 줄의 텍스트를 엔터(\n)로 묶어서 하나의 본문으로 합칩니다.
        // 종목이 너무 많아서 디스코드 본문 글자 수 제한(4096자)을 넘을 경우를 대비해 30개까지만 자릅니다.
        const descriptionString = stockLines.slice(0, 30).join('\n\n');

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