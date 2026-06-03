// ════════════════════════════════════════════════════════
// 스코어링 엔진
// 총 11점 만점 / 6점 이상 → 디스코드 알림
// 외국인/기관 순매수, RSI는 참고용 표시만 하고 점수에서 제외
// ════════════════════════════════════════════════════════

const SCORE_THRESHOLD = 4;

const SCORES = {
    maAlignment:   2,
    volumeSpike:   2,
    targetRaised:  4,
    targetDown:   -1,
    beatConsensus: 3,
};

function calcScore(data) {
    let score = 0;
    const breakdown = [];

    if (data.maAlignment)   { score += SCORES.maAlignment;   breakdown.push('정배열 +2'); }
    if (data.volumeSpike)   { score += SCORES.volumeSpike;   breakdown.push('거래량급증 +2'); }
    if (data.targetRaised)  { score += SCORES.targetRaised;  breakdown.push('목표가상향 +4'); }
    if (data.targetDown)    { score += SCORES.targetDown;    breakdown.push('목표가하향 -1'); }
    if (data.beatConsensus) { score += SCORES.beatConsensus; breakdown.push('컨센서스성장기대 +3'); }

    return { score, breakdown };
}

function getGrade(score) {
    if (score >= 14) return 'S';
    if (score >= 11) return 'A';
    if (score >= SCORE_THRESHOLD) return 'B';
    return null;
}

function gradeEmoji(grade) {
    return { S: '🔥', A: '⭐', B: '✅' }[grade] || '';
}

module.exports = { calcScore, getGrade, gradeEmoji, SCORE_THRESHOLD };
