// ════════════════════════════════════════════════════════
// JYP 픽 관심종목 리스트 (섹터별 분류)
// 종목 추가/변경은 이 파일만 수정하면 됩니다.
// excd: NAS(나스닥), NYS(뉴욕), AMX(아멕스)
// ════════════════════════════════════════════════════════
const JYP_PICK_LIST = [

    // ── 양자컴퓨터 ──────────────────────────────────────
    { ticker: 'POET', name: '포엣 테크놀로지',   sector: '양자컴퓨터', excd: 'NAS' },
    { ticker: 'IONQ', name: '아이온큐',          sector: '양자컴퓨터', excd: 'NYS' },
    { ticker: 'QBTS', name: '디웨이브퀀텀',      sector: '양자컴퓨터', excd: 'NYS' },
    { ticker: 'RGTI', name: '리게티 컴퓨팅',     sector: '양자컴퓨터', excd: 'NAS' },
    { ticker: 'QUBT', name: '퀀텀 컴퓨팅',       sector: '양자컴퓨터', excd: 'NAS' },

    // ── 우주 ────────────────────────────────────────────
    { ticker: 'PL',   name: '플래닛랩스PBC',     sector: '우주',       excd: 'NYS' },
    { ticker: 'RKLB', name: '로켓랩',            sector: '우주',       excd: 'NAS' },
    { ticker: 'ASTS', name: 'AST스페이스모바일', sector: '우주',       excd: 'NAS' },
    { ticker: 'LUNR', name: '인튜이티브 머신스', sector: '우주',       excd: 'NAS' },
    { ticker: 'SIDU', name: '사이더스 스페이스', sector: '우주',       excd: 'NAS' },
    { ticker: 'RDW',  name: '레드와이어',        sector: '우주',       excd: 'NYS' },

    // ── 비트코인 채굴/AI 데이터센터 ─────────────────────
    { ticker: 'IREN', name: '아이렌',            sector: 'BTC채굴/AI', excd: 'NAS' },

];

module.exports = JYP_PICK_LIST;
