const jwt = require('jsonwebtoken');

const TOKEN_TTL = '30d';

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not set');
    return secret;
}

function signUserToken(userId) {
    return jwt.sign({ userId: String(userId) }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

function verifyUserToken(token) {
    try {
        const payload = jwt.verify(token, getJwtSecret());
        return payload?.userId ? String(payload.userId) : null;
    } catch {
        return null;
    }
}

module.exports = { signUserToken, verifyUserToken };
