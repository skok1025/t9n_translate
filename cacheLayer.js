const { createClient } = require('redis');

// Redis 클라이언트 생성
const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// Redis 연결
client.connect().catch(console.error);

// 에러 핸들링
client.on('error', (err) => console.error('Redis Client Error', err));

/**
 * 캐시에서 데이터 조회
 * @param {string} key 캐시 키
 * @returns {Promise<string|null>} 캐시된 데이터 또는 null
 */
const getCache = async (key) => {
    try {
        return await client.get(key);
    } catch (error) {
        console.error('캐시 조회 오류:', error);
        return null;
    }
};

/**
 * 데이터를 캐시에 저장
 * @param {string} key 캐시 키
 * @param {string} value 저장할 데이터
 * @param {number} ttl 캐시 유효 시간 (초) (디폴트: 1주일)
 * @returns {Promise<boolean>} 저장 성공 여부
 */
const setCache = async (key, value, ttl = 604800) => {
    try {
        await client.set(key, value, {
            EX: ttl
        });
        return true;
    } catch (error) {
        console.error('캐시 저장 오류:', error);
        return false;
    }
};

module.exports = {
    getCache,
    setCache
}; 
