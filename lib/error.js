class TokenError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TokenError';
    }
}

class ParamError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ParamError';
    }
}

class CacheError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CacheError';
    }
}

class AccessError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AccessError';
    }
}

module.exports = {
    TokenError,
    ParamError,
    CacheError,
    AccessError
}; 