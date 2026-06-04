const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const NAVER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'ko-KR,ko;q=0.9',
    Referer: 'https://finance.naver.com/',
};

// EUC-KR 페이지 fetch → UTF-8 문자열 반환
async function fetchEucKr(url) {
    const res = await axios.get(url, {
        headers: NAVER_HEADERS,
        responseType: 'arraybuffer',
        timeout: 10000,
    });
    return iconv.decode(Buffer.from(res.data), 'euc-kr');
}

// ════════════════════════════════════════════════════════
// [3단계] 애널리스트 목표가 분석 — 동일 증권사 내 비교
//
// 흐름:
//   1. 리스트 페이지에서 최근 90일 리포트 링크/날짜/증권사 추출
//   2. 최대 10개 상세 페이지에서 목표가 수집
//   3. 증권사별 그룹핑 후 각 사의 최신 vs 직전 목표가 비교
//   4. 상향/하향/유지 건수 집계 → 과반 방향으로 판단
// ════════════════════════════════════════════════════════
async function scrapeAnalystTarget(ticker) {
    try {
        const listUrl = `https://finance.naver.com/research/company_list.naver?searchType=itemCode&itemCode=${ticker}`;
        const listHtml = await fetchEucKr(listUrl);
        const $ = cheerio.load(listHtml);

        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90); // 90일 이내 리포트 대상

        const reports = [];
        $('table').first().find('tbody tr').each((_, row) => {
            const tds = $(row).find('td');
            if (tds.length < 5) return;
            const href    = $(tds[1]).find('a').attr('href');
            const dateStr = $(tds[4]).text().trim();
            const firm    = $(tds[2]).text().trim();
            if (!href || !dateStr) return;
            const reportDate = parseNaverDate(dateStr);
            if (!reportDate || reportDate < cutoff) return;
            reports.push({
                href: href.startsWith('http') ? href : `https://finance.naver.com/research/${href}`,
                date: reportDate,
                firm,
            });
        });

        console.log(`  [${ticker}] 최근 90일 리포트: ${reports.length}건`);

        if (reports.length === 0) {
            return _emptyTarget();
        }

        // 최신순 정렬 후 최대 10개 상세 조회
        reports.sort((a, b) => b.date - a.date);
        const targets = [];

        for (const report of reports.slice(0, 10)) {
            try {
                const detailHtml = await fetchEucKr(report.href);
                const $d = cheerio.load(detailHtml);
                const infoText = $d('table').first().find('td').first().text().trim();
                const match = infoText.match(/목표가\s*([\d,]+)/);
                if (match) {
                    const price = Number(match[1].replace(/,/g, ''));
                    targets.push({ price, firm: report.firm, date: report.date });
                    console.log(`  [${ticker}] ${report.firm}: ${price.toLocaleString()}원 (${report.date.toISOString().slice(0,10)})`);
                }
                await delay(400);
            } catch (err) {
                console.warn(`  [${ticker}] 상세 페이지 조회 실패:`, err.message);
            }
        }

        if (targets.length === 0) return _emptyTarget();

        // ── 증권사별 그룹핑 후 동일 증권사 내 비교 ──
        const firmMap = {};
        for (const t of targets) {
            if (!firmMap[t.firm]) firmMap[t.firm] = [];
            firmMap[t.firm].push(t); // 이미 최신순 정렬된 상태
        }

        let raised = 0, dropped = 0, maintained = 0;
        const firmDetails = [];

        for (const [firm, list] of Object.entries(firmMap)) {
            if (list.length < 2) continue; // 리포트 1개뿐이면 비교 불가
            const latest = list[0].price;
            const prev   = list[1].price;
            if (latest > prev)      { raised++;     firmDetails.push(`${firm} ↑(${prev.toLocaleString()}→${latest.toLocaleString()})`); }
            else if (latest < prev) { dropped++;    firmDetails.push(`${firm} ↓(${prev.toLocaleString()}→${latest.toLocaleString()})`); }
            else                    { maintained++; firmDetails.push(`${firm} →(${latest.toLocaleString()})`); }
        }

        // 비교 불가 단일 리포트 증권사 (최신 목표가만 보유)
        const singleFirms = [];
        for (const [firm, list] of Object.entries(firmMap)) {
            if (list.length === 1) singleFirms.push({ firm, price: list[0].price });
        }

        // 최근 5건 최저/최고 (참고용)
        const recent5 = targets.slice(0, 5).map((t) => t.price);
        const min5 = Math.min(...recent5);
        const max5 = Math.max(...recent5);

        const totalCompared = raised + dropped + maintained;
        console.log(`  [${ticker}] 목표가 비교 가능: ${totalCompared}개사 | 상향 ${raised} / 하향 ${dropped} / 유지 ${maintained} | 단일: ${singleFirms.length}개사`);

        return {
            targetRaised:  raised > dropped,
            targetDown:    dropped > raised,
            raised,
            dropped,
            maintained,
            totalCompared,
            firmDetails,
            singleFirms,
            latestTarget: targets[0].price,
            min5,
            max5,
        };
    } catch (err) {
        console.warn(`  [${ticker}] 목표가 스크래핑 실패:`, err.message);
        return _emptyTarget();
    }
}

