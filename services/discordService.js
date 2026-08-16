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

// ════════════════════════════════════════════════════════
// 영무문(moo) 종목 발굴 스크리닝 결과 전송
// ════════════════════════════════════════════════════════
async function sendMooScreeningMessage(screeningResult) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_MOO_URL;
    if (!webhookUrl) return;

    const { totalScanned, goldenCrossPass, results, elapsedSec } = screeningResult;
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    try {
        if (results.length === 0) {
            const embed = {
                title: `🔍 [영무문] 종목 발굴 결과 — ${today}`,
                description: `기준 점수(8점) 이상 종목이 없습니다.\n스캔: ${totalScanned}개 | 골든크로스 통과: ${goldenCrossPass}개`,
                color: 8421504,
                timestamp: new Date().toISOString(),
            };
            await axios.post(webhookUrl, { embeds: [embed] });
            return;
        }

        // 종목 5개씩 나눠서 전송 (Discord embed 글자 제한 대응)
        const chunks = [];
        for (let i = 0; i < results.length; i += 5) {
            chunks.push(results.slice(i, i + 5));
        }

        for (let ci = 0; ci < chunks.length; ci++) {
            const chunk = chunks[ci];
            const lines = chunk.map((r, idx) => {
                const globalIdx = ci * 5 + idx + 1;
                const chartUrl = `https://finance.naver.com/item/main.naver?code=${r.ticker}`;
                const gradeIcon = { S: '🔥', A: '⭐', B: '✅', DEBUG: '🧪' }[r.grade] || '';

                // 채점 항목 (✅/❌)
                const flags = [];
                if (r.tech.maAlignment) flags.push('📈정배열 ✅');
                else                     flags.push('📈정배열 ❌');
                if (r.tech.volumeSpike) flags.push('🔊거래량급증 ✅');
                else                     flags.push('🔊거래량급증 ❌');

                // 참고용 (점수 무관)
                const investorRef = [
                    r.investor.foreignBuy ? '🌏외국인↑' : '🌏외국인↓',
                    r.investor.instBuy    ? '🏦기관↑'   : '🏦기관↓',
                    `📊RSI ${r.tech.rsi ?? 'N/A'}`,
                ].join(' · ');

                const reportUrl = `https://m.stock.naver.com/domestic/stock/${r.ticker}/research`;

                let analystLine;
                if (r.analyst.latestTarget == null) {
                    analystLine = `[🎯 목표가 리포트 없음](${reportUrl})`;
                } else {
                    const rangeStr = (r.analyst.min5 != null && r.analyst.max5 != null)
                        ? `범위: ${r.analyst.min5.toLocaleString()}~${r.analyst.max5.toLocaleString()}원`
                        : '';

                    // 현재가 대비 괴리율
                    const price = r.price;
                    const upsideMax = (price && r.analyst.max5) ? (((r.analyst.max5 / price) - 1) * 100).toFixed(1) : null;
                    const upsideMin = (price && r.analyst.min5) ? (((r.analyst.min5 / price) - 1) * 100).toFixed(1) : null;
                    const upsideStr = (upsideMax && upsideMin)
                        ? `현재가 대비 최고 ${upsideMax > 0 ? '+' : ''}${upsideMax}% / 최저 ${upsideMin > 0 ? '+' : ''}${upsideMin}%`
                        : '';

                    if (r.analyst.totalCompared === 0) {
                        const singleList = r.analyst.singleFirms?.slice(0, 5)
                            .map(f => `${f.firm} ${f.price?.toLocaleString()}원`).join(' · ') || '';
                        const lines = [`[🎯 목표가 (증권사별 단일 리포트)](${reportUrl})`];
                        if (singleList) lines.push(`   ${singleList}`);
                        if (upsideStr)  lines.push(`   ${upsideStr}`);
                        if (rangeStr)   lines.push(`   ${rangeStr}`);
                        analystLine = lines.join('\n');
                    } else {
                        const icon  = r.analyst.targetRaised ? '✅' : r.analyst.targetDown ? '❌' : '➡️';
                        const label = r.analyst.targetRaised ? '상향 우세' : r.analyst.targetDown ? '하향 우세' : '유지';
                        const countParts = [];
                        if (r.analyst.raised    > 0) countParts.push(`${r.analyst.raised}개사↑`);
                        if (r.analyst.dropped   > 0) countParts.push(`${r.analyst.dropped}개사↓`);
                        if (r.analyst.maintained > 0) countParts.push(`${r.analyst.maintained}개사→`);
                        const counts = countParts.join(' · ') || '비교없음';

                        const upFirms    = r.analyst.firmDetails?.filter(f => f.includes('↑')).join(' · ') || '';
                        const downFirms  = r.analyst.firmDetails?.filter(f => f.includes('↓')).join(' · ') || '';
                        const maintFirms = r.analyst.firmDetails?.filter(f => !f.includes('↑') && !f.includes('↓')).join(' · ') || '';

                        const lines = [`[🎯 목표가 ${label} ${icon}](${reportUrl})  ${counts}`];
                        if (upFirms)    lines.push(`   ↑ ${upFirms}`);
                        if (downFirms)  lines.push(`   ↓ ${downFirms}`);
                        if (maintFirms) lines.push(`   → ${maintFirms}`);
                        if (upsideStr) lines.push(`   ${upsideStr}`);
                        if (rangeStr)  lines.push(`   ${rangeStr}`);
                        analystLine = lines.join('\n');
                    }
                }

                let consensusLine;
                if (r.consensus.actual == null) {
                    consensusLine = `💰 컨센서스 데이터 없음`;
                } else {
                    const beat = r.consensus.beatConsensus;
                    const beatIcon = beat ? '✅' : '❌';
                    const beatLabel = beat ? '성장 기대' : '성장 기대 없음';

                    // 실적(A) → 추정(E) 체인 구성
                    const chain = [`${r.consensus.actualPeriod} **${r.consensus.actual?.toLocaleString()}억**`];
                    if (r.consensus.estRows?.length > 0) {
                        r.consensus.estRows.forEach((row, i) => {
                            const prev = i === 0 ? r.consensus.actual : r.consensus.estRows[i - 1].opProfit;
                            const arrow = row.opProfit > prev ? '📈' : row.opProfit < prev ? '📉' : '➡️';
                            chain.push(`${arrow} ${row.period} ${row.opProfit?.toLocaleString()}억`);
                        });
                    }
                    consensusLine = `💰 ${beatLabel} ${beatIcon} ${chain.join(' → ')}`;
                }

                const header = r._isDebug
                    ? `**${globalIdx}. [${r.name} (${r.ticker})](${chartUrl})** ${gradeIcon} [테스트] ${r.score}/12점`
                    : `**${globalIdx}. [${r.name} (${r.ticker})](${chartUrl})** ${gradeIcon} ${r.grade}등급 ${r.score}/12점`;

                const details = [flags.join(' · '), `📌 참고 ${investorRef}`, analystLine, consensusLine].join('\n   ');

                return `${header}\n   ${details}`;
            });

            const isFirst = ci === 0;
            const embed = {
                title: isFirst ? `🔍 [영무문] 종목 발굴 결과 — ${today} (${results.length}건)` : `🔍 [영무문] 종목 발굴 결과 (계속)`,
                description: lines.join('\n\n'),
                color: 5814783,
                footer: isFirst
                    ? { text: `스캔 ${totalScanned}개 | 골든크로스 통과 ${goldenCrossPass}개 | 소요 ${elapsedSec}초` }
                    : undefined,
                timestamp: new Date().toISOString(),
            };
            await axios.post(webhookUrl, { embeds: [embed] });
        }

        console.log(`✅ [디스코드] 영무문 스크리닝 결과 전송 완료! (${results.length}건)`);
    } catch (error) {
        console.error('❌ [디스코드] 영무문 스크리닝 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// 영무문2 — 최근 리포트 종목 순위 디스코드 전송
// ════════════════════════════════════════════════════════
// top10: [{ name, ticker, count, firmMap: { firm: { opinion, target } } }]
// priceMap: { [ticker]: { price, changeRate } }
// consensusMap: { [ticker]: consensus 객체 }
async function sendMoo2Message(top10, priceMap = {}, consensusMap = {}) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_MOO_URL;
    if (!webhookUrl || top10.length === 0) return;

    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const lines = top10.map((s, i) => {
        const researchUrl = s.ticker
            ? `https://m.stock.naver.com/domestic/stock/${s.ticker}/research`
            : `https://finance.naver.com/research/company_list.naver`;

        // 현재가
        const priceInfo = s.ticker ? priceMap[s.ticker] : null;
        let priceStr = '';
        if (priceInfo?.price) {
            const sign  = priceInfo.changeRate >= 0 ? '+' : '';
            const arrow = priceInfo.changeRate > 0 ? '🔺' : priceInfo.changeRate < 0 ? '🔻' : '➖';
            priceStr = `💰 현재가: **${priceInfo.price.toLocaleString()}원** ${arrow}${sign}${priceInfo.changeRate}%`;
        }

        // 증권사별 투자의견 + 목표주가
        const firmEntries = Object.entries(s.firmMap);
        const firmParts = firmEntries
            .map(([firm, info]) => {
                const op = info.opinion || '';
                const tg = info.target ? `${info.target.toLocaleString()}원` : '';
                return [firm, op, tg].filter(Boolean).join(' ');
            })
            .filter(Boolean);
        const firmStr = firmParts.length > 0 ? `\n   🏦 ${firmParts.join(' · ')}` : '';

        // 목표가 범위 + 괴리율
        const targets = firmEntries.map(([, info]) => info.target).filter(Boolean);
        let targetRangeStr = '';
        if (targets.length > 0) {
            const minT = Math.min(...targets);
            const maxT = Math.max(...targets);
            if (priceInfo?.price) {
                const upMax = (((maxT / priceInfo.price) - 1) * 100).toFixed(1);
                const upMin = (((minT / priceInfo.price) - 1) * 100).toFixed(1);
                targetRangeStr = `\n   🎯 ${minT.toLocaleString()}~${maxT.toLocaleString()}원 | 최고 ${upMax > 0 ? '+' : ''}${upMax}% / 최저 ${upMin > 0 ? '+' : ''}${upMin}%`;
            } else {
                targetRangeStr = `\n   🎯 ${minT.toLocaleString()}~${maxT.toLocaleString()}원`;
            }
        }

        // 컨센서스 + PER/PBR
        let consensusStr = '';
        const cons = s.ticker ? consensusMap[s.ticker] : null;
        if (cons?.actual != null) {
            const beatIcon  = cons.beatConsensus ? '✅' : '❌';
            const beatLabel = cons.beatConsensus ? '성장 기대' : '성장 기대 없음';
            const chain = [`${cons.actualPeriod} **${cons.actual?.toLocaleString()}억**`];
            if (cons.estRows?.length > 0) {
                cons.estRows.forEach((row, idx) => {
                    const prev  = idx === 0 ? cons.actual : cons.estRows[idx - 1].opProfit;
                    const arrow = row.opProfit > prev ? '📈' : row.opProfit < prev ? '📉' : '➡️';
                    chain.push(`${arrow} ${row.period} ${row.opProfit?.toLocaleString()}억`);
                });
            }
            consensusStr = `\n   💰 ${beatLabel} ${beatIcon} ${chain.join(' → ')}`;
        }

        // PER 추이 + PBR
        let valStr = '';
        if (cons) {
            const pers = cons.estPerRows || [];
            let perStr = '';
            if (pers.length >= 2) {
                const isDown = pers.every((v, i) => i === 0 || v < pers[i - 1]);
                const isUp   = pers.every((v, i) => i === 0 || v > pers[i - 1]);
                const trend  = isDown ? ' ✅' : isUp ? ' ⚠️' : '';
                perStr = `PER ${pers.join(' → ')}배${trend}`;
            } else if (cons.forwardPer != null) {
                perStr = `PER ${cons.forwardPer}배`;
            }
            const parts = [];
            if (perStr) parts.push(perStr);
            if (cons.forwardPbr != null) parts.push(`PBR ${cons.forwardPbr}배`);
            if (parts.length > 0) valStr = `\n   📊 ${parts.join(' | ')}`;
        }

        return `**${i + 1}. [${s.name}](${researchUrl}) (${s.count}건)**${priceStr}${firmStr}${targetRangeStr}${valStr}${consensusStr}`;
    });

    const totalReports = top10.reduce((sum, s) => sum + s.count, 0);
    const embed = {
        title: `📋 [영무문2] 최근 리포트 종목 상위 순위 12 — ${today} (${totalReports}건 분석)`,
        description: lines.join('\n\n'),
        color: 3447003,
        footer: { text: '종목명을 터치하면 네이버 리서치로 이동합니다.' },
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log('✅ [디스코드] 영무문2 결과 전송 완료!');
    } catch (error) {
        console.error('❌ [디스코드] 영무문2 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// 매도 타이밍 분석 결과 전송
// ════════════════════════════════════════════════════════
async function sendSellAnalysisMessage(name, ticker, signals, analystData, buyPrice = null) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_SELL_URL;
    if (!webhookUrl) return;

    const { currentPrice, ma20, ma60, ma120, ma240, rsi, recentHigh, recentLow, fib382, fib618, fib100 } = signals;

    // 저항선 후보 수집 (현재가 초과 레벨만)
    const candidates = [
        { price: ma20,       label: 'MA20' },
        { price: ma60,       label: 'MA60' },
        { price: ma120,      label: 'MA120' },
        { price: ma240,      label: 'MA240' },
        { price: recentHigh, label: '최근 고점' },
        { price: fib382,     label: '피보나치 38.2%' },
        { price: fib618,     label: '피보나치 61.8%' },
        { price: fib100,     label: '피보나치 100%' },
        { price: analystData?.min5,        label: '목표가 하단' },
        { price: analystData?.max5,        label: '목표가 상단' },
        { price: analystData?.latestTarget, label: '최신 목표가' },
    ]
    .filter(c => c.price != null && c.price > currentPrice)
    .sort((a, b) => a.price - b.price);

    // 2% 이내 근접 레벨 병합
    const merged = [];
    for (const c of candidates) {
        const prev = merged[merged.length - 1];
        if (prev && Math.abs(c.price - prev.price) / prev.price < 0.02) {
            prev.label += ` / ${c.label}`;
        } else {
            merged.push({ ...c });
        }
    }

    const t = (idx) => merged[idx] ?? null;
    const pct  = (p) => p ? ` (${((p / currentPrice - 1) * 100).toFixed(1)}%)` : '';
    const fmt  = (p) => p ? `${p.toLocaleString()}원` : '-';

    // 손절 라인
    let stopLoss, stopReason;
    if (buyPrice) {
        const sl = Math.round(buyPrice * 0.95);
        const maBelow = [ma60, ma20].find(m => m && m < currentPrice);
        stopLoss   = (maBelow && maBelow > sl) ? maBelow : sl;
        stopReason = (maBelow && maBelow > sl) ? `${maBelow === ma60 ? 'MA60' : 'MA20'} 이탈` : `매수가 -5% (${buyPrice.toLocaleString()}원 기준)`;
    } else {
        const maBelow = [ma20, ma60].find(m => m && m < currentPrice);
        stopLoss   = maBelow ? Math.round(maBelow * 0.99) : Math.round(currentPrice * 0.95);
        stopReason = maBelow ? `${maBelow === ma20 ? 'MA20' : 'MA60'} 이탈` : '현재가 -5%';
    }

    const chartUrl = `https://m.stock.naver.com/fchart/domestic/stock/${ticker}`;

    // ── 물린 구간 (매수가 > 현재가) ──────────────────────
    const isUnderwater = buyPrice != null && buyPrice > currentPrice;

    if (isUnderwater) {
        const lossPct  = ((currentPrice / buyPrice - 1) * 100).toFixed(1);
        const lossAmt  = (currentPrice - buyPrice).toLocaleString();
        const bepPct   = ((buyPrice / currentPrice - 1) * 100).toFixed(1);

        // 손절선 (현재가 기준)
        const maBelowCur = [ma60, ma20].find(m => m && m < currentPrice);
        const slPrice    = maBelowCur ? Math.round(maBelowCur * 0.99) : Math.round(currentPrice * 0.95);
        const slReason   = maBelowCur ? `${maBelowCur === ma60 ? 'MA60' : 'MA20'} 이탈 -1%` : '현재가 -5%';
        const slPct      = ((slPrice / currentPrice - 1) * 100).toFixed(1);

        // 회복 단계 (저항선 → BEP 기준 분류)
        const stage1 = merged[0] ?? null;
        const stage2 = merged.find(m => m.price >= buyPrice * 0.95) ?? merged[1] ?? null;
        const stage3 = merged.find(m => m.price > buyPrice) ?? merged[2] ?? null;

        const stageLabel = (s) => s
            ? `**${s.price.toLocaleString()}원** (현재가比 +${((s.price / currentPrice - 1) * 100).toFixed(1)}%)\n   근거: ${s.label}`
            : '해당 구간 없음';

        // 애널리스트 목표가 vs 매수가
        const a = analystData;
        const midTarget = (a?.min5 && a?.max5) ? Math.round((a.min5 + a.max5) / 2) : a?.latestTarget;
        const targetAboveBuy = midTarget && midTarget > buyPrice;

        // RSI 해석 (물린 상황에선 과매도가 반등 신호)
        const rsiLabel = rsi < 30 ? '🟢 강한 과매도 — 단기 반등 가능성 높음'
                       : rsi < 40 ? '🟡 과매도 구간 — 반등 주목'
                       : rsi < 50 ? '⚪ 하락 추세 — 바닥 확인 필요'
                       : rsi < 60 ? '⚪ 중립'
                       :            '🟠 반등 진행 중';

        // 종합 판단
        const verdict = (() => {
            if (!midTarget || midTarget < buyPrice) {
                return rsi < 40
                    ? '🟡 목표가 < 매수가이나 RSI 과매도\n→ 단기 반등(1단계) 시 손실 최소화 고려'
                    : '🔴 목표가 < 매수가 + 반등 신호 미약\n→ 1단계 반등 시 손실 최소화 매도 적극 검토';
            }
            return rsi < 40
                ? '🟢 목표가 > 매수가 + RSI 과매도\n→ 단기 반등 후 2~3단계까지 단계적 보유 전략'
                : '🟡 목표가 > 매수가 — 추세 회복 여부 확인 후\n→ MA 정배열 회복 시 보유 전략 유효';
        })();

        const lines = [
            `💰 현재가: **[${currentPrice.toLocaleString()}원](${chartUrl})**`,
            `   매수가 **${buyPrice.toLocaleString()}원** 대비 🔻 **${lossPct}%** (${lossAmt}원)`,
            `   📍 손익분기(BEP)까지 **+${bepPct}%** 필요`,
            '',
            `━━ 🔴 손절 판단 ━━`,
            `손절선: **${slPrice.toLocaleString()}원** (${slPct}%)\n   근거: ${slReason}`,
            '',
            `━━ 📈 회복 시나리오 ━━`,
            `🟡 1단계 반등: ${stageLabel(stage1)}\n   → 단기 반등 구간, 추가 손실 방지 고려`,
            '',
            `🟡 2단계 회복: ${stageLabel(stage2)}\n   → ${stage2 && stage2.price >= buyPrice ? 'BEP 달성 구간 — 손익 중립' : 'BEP 접근 구간 — 손실 축소'}`,
            '',
            `🟢 3단계 수익전환: ${stageLabel(stage3)}\n   → BEP ${buyPrice.toLocaleString()}원 이상, 수익 전환 구간`,
            '',
            `━━ 📊 보유 판단 근거 ━━`,
            `RSI: **${rsi}** — ${rsiLabel}`,
            [ma20 && `MA20: ${ma20.toLocaleString()}`, ma60 && `MA60: ${ma60.toLocaleString()}`, ma120 && `MA120: ${ma120.toLocaleString()}`].filter(Boolean).join(' | '),
            midTarget
                ? (targetAboveBuy
                    ? `✅ 목표가 중간값 **${midTarget.toLocaleString()}원** > 매수가 — 장기 보유 근거 있음`
                    : `⚠️ 목표가 중간값 **${midTarget.toLocaleString()}원** < 매수가 — 장기 보유 근거 약함`)
                : '목표가 데이터 없음',
            '',
            `━━ 💡 종합 판단 ━━`,
            verdict,
        ].join('\n');

        const embed = {
            title: `🔻 [${name}] 물린 구간 대응 분석`,
            description: lines,
            color: 10038562,
            footer: { text: '기술적 분석 기반 참고용 — 투자 결정은 본인 판단으로' },
            timestamp: new Date().toISOString(),
        };
        try {
            await axios.post(webhookUrl, { embeds: [embed] });
            console.log(`✅ [디스코드] 물린구간 매도 분석 전송 완료! (${name})`);
        } catch (error) {
            console.error('❌ [디스코드] 물린구간 분석 전송 실패:', error.message);
        }
        return;
    }

    // ── 수익 구간 (기존 로직) ────────────────────────────
    const rsiLabel = rsi >= 80 ? '🔴 과매수 강함' : rsi >= 70 ? '🟠 과매수 경계' : rsi >= 60 ? '🟡 상승 추세' : '🟢 정상';

    // 매수가 기준 수익률
    const fromBuy = (p) => buyPrice && p
        ? ` (매수가比 ${((p / buyPrice - 1) * 100).toFixed(1)}%)`
        : '';

    // 현재 수익률 (매수가 있을 때)
    const curPnl = buyPrice ? (() => {
        const r = ((currentPrice / buyPrice - 1) * 100).toFixed(1);
        const sign = r >= 0 ? '+' : '';
        const icon = r >= 0 ? '🔺' : '🔻';
        return `\n   매수가 **${buyPrice.toLocaleString()}원** 대비 ${icon} **${sign}${r}%** (${(currentPrice - buyPrice).toLocaleString()}원)`;
    })() : '';

    const lines = [
        `💰 현재가: **[${currentPrice.toLocaleString()}원](${chartUrl})**${curPnl}`,
        '',
        `━━ 1차 매도 (30% 물량) ━━`,
        t(0) ? `🎯 **${fmt(t(0).price)}**${pct(t(0).price)}${fromBuy(t(0).price)}\n   근거: ${t(0).label}` : '🎯 해당 구간 없음',
        '',
        `━━ 2차 매도 (30% 물량) ━━`,
        t(1) ? `🎯 **${fmt(t(1).price)}**${pct(t(1).price)}${fromBuy(t(1).price)}\n   근거: ${t(1).label}` : '🎯 해당 구간 없음',
        '',
        `━━ 3차 매도 (나머지 40%) ━━`,
        t(2) ? `🎯 **${fmt(t(2).price)}**${pct(t(2).price)}${fromBuy(t(2).price)}\n   근거: ${t(2).label}` : '🎯 해당 구간 없음',
        '',
        `━━ 손절 라인 ━━`,
        `🔴 **${fmt(stopLoss)}**${pct(stopLoss)}${fromBuy(stopLoss)}\n   근거: ${stopReason}`,
        '',
        `━━ 기술 지표 ━━`,
        `RSI ${rsi} — ${rsiLabel}`,
        [ma20 && `MA20: ${ma20.toLocaleString()}`, ma60 && `MA60: ${ma60.toLocaleString()}`, ma120 && `MA120: ${ma120.toLocaleString()}`].filter(Boolean).join(' | '),
        `최근 고점: ${recentHigh.toLocaleString()} | 저점: ${recentLow.toLocaleString()}`,
        '',
        ...(() => {
            const a = analystData;
            if (!a?.latestTarget) return ['━━ 리서치 분석 ━━', '🎯 리포트 데이터 없음'];

            const lines = ['━━ 리서치 분석 ━━'];

            // 목표가 상향/하향 추이 (비교 가능 증권사)
            if (a.totalCompared > 0) {
                const trendIcon  = a.targetRaised ? '✅' : a.targetDown ? '❌' : '➡️';
                const trendLabel = a.targetRaised ? '상향 우세' : a.targetDown ? '하향 우세' : '유지';
                const countStr   = [
                    a.raised     > 0 ? `${a.raised}개사↑`    : null,
                    a.dropped    > 0 ? `${a.dropped}개사↓`   : null,
                    a.maintained > 0 ? `${a.maintained}개사→` : null,
                ].filter(Boolean).join(' · ');
                lines.push(`${trendIcon} 목표가 ${trendLabel} (${countStr})`);

                const upFirms   = a.firmDetails?.filter(f => f.includes('↑')).join(' · ');
                const downFirms = a.firmDetails?.filter(f => f.includes('↓')).join(' · ');
                const maintFirms = a.firmDetails?.filter(f => !f.includes('↑') && !f.includes('↓')).join(' · ');
                if (upFirms)    lines.push(`   ↑ ${upFirms}`);
                if (downFirms)  lines.push(`   ↓ ${downFirms}`);
                if (maintFirms) lines.push(`   → ${maintFirms}`);
            }

            // 단일 리포트 증권사 (비교 불가 — totalCompared 여부 무관하게 항상 표시)
            if (a.singleFirms?.length > 0) {
                const firms = a.singleFirms.slice(0, 6);
                const firmList = firms.map(f => `${f.firm} **${f.price?.toLocaleString()}원**`).join(' · ');
                const prefix = a.totalCompared > 0 ? '📋 단일 리포트' : '📋 각 사 최신 목표가';
                lines.push(`${prefix}`);
                lines.push(`   ${firmList}`);

                // 스프레드 (단일 포함 전체 가격 기준)
                const allPrices = [
                    ...firms.map(f => f.price),
                    ...(a.firmDetails || []).map(f => {
                        const m = f.match(/([\d,]+)\)$/);
                        return m ? Number(m[1].replace(/,/g, '')) : null;
                    }),
                ].filter(Boolean);
                if (allPrices.length >= 2) {
                    const spread = ((Math.max(...allPrices) - Math.min(...allPrices)) / Math.min(...allPrices) * 100).toFixed(1);
                    const spreadLabel = spread < 5  ? '✅ 컨센서스 일치 (신뢰도 높음)'
                                      : spread < 15 ? '🟡 일부 견해 차이'
                                      :               '🟠 전망 불확실 (보수적 접근 권고)';
                    lines.push(`   스프레드 ${spread}% — ${spreadLabel}`);
                }
            }

            // 목표가 범위
            if (a.min5 && a.max5) {
                lines.push(`🎯 목표가 범위: ${a.min5.toLocaleString()}~${a.max5.toLocaleString()}원`);
            }

            // 목표가 달성률 + 매도 판단 코멘트
            const midTarget = (a.min5 && a.max5) ? Math.round((a.min5 + a.max5) / 2) : a.latestTarget;
            const achvRate  = midTarget ? ((currentPrice / midTarget) * 100).toFixed(1) : null;
            if (achvRate) {
                const rate = parseFloat(achvRate);
                let comment;
                if (rate >= 98)       comment = '🔴 목표가 도달 — 매도 적극 검토';
                else if (rate >= 90)  comment = '🟠 목표가 근접 — 1~2차 익절 고려';
                else if (rate >= 75)  comment = '🟡 목표가 중간 지점 — 2차 매도 구간';
                else if (rate >= 50)  comment = '🟢 목표가까지 여유 있음 — 3차까지 보유 유효';
                else                  comment = '💚 목표가 대비 저평가 — 장기 보유 가능';
                lines.push(`📍 목표가 중간값 대비 **${achvRate}%** 도달 — ${comment}`);
            }

            return lines;
        })(),
    ].join('\n');

    const embed = {
        title: `📤 [${name}] 매도 타이밍 분석`,
        description: lines,
        color: 15548997,
        footer: { text: '기술적 분석 기반 참고용 — 투자 결정은 본인 판단으로' },
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`✅ [디스코드] 매도 분석 전송 완료! (${name})`);
    } catch (error) {
        console.error('❌ [디스코드] 매도 분석 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// 영욱문 — 단일 종목 종합 분석 결과 전송
// ════════════════════════════════════════════════════════
async function sendYoungookMessage(name, ticker, tech, investor, analystData, consensus, dividendInfo = null) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_YOUNGOOK_URL;
    if (!webhookUrl) return;

    const currentPrice = tech?.currentPrice;
    const chartUrl     = `https://m.stock.naver.com/fchart/domestic/stock/${ticker}`;
    const researchUrl  = `https://m.stock.naver.com/domestic/stock/${ticker}/research`;

    const lines = [];

    // ── 현재가 ──
    lines.push(`💰 현재가: **[${currentPrice?.toLocaleString() ?? '-'}원](${chartUrl})**`);
    lines.push('');

    // ── 증권사 목표가 (최근 90일) ──
    lines.push(`━━ 🎯 [증권사 목표가 (최근 20건)](${researchUrl}) ━━`);
    const a = analystData;
    if (a?.latestReportDate) {
        const daysDiff = Math.floor((Date.now() - new Date(a.latestReportDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysDiff > 90) {
            const lateDateStr = new Date(a.latestReportDate).toISOString().slice(2, 10).replace(/-/g, '.');
            lines.push(`⚠️ 가장 최근 리포트: ${lateDateStr} (약 ${Math.floor(daysDiff / 30)}개월 전)`);
        }
    }
    // 날짜 문자열(YY.MM.DD)이 90일 초과인지 확인
    const isOlderThan90 = (dateStr) => {
        if (!dateStr) return false;
        const m = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
        if (!m) return false;
        return (Date.now() - new Date(`20${m[1]}-${m[2]}-${m[3]}`).getTime()) > 90 * 86400000;
    };

    if (!a?.latestTarget) {
        lines.push(`[리포트 데이터 없음](${researchUrl})`);
    } else {
        if (a.totalCompared > 0) {
            const trendIcon  = a.targetRaised ? '✅' : a.targetDown ? '❌' : '➡️';
            const trendLabel = a.targetRaised ? '상향 우세' : a.targetDown ? '하향 우세' : '유지';
            const countParts = [
                a.raised     > 0 ? `${a.raised}개사↑`     : null,
                a.dropped    > 0 ? `${a.dropped}개사↓`    : null,
                a.maintained > 0 ? `${a.maintained}개사→` : null,
            ].filter(Boolean).join(' · ');
            lines.push(`${trendIcon} 목표가 **${trendLabel}** (${countParts})`);

            const addDate = (str) => {
                const firm = str.match(/^(.+?)\s[↑↓→]/)?.[1];
                const d = firm ? a.firmDatesMap?.[firm] : null;
                if (!d) return str;
                const oldMark = isOlderThan90(d) ? ' ⚠️90일+' : '';
                return `${str}  ${d}${oldMark}`;
            };
            const upFirms    = a.firmDetails?.filter(f =>  f.includes('↑')).map(addDate) || [];
            const downFirms  = a.firmDetails?.filter(f =>  f.includes('↓')).map(addDate) || [];
            const maintFirms = a.firmDetails?.filter(f => !f.includes('↑') && !f.includes('↓')).map(addDate) || [];
            upFirms.forEach(f    => lines.push(`   ↑ ${f}`));
            downFirms.forEach(f  => lines.push(`   ↓ ${f}`));
            maintFirms.forEach(f => lines.push(`   → ${f}`));
        }

        if (a.singleFirms?.length > 0) {
            const prefix = a.totalCompared > 0 ? '📋 단일 리포트' : '📋 각 사 최신 목표가';
            lines.push(`${prefix}:`);
            a.singleFirms.slice(0, 8).forEach(f => {
                const d       = f.dateStr ? `  ${f.dateStr}` : '';
                const oldMark = f.dateStr && isOlderThan90(f.dateStr) ? ' ⚠️90일+' : '';
                lines.push(`   ${f.firm} **${f.price?.toLocaleString()}원**${d}${oldMark}`);
            });
        }

        if (a.min5 && a.max5) {
            const upsideMax = currentPrice ? (((a.max5 / currentPrice) - 1) * 100).toFixed(1) : null;
            const upsideMin = currentPrice ? (((a.min5 / currentPrice) - 1) * 100).toFixed(1) : null;
            lines.push(`🎯 목표가 범위: **${a.min5.toLocaleString()}~${a.max5.toLocaleString()}원**`);
            if (upsideMax != null && upsideMin != null) {
                lines.push(`   현재가 대비 최고 +${upsideMax}% / 최저 +${upsideMin}%`);
            }
        }

        const midTarget = (a.min5 && a.max5) ? Math.round((a.min5 + a.max5) / 2) : a.latestTarget;
        const achvRate  = (currentPrice && midTarget) ? ((currentPrice / midTarget) * 100).toFixed(1) : null;
        if (achvRate) {
            const rate    = parseFloat(achvRate);
            const comment = rate >= 98 ? '🔴 목표가 도달 — 매도 적극 검토'
                          : rate >= 90 ? '🟠 목표가 근접 — 1~2차 익절 고려'
                          : rate >= 75 ? '🟡 목표가 중간 지점'
                          : rate >= 50 ? '🟢 목표가까지 여유 있음'
                          :              '💚 목표가 대비 저평가';
            lines.push(`📍 목표가 달성률: **${achvRate}%** — ${comment}`);
        }

        const allPrices = [
            ...(a.singleFirms?.map(f => f.price) || []),
            ...(a.firmDetails || []).map(f => {
                const m = f.match(/([\d,]+)\)$/);
                return m ? Number(m[1].replace(/,/g, '')) : null;
            }),
        ].filter(Boolean);
        if (allPrices.length >= 2) {
            const spread      = ((Math.max(...allPrices) - Math.min(...allPrices)) / Math.min(...allPrices) * 100).toFixed(1);
            const spreadLabel = spread < 5  ? '✅ 의견 일치 (신뢰도 높음)'
                              : spread < 15 ? '🟡 일부 견해 차이'
                              :               '🟠 전망 불확실 (보수적 접근 권고)';
            lines.push(`   스프레드 ${spread}% — ${spreadLabel}`);
        }
    }
    lines.push('');

    // ── 컨센서스 (영업이익) ──
    lines.push('━━ 📈 컨센서스 (영업이익) ━━');
    const c = consensus;
    if (!c?.actual) {
        lines.push('컨센서스 데이터 없음');
    } else {
        lines.push(`${c.actualPeriod} **${c.actual?.toLocaleString()}억**`);
        if (c.estRows?.length > 0) {
            c.estRows.forEach((row, i) => {
                const prev   = i === 0 ? c.actual : c.estRows[i - 1].opProfit;
                const arrow  = row.opProfit > prev ? '📈' : row.opProfit < prev ? '📉' : '➡️';
                const pct    = prev ? ((row.opProfit / prev - 1) * 100).toFixed(1) : null;
                const pctStr = pct != null ? `  (+${pct}%)`.replace('+-', '-') : '';
                lines.push(`${arrow} ${row.period} **${row.opProfit?.toLocaleString()}억**${pctStr}`);
            });
        }

        if (c.estPerRows?.length > 0) {
            const perArr = c.estPerRows.map(p => `${p}배`);
            const allDown = c.estPerRows.every((p, i) => i === 0 || p < c.estPerRows[i - 1]);
            const perIcon = allDown ? '✅ 낮아지는 중 (밸류에이션 개선)' : '⚠️ 높아지는 중 (주의)';
            lines.push(`PER 추이: ${perArr.join(' → ')}  ${perIcon}`);
        }

        const valParts = [];
        if (c.forwardPer != null) valParts.push(`Forward PER: **${c.forwardPer}배**`);
        if (c.forwardPbr != null) valParts.push(`PBR: **${c.forwardPbr}배**`);
        if (valParts.length > 0) lines.push(valParts.join(' | '));
    }
    lines.push('');

    // ── 기술적 지표 ──
    lines.push('━━ 📉 기술적 지표 ━━');
    if (!tech?.valid) {
        lines.push('기술적 데이터 없음');
    } else {
        const maIcon  = tech.maAlignment ? '✅' : '❌';
        const gcIcon  = tech.goldenCross ? '✅' : '❌';
        const volIcon = tech.volumeSpike ? '🔊 있음' : '없음';
        lines.push(`MA 정배열: ${maIcon}  |  골든크로스(최근 5일): ${gcIcon}  |  거래량 급증: ${volIcon}`);

        const rsi      = tech.rsi;
        const rsiLabel = rsi >= 80 ? '🔴 과매수 강함'
                       : rsi >= 70 ? '🟠 과매수 경계'
                       : rsi >= 60 ? '🟡 상승 추세'
                       :              '🟢 정상';
        lines.push(`RSI(14): **${rsi ?? 'N/A'}** — ${rsiLabel}`);

        const maStr = [
            tech.ma5  != null ? `MA5: ${tech.ma5.toLocaleString()}`  : null,
            tech.ma20 != null ? `MA20: ${tech.ma20.toLocaleString()}` : null,
            tech.ma60 != null ? `MA60: ${tech.ma60.toLocaleString()}` : null,
        ].filter(Boolean).join(' | ');
        if (maStr) lines.push(maStr);

        // 주가 모멘텀
        if (tech.momentum) {
            const { w1, m1, m3 } = tech.momentum;
            const fmtP = (v) => v == null ? 'N/A' : `${v > 0 ? '+' : ''}${v}%`;
            const mIcon = (v) => v == null ? '' : v >= 10 ? ' 🔥' : v >= 3 ? ' 📈' : v >= 0 ? ' 🟢' : v >= -5 ? ' 📉' : ' ❄️';
            lines.push(`📈 모멘텀: 1주 **${fmtP(w1)}**${mIcon(w1)}  |  1개월 **${fmtP(m1)}**${mIcon(m1)}  |  3개월 **${fmtP(m3)}**${mIcon(m3)}`);
        }

        // 볼린저밴드
        if (tech.bollinger) {
            const { upper, mid, lower, position } = tech.bollinger;
            const filled  = Math.min(10, Math.max(0, Math.round(position / 10)));
            const bar     = '█'.repeat(filled) + '░'.repeat(10 - filled);
            const bbLabel = position >= 95 ? '🔴 밴드 상단 돌파'
                          : position >= 75 ? '🟠 상단 근접'
                          : position >= 40 ? '🟡 중단권'
                          : position >= 20 ? '🟢 하단~중단'
                          :                  '💚 하단권 (과매도 가능)';
            lines.push(`📊 볼린저밴드: 상단 **${upper.toLocaleString()}** / 중단 ${mid.toLocaleString()} / 하단 ${lower.toLocaleString()}`);
            lines.push(`   [${bar}] ${position}%  ${bbLabel}`);
        }
    }
    lines.push('');

    // ── 배당 정보 ──
    lines.push('━━ 💰 배당 정보 ━━');
    const d = dividendInfo;
    if (!d || d.latestDps == null) {
        lines.push('무배당 종목');
    } else {
        // DPS 추이
        if (d.dpsHistory?.length > 0) {
            const histStr = d.dpsHistory.map(h => `${h.year} **${h.dps.toLocaleString()}원**`).join(' → ');
            lines.push(`주당배당금: ${histStr}`);
        }

        // 현재가 기준 실적 배당수익률
        if (currentPrice && d.latestDps) {
            const yld  = (d.latestDps / currentPrice * 100).toFixed(2);
            const grade = yld >= 4   ? '🟢 고배당'
                        : yld >= 2   ? '🟡 중간 배당'
                        : yld >= 0.5 ? '⚪ 저배당'
                        :              '⚪ 소액 배당';
            lines.push(`현재가 기준 수익률: **${yld}%** (${d.latestFiscalYear} 실적)  ${grade}`);
        }

        // 컨센서스 예상 DPS + 예상 수익률
        if (d.forwardDps) {
            const fwdYld = currentPrice ? (d.forwardDps / currentPrice * 100).toFixed(2) : null;
            const fwdGrade = fwdYld >= 4   ? '🟢 고배당'
                           : fwdYld >= 2   ? '🟡 중간 배당'
                           : fwdYld >= 0.5 ? '⚪ 저배당'
                           :                 '⚪ 소액 배당';
            lines.push(`예상 주당배당금: **${d.forwardDps.toLocaleString()}원** (${d.forwardFiscalYear} 컨센서스)`);
            if (fwdYld) lines.push(`   예상 수익률: **${fwdYld}%**  ${fwdGrade}`);
        }
    }
    lines.push('');

    // ── 수급 동향 (최근 3일) ──
    lines.push('━━ 👥 수급 동향 (최근 3일) ━━');
    lines.push(`🌏 외국인: ${investor?.foreignBuy ? '✅ 3일 연속 순매수' : '❌ 혼조'}`);
    lines.push(`🏦 기관:   ${investor?.instBuy    ? '✅ 3일 연속 순매수' : '❌ 혼조'}`);

    const embed = {
        title: `🔍 [${name} (${ticker})] 종목 종합 분석`,
        url: researchUrl,
        description: lines.join('\n'),
        color: 10181046,
        footer: { text: '기술적 분석 기반 참고용 — 투자 결정은 본인 판단으로' },
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`✅ [디스코드] 영욱문 분석 전송 완료! (${name})`);
    } catch (error) {
        console.error('❌ [디스코드] 영욱문 분석 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// 영욱문2 — WiseReport 리포트 서머리 전송
// A안: Buy 종목 상승여력 순 상위 10건 + 목표가/전일가 표시
// ════════════════════════════════════════════════════════
async function sendWiseReportSummaryMessage(allReports) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_YOUNGOOK_URL;
    if (!webhookUrl) return;

    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');

    // Buy 의견 종목만 필터 → 상승여력 내림차순 → 상위 10건
    const buyReports = allReports
        .filter(r => r.opinion?.toLowerCase().includes('buy') || r.opinion?.includes('매수'))
        .sort((a, b) => (b.upside ?? -Infinity) - (a.upside ?? -Infinity))
        .slice(0, 10);

    const totalCount = allReports.length;
    const buyCount   = buyReports.length;

    const lines = buyReports.map((r, i) => {
        const upsideStr = r.upside != null ? `**+${r.upside.toFixed(1)}%**` : '-';
        const targetStr = r.targetPx ? `목표가 **${r.targetPx.toLocaleString()}원**` : '목표가 -';
        const prevStr   = r.prevPx   ? `전일가 ${r.prevPx.toLocaleString()}원` : '';
        const analystStr = r.analyst ? ` · ${r.analyst}` : '';
        const firstPoint = r.points[0] ? `\n   ▶ ${r.points[0]}` : '';
        const researchUrl = `https://m.stock.naver.com/domestic/stock/${r.ticker}/research`;

        return [
            `**${i + 1}. [${r.name} (${r.ticker})](${researchUrl})** 📈 ${r.opinion}  ${upsideStr}`,
            `   ${r.firm}${analystStr}  |  ${targetStr}  |  ${prevStr}`,
            `   💬 "${r.title}"${firstPoint}`,
        ].join('\n');
    });

    const embed = {
        title: `📋 [리포트 서머리] 기업 | ${today} (전체 ${totalCount}건 중 Buy 상위 ${buyCount}건)`,
        url: 'https://comp.wisereport.co.kr/wiseReport/summary/ReportSummary.aspx?fmt=1',
        description: lines.join('\n\n'),
        color: 3066993,
        footer: { text: '종목명 터치 → 네이버 리서치 · WiseReport 기업 서머리 기준' },
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`✅ [디스코드] 영욱문2 서머리 전송 완료! (${buyCount}건)`);
    } catch (error) {
        console.error('❌ [디스코드] 영욱문2 서머리 전송 실패:', error.message);
    }
}

// ════════════════════════════════════════════════════════
// 영욱문리포트산업 — WiseReport 산업 리포트 서머리 전송
// ════════════════════════════════════════════════════════
async function sendWiseReportIndustrySummaryMessage(reports) {
    const webhookUrl = process.env.DISCORD_WEBHOOK_YOUNGOOK_URL;
    if (!webhookUrl) return;

    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '-').replace('.', '');

    const lines = reports.map((r, i) => {
        // 투자의견 변경 표시
        const opinionChanged = r.opinion && r.prevOpinion && r.opinion !== r.prevOpinion;
        const opinionStr = opinionChanged
            ? `${r.prevOpinion} → **${r.opinion}** 🔄`
            : r.opinion ? `**${r.opinion}**` : '-';

        const analystStr  = r.analyst ? ` · ${r.analyst}` : '';
        const firstPoint  = r.points[0] ? `\n   ▶ ${r.points[0]}` : '';
        const secondPoint = r.points[1] ? `\n   ▶ ${r.points[1]}` : '';

        return [
            `**${i + 1}. ${r.industry}**  ${opinionStr}`,
            `   ${r.firm}${analystStr}`,
            `   💬 "${r.title}"${firstPoint}${secondPoint}`,
        ].join('\n');
    });

    const embed = {
        title: `📊 [리포트 서머리] 산업 | ${today} (${reports.length}건)`,
        url: 'https://comp.wisereport.co.kr/wiseReport/summary/ReportSummary.aspx?fmt=2',
        description: lines.join('\n\n'),
        color: 15105570,
        footer: { text: 'WiseReport 산업 서머리 기준' },
        timestamp: new Date().toISOString(),
    };

    try {
        await axios.post(webhookUrl, { embeds: [embed] });
        console.log(`✅ [디스코드] 영욱문리포트산업 전송 완료! (${reports.length}건)`);
    } catch (error) {
        console.error('❌ [디스코드] 영욱문리포트산업 전송 실패:', error.message);
    }
}

module.exports = {
    sendDiscordMessage,
    sendJypPicksMessage,
    sendJypIntradayAlertMessage,
    sendMooScreeningMessage,
    sendMoo2Message,
    sendSellAnalysisMessage,
    sendYoungookMessage,
    sendWiseReportSummaryMessage,
    sendWiseReportIndustrySummaryMessage,
};