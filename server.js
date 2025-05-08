require('dotenv').config();
const crypto = require('crypto');
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var fs = require('fs');
var path = require('path');
var axios = require('axios');
const { TokenError, ParamError, CacheError, AccessError } = require('./lib/error');
const { getCache, setCache } = require('./cacheLayer');


// CORS 설정
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');

    // 프리플라이트 요청 처리
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // OPTIONS 요청 처리
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});


/**
 * 캐시 키 생성 함수
 * @param {Array} texts 
 * @param {string} targetLang 
 * @returns {string}
 */
const generateCacheKey = (texts, targetLang) => {
    if (!Array.isArray(texts) || typeof targetLang !== 'string') {
        throw new Error(`캐시 키 생성 오류: texts=${JSON.stringify(texts)}, targetLang=${targetLang}`);
    }

    const rawKey = texts.map(String).sort().join('|') + ':' + targetLang;
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

    return `translate:${hash}`;
};


// 환경변수 설정 관리
const getEnvValue = (key) => {
    // 1. process.env에서 먼저 확인 (.env 파일 또는 OS 환경변수)
    const value = process.env[key];
    if (value) return value;

    // 2. .env 파일이 없는 경우 OS 환경변수만 확인
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
        console.log('.env 파일이 없어 OS 환경변수를 사용합니다.');
        return process.env[key];
    }

    return null;
};

// API 키 설정
const TRANSLATION_KEY = getEnvValue('TRANSLATION_KEY');
if (!TRANSLATION_KEY) {
    console.warn('Warning: TRANSLATION_KEY가 설정되지 않았습니다.');
}

// 서버 시크릿 키 설정
const SERVER_SECRET = getEnvValue('SERVER_SECRET');
if (!SERVER_SECRET) {
    console.warn('Warning: SERVER_SECRET이 설정되지 않았습니다.');
}

// 캐시 사용 여부 설정
const USE_CACHE = getEnvValue('USE_CACHE');
if (!USE_CACHE) {
    USE_CACHE = false;
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
    extended: true
}));

/**
 * req에서 파라미터 추출 함수
 * @param {Object} req 
 * @returns {Object}
 */
function getParam(req) {
    const decompressed = lzString.decompressFromEncodedURIComponent(req.query.q);
    const textsToTranslate = JSON.parse(decompressed);
    const target = req.query.target;
    const token = req.query.token;
    return { textsToTranslate, target, token };
}

/**
 * 요청 헤더에서 유효한 요청인지 검증
 * @param {Object} req 
 * @returns {void}
 */
function validAccess(req) {
    const ua = (req.headers['user-agent'] || '').toLowerCase();
    const botKeywords = ['bot', 'spider', 'crawler', 'slurp', 'curl', 'wget', 'python-requests'];

    if (botKeywords.some(keyword => ua.includes(keyword))) {
        throw new AccessError('유효하지 않은 요청입니다.');
    }
}

/**
 * 파라미터 검증 함수
 * @param {Array} textsToTranslate 번역문구 배열
 * @param {string} target 번역 언어코드
 * @returns {void}
 */
function validateParam({ textsToTranslate, target }) {
    if (!Array.isArray(textsToTranslate) || !target) {
        throw new ParamError('올바른 번역 파라미터가 필요합니다. (q=배열&target=언어코드)');
    }
    if (textsToTranslate.length > 50) {
        throw new ParamError('번역 텍스트 배열의 크기를 50개 아래로 줄여주세요.');
    }
}

/**
 * 토큰 유효성 검증
 * @param {string} token 
 * @returns {boolean}
 */
const validateToken = (token) => {
    if (!token) {
        throw new TokenError('토큰이 필요합니다. (?token=토큰)');
    }

    // 테스트용 'valid' 토큰 처리
    if (token === 'valid') {
        return true;
    }

    // 토큰을 '.'으로 분리
    const [signature, expiryTimestamp] = token.split('.');
    
    // 현재 시간과 만료 시간 비교
    const now = Math.floor(Date.now() / 1000);
    if (now >= parseInt(expiryTimestamp)) {
        // 현재 시간, 만료 시간 에러메세지에 출력
        throw new TokenError(`토큰이 만료되었습니다. 현재 시간: ${now}, 만료 시간: ${expiryTimestamp}`);
    }

    // HMAC 서명 검증
    const expectedSignature = crypto
        .createHmac('sha256', SERVER_SECRET)
        .update(expiryTimestamp)
        .digest('hex');

    if (signature !== expectedSignature) {
        // 서명 검증 실패 시 에러메세지에 출력
        throw new TokenError(`유효하지 않은 토큰입니다. 서명: ${signature}`);
    }

    return true;
};

const lzString = require('lz-string');

// 번역 API 엔드포인트
app.get('/translate', async (req, res) => {
    try {
        if (!TRANSLATION_KEY) {
            throw new Error('Translation API key가 설정되지 않았습니다.');
        }

        const { textsToTranslate, target, token } = getParam(req);

        // Agent 검증 (봇에 의한 요청 차단)
        validAccess(req);

        // 파라미터 검증
        validateParam({ textsToTranslate, target });

        // 토큰 검증 (추후 필요시 작업예정)
        validateToken(token);

        const cacheKey = generateCacheKey(textsToTranslate, target);

        if (USE_CACHE) {
            let cached = await getCache(cacheKey);
            if (cached) {
                console.log('캐시 히트');
                res.json(JSON.parse(cached));
                return;
            }
        }

        // 캐시 미스: 번역 API 호출
        const response = await axios.post(
            `https://translation.googleapis.com/language/translate/v2?key=${TRANSLATION_KEY}`,
            { q: textsToTranslate, target }
        );

        if (USE_CACHE) {
            await setCache(cacheKey, JSON.stringify(response.data));
        }

        res.json(response.data);
    } catch (error) {
        if (error instanceof TokenError) {   
            res.status(401).json({
                error: '토큰 검증 오류가 발생했습니다.',
                details: error.message
            });
        } else if (error instanceof ParamError) {
            res.status(400).json({
                error: '파라미터 검증 오류가 발생했습니다.',
                details: error.message
            });
        } else if (error instanceof AccessError) {
            res.status(403).json({
                error: '유효하지 않은 요청입니다.',
                details: error.message
            });
        } else {
            res.status(response.status).json({
                error: '번역 처리 중 오류가 발생했습니다.',
                details: error.message
            });
        }
    }
});

// set port
const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
    console.log(`Node app is running on port ${PORT}`);
    console.log(`Translation API Key: ${TRANSLATION_KEY ? '설정됨' : '설정되지 않음'}`);
});

app.get('/', (req, res) => {
  res.send('Hello World');
});

module.exports = app;