function _emptyTarget() {
    return { targetRaised: false, targetDown: false, raised: 0, dropped: 0, maintained: 0, totalCompared: 0, firmDetails: [], latestTarget: null, min5: null, max5: null };
}

// ════════════════════════════════════════════════════════
// [4단계] 컨센서스 영업이익 분석
//
// cF1002.aspx 테이블 구조 (encparam 불필요):
//   재무년월     | 매출액(금액) | 매출액(YoY) | 영업이익 | 당기순이익 | ...
//   2023.12(A)  | 2,589,355   | -14.33      | 65,670   | 144,734   | ...
//   2025.12(A)  | 3,336,059   | 10.88       | 436,011  | ...
//   2026.12(E)  | ...         | ...         | 추정치   | ...
//
// 판단 기준:
//   1. 가장 최근 (A) 영업이익 vs 가장 빠른 (E) 영업이익 비교
//   2. (E) 여러 개면 순차 증가 여부 → 성장 추세
// ════════════════════════════════════════════════════════
async function scrapeConsensus(ticker) {
    try {
        const sDT = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const res = await axios.get('https://navercomp.wisereport.co.kr/company/ajax/c1050001_data.aspx', {
            headers: { ...NAVER_HEADERS, 'X-Requested-With': 'XMLHttpRequest',
                Referer: `https://navercomp.wisereport.co.kr/v2/company/c1050001.aspx?cmp_cd=${ticker}` },
            params: { flag: '2', cmp_cd: ticker, finGubun: 'IFRSL', frq: '0', sDT },
            timeout: 10000,
        });

        const data = res.data?.JsonData;
        if (!Array.isArray(data) || data.length === 0) {
            return { beatConsensus: false, actual: null, consensus: null, estTrend: null };
        }

        const actualRows = [];
        const estRows    = [];

        for (const v of data) {
            const period   = v.YYMM?.trim();
            const opProfit = parseKorNum(String(v.OP ?? ''));
            if (!period || opProfit === null) continue;
            if (period.includes('(A)')) actualRows.push({ period, opProfit });
            if (period.includes('(E)')) estRows.push({ period, opProfit });
        }

        // (E) 행 전체에서 PER 추이 + 첫 번째 (E) 행 PBR 추출
        const estPerRows = [];
        let forwardPbr = null;
        for (const v of data) {
            if (!v.YYMM?.includes('(E)')) continue;
            const per = parseKorNum(String(v.PER ?? ''));
            if (per != null && per > 0) estPerRows.push(per);
            if (forwardPbr === null) forwardPbr = parseKorNum(String(v.PBR ?? ''));
        }
        const forwardPer = estPerRows[0] ?? null;

        console.log(`  [${ticker}] 실적 rows: ${actualRows.map(r=>r.period+'='+r.opProfit).join(', ')}`);
        console.log(`  [${ticker}] 추정 rows: ${estRows.map(r=>r.period+'='+r.opProfit).join(', ')}`);
        console.log(`  [${ticker}] PER=${forwardPer} PBR=${forwardPbr}`);

        if (actualRows.length === 0 || estRows.length === 0) {
            return { beatConsensus: false, actual: null, consensus: null, estTrend: null, forwardPer, forwardPbr };
        }

        const latestActual = actualRows[actualRows.length - 1];
        const earliestEst  = estRows[0];
        const beatConsensus = earliestEst.opProfit > latestActual.opProfit;

        let estTrend = null;
        if (estRows.length >= 2) {
            const increasing = estRows.every((r, i) => i === 0 || r.opProfit > estRows[i - 1].opProfit);
            const decreasing = estRows.every((r, i) => i === 0 || r.opProfit < estRows[i - 1].opProfit);
            estTrend = increasing ? 'up' : decreasing ? 'down' : 'flat';
        }

        return {
            beatConsensus,
            actual:    latestActual.opProfit,
            actualPeriod: latestActual.period,
            consensus: earliestEst.opProfit,
            consPeriod: earliestEst.period,
            estTrend,
            estRows,
            estPerRows,
            forwardPer,
            forwardPbr,
        };
    } catch (err) {
        console.warn(`  [${ticker}] 컨센서스 스크래핑 실패:`, err.message);
        return { beatConsensus: false, actual: null, consensus: null, estTrend: null };
    }
}

