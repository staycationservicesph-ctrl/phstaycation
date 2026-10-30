/* Makes a safe password hash for ADMIN_PASSWORD_HASH.   Usage: node scripts/hash-password.js "your long password" */
const { hashPassword } = require('../lib/auth');
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('Give a password of at least 12 characters in quotes.'); process.exit(1); }
console.log(hashPassword(pw));
