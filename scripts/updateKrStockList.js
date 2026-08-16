// 국내 상장 종목 전체 목록 수집 (KOSPI + KOSDAQ, ETF/ETN 제외)
// 실행: node scripts/updateKrStockList.js

const axios = require('axios');
const iconv = require('iconv-lite');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://finance.naver.com/',
    'Accept-Language': 'ko-KR,ko;q=0.9',
};

// 국내 ETF 브랜드 prefix (startsWith 기반 — 일반 기업명과 겹치지 않음)
const ETF_PREFIXES = [
    'KODEX', 'TIGER', 'KBSTAR', 'HANARO', 'KOSEF', 'ARIRANG',
    'SOL', 'ACE', 'PLUS', 'TREX', 'TIMEFOLIO', 'FOCUS',
    'KTOP', 'MAXI', 'KOACT', 'KINDEX', 'TOK', 'KCGI',
];

function isEtfOrEtn(name) {
    if (name.includes('ETN')) return true;
    return ETF_PREFIXES.some(p => name.startsWith(p));
}

async function fetchHtml(url) {
    const res = await axios.get(url, {
        headers: HEADERS,
        responseType: 'arraybuffer',
        timeout: 15000,
    });
    return iconv.decode(Buffer.from(res.data), 'euc-kr');
}

function getLastPage(html) {
    const m = html.match(/pgRR[\s\S]{0,300}page=(\d+)/);
    return m ? Number(m[1]) : 1;
}

async function fetchMarket(sosok, marketName) {
    console.log(`\n[${marketName}] 수집 시작...`);
    const firstHtml = await fetchHtml(
        `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=1`
    );
    const lastPage = getLastPage(firstHtml);
    console.log(`[${marketName}] 총 ${lastPage}페이지`);

    const stocks = [];
    let skipped = 0;

    const parsePage = (html) => {
        const $ = cheerio.load(html);
        $('table.type_2 tbody tr').each((_, row) => {
            const tds = $(row).find('td');
            if (tds.length < 2) return;
            const anchor = $(tds[1]).find('a');
            const name = anchor.text().trim();
            const href = anchor.attr('href') || '';
            const tickerMatch = href.match(/code=(\d{6})/);
            if (!name || !tickerMatch) return;
            if (isEtfOrEtn(name)) { skipped++; return; }
            stocks.push({ ticker: tickerMatch[1], name, market: marketName });
        });
    };

    parsePage(firstHtml);
    for (let page = 2; page <= lastPage; page++) {
        process.stdout.write(`\r[${marketName}] ${page}/${lastPage} 페이지 수집 중...`);
        try {
            parsePage(await fetchHtml(
                `https://finance.naver.com/sise/sise_market_sum.naver?sosok=${sosok}&page=${page}`
            ));
        } catch (err) {
            console.warn(`\n  페이지 ${page} 실패:`, err.message);
        }
        await delay(400);
    }
    console.log(`\n[${marketName}] 완료: ${stocks.length}종목 (ETF/ETN ${skipped}개 제외)`);
    return stocks;
}

async function main() {
    console.log('=== 국내 상장 종목 전체 목록 수집 시작 (ETF/ETN 제외) ===');
    const start = Date.now();

    const kospi  = await fetchMarket(0, 'KOSPI');
    const kosdaq = await fetchMarket(1, 'KOSDAQ');

    // 중복 제거 + 정렬
    const seen = new Set();
    const unique = [...kospi, ...kosdaq].filter(s => {
        if (seen.has(s.ticker)) return false;
        seen.add(s.ticker);
        return true;
    });
    unique.sort((a, b) => a.ticker.localeCompare(b.ticker));

    const today = new Date().toISOString().slice(0, 10);
    const content =
`// 국내 상장 종목 전체 목록 (KOSPI + KOSDAQ, ETF/ETN 제외)
// 자동 생성: ${today} | 총 ${unique.length}개 종목
// 재생성: node scripts/updateKrStockList.js

const KR_STOCK_LIST = ${JSON.stringify(unique, null, 2)};

module.exports = KR_STOCK_LIST;
`;

    const outPath = path.join(__dirname, '../data/krStockList.js');
    fs.writeFileSync(outPath, content, 'utf8');

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n=== 완료 ===`);
    console.log(`총 ${unique.length}개 종목 (KOSPI ${kospi.length} + KOSDAQ ${kosdaq.length})`);
    console.log(`저장: ${outPath}`);
    console.log(`소요: ${elapsed}초`);
}

main().catch(console.error);