// "65,670" → 65670 / "3,522,059" → 3522059 / 빈 값 → null
function parseKorNum(str) {
    if (!str || str === '-' || str === '') return null;
    const n = parseFloat(str.replace(/[^0-9\-\.]/g, ''));
    return isNaN(n) ? null : n;
}

// 네이버 날짜 형식 파싱 ("26.06.01" → Date)
function parseNaverDate(str) {
    if (!str) return null;
    const m = str.match(/(\d{2})\.(\d{2})\.(\d{2})/);
    if (!m) return null;
    return new Date(`20${m[1]}-${m[2]}-${m[3]}`);
}

// ════════════════════════════════════════════════════════
// [영무문2] 최근 리포트 목록 수집
// 각 행: 종목명, 티커, 증권사, 리포트href, 작성일
// ════════════════════════════════════════════════════════
async function scrapeRecentReports(count = 60) {
    const allRows = [];
    const pageSize = 30;
    const pagesToFetch = Math.ceil(count / pageSize);

    for (let page = 1; page <= pagesToFetch; page++) {
        try {
            const url = `https://finance.naver.com/research/company_list.naver?page=${page}`;
            const html = await fetchEucKr(url);
            const $ = cheerio.load(html);

            $('table').first().find('tbody tr').each((_, row) => {
                const tds = $(row).find('td');
                if (tds.length < 5) return;

                const nameAnchor = $(tds[0]).find('a');
                const name = nameAnchor.text().trim();
                if (!name) return;

                const nameHref = nameAnchor.attr('href') || '';
                const tickerMatch = nameHref.match(/code=(\d+)/);
                const ticker = tickerMatch ? tickerMatch[1] : null;

                const firm = $(tds[2]).text().trim();
                const dateStr = $(tds[4]).text().trim();

                // 리포트 상세 링크
                const reportHref = $(tds[1]).find('a').attr('href') || '';
                const fullHref = reportHref.startsWith('http')
                    ? reportHref
                    : `https://finance.naver.com/research/${reportHref}`;

                if (name && firm) {
                    allRows.push({ name, ticker, firm, reportHref: fullHref, date: dateStr });
                }
            });

            if (page < pagesToFetch) await delay(600);
        } catch (err) {
            console.warn(`[영무문2] 페이지 ${page} 조회 실패:`, err.message);
        }
    }

    console.log(`[영무문2] 총 ${allRows.length}건 수집 완료`);
    return allRows.slice(0, count);
}

// ════════════════════════════════════════════════════════
// [영무문2] 리포트 상세 페이지에서 투자의견 + 목표주가 추출
// ════════════════════════════════════════════════════════
async function scrapeReportDetail(href) {
    try {
        const html = await fetchEucKr(href);
        const $ = cheerio.load(html);

        let target = null;
        let opinion = null;

        // th/td 쌍으로 된 테이블에서 레이블 기반 추출
        $('table').first().find('tr').each((_, tr) => {
            $(tr).find('th').each((i, th) => {
                const label = $(th).text().trim();
                const val   = $($(tr).find('td')[i]).text().trim();
                if (!opinion && label.includes('투자의견')) opinion = val;
                if (!target  && (label.includes('목표주가') || label.includes('목표가'))) {
                    const n = Number(val.replace(/[^0-9]/g, ''));
                    if (n > 0) target = n;
                }
            });
        });

        // th/td 쌍으로 못 찾으면 전체 텍스트 패턴 매칭
        if (!target || !opinion) {
            $('table').first().find('td').each((_, td) => {
                const text = $(td).text().trim();
                if (!target) {
                    const m = text.match(/목표(?:주가|가)\s*([\d,]+)/);
                    if (m) target = Number(m[1].replace(/,/g, ''));
                }
                if (!opinion) {
                    const m = text.match(/투자의견\s*([가-힣A-Za-z]+)/);
                    if (m) opinion = m[1];
                }
            });
        }

        return { target, opinion };
    } catch (err) {
        console.warn(`[영무문2] 리포트 상세 조회 실패:`, err.message);
        return { target: null, opinion: null };
    }
}

module.exports = { scrapeAnalystTarget, scrapeConsensus, scrapeRecentReports, scrapeReportDetail, delay };
