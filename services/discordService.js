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

// ════════════════════════════════════════════════════════
// JYP 픽 관심종목 현황 디스코드 메시지 전송
// 섹터별로 그룹핑, 등락률 강조 표시
// ════════════════════════════════════════════════════════
async function sendJypPicksMessage(stocks) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_JYP_URL;
    if (!webhookUrl || stocks.length === 0) return;

    try {
        // 섹터별 그룹핑
        const sectorMap = {};
        for (const stock of stocks) {
            if (!sectorMap[stock.sector]) sectorMap[stock.sector] = [];
            sectorMap[stock.sector].push(stock);
        }

        const lines = [];
        for (const [sector, items] of Object.entries(sectorMap)) {
            lines.push(`**📂 ${sector}**`);
            for (const s of items) {
                const changeEmoji = s.changeRate > 0 ? '🔺' : s.changeRate < 0 ? '🔻' : '➖';
                const changeStr = `${s.changeRate > 0 ? '+' : ''}${s.changeRate}%`;
                const fromHighStr = s.fromHigh !== null ? ` | 고점대비 ${s.fromHigh}%` : '';
                const chartUrl = `https://finance.yahoo.com/quote/${s.ticker}`;
                lines.push(`[${s.name} (${s.ticker})](${chartUrl}) : $${s.price.toLocaleString()} ${changeEmoji} ${changeStr}${fromHighStr}`);
            }
            lines.push('');
        }

        const embed = {
            title: `🎯 [JYP 픽] 관심종목 현황 (${stocks.length}개)`,
            description: lines.join('\n'),
            color: 9699539, // 보라색
            footer: { text: '종목명을 터치하면 차트로 이동합니다.' },
            timestamp: new Date().toISOString()
        };

        await axios.post(webhookUrl, { embeds: [embed] });
        console.log('✅ [디스코드] JYP 픽 메시지 전송 완료!');

    } catch (error) {
        console.error('❌ [디스코드] JYP 픽 메시지 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// JYP 픽 당일 분봉 최저가 근접 알림
// ════════════════════════════════════════════════════════
async function sendJypIntradayAlertMessage(alerts, threshold = 3) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_JYP_URL;
    if (!webhookUrl) return;

    try {
        let embed;
        if (alerts.length === 0) {
            embed = {
                title: `📍 [JYP 픽] 당일 저점 근접 알림`,
                description: `현재 저점 기준 **±${threshold}%** 이내에 진입한 종목이 없습니다.`,
                color: 8421504, // 회색
                timestamp: new Date().toISOString()
            };
        } else {
            const lines = alerts.map(s => {
                const chartUrl = `https://finance.yahoo.com/quote/${s.ticker}`;
                const gapStr = s.gapFromLow === 0
                    ? '🔴 **당일 최저점!**'
                    : `📍 저점 대비 +${s.gapFromLow}%`;
                return `**[${s.name} (${s.ticker})](${chartUrl})**\n현재가: $${s.price.toLocaleString()} | 당일저점: $${s.intradayLow} | ${gapStr}`;
            });
            embed = {
                title: `📍 [JYP 픽] 당일 저점 근접 알림 (${alerts.length}건)`,
                description: lines.join('\n\n'),
                color: 16744192, // 주황색
                footer: { text: `당일 저점 기준 ±${threshold}% 이내 종목만 표시됩니다.` },
                timestamp: new Date().toISOString()
            };
        }

        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`✅ [디스코드] JYP 저점 알림 전송 완료! (${alerts.length}건)`);
    } catch (error) {
        console.error('❌ [디스코드] JYP 저점 알림 전송 실패:', error.message);
    }
}

module.exports = {
    sendDiscordMessage,
    sendJypPicksMessage,
    sendJypIntradayAlertMessage
};