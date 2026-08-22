const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

function isBcryptHash(value) {
    return typeof value === 'string' && /^\$2[aby]\$/.test(value);
}

async function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

async function verifyPassword(plainPassword, storedPassword) {
    if (isBcryptHash(storedPassword)) {
        return bcrypt.compare(plainPassword, storedPassword);
    }
    // Legacy plaintext password from before hashing was added.
    return plainPassword === storedPassword;
}

module.exports = { hashPassword, verifyPassword, isBcryptHash };
