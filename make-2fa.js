/* Makes a key for 2-step login. Usage:  node scripts/make-2fa.js
   1) Add the key to Render > Environment as ADMIN_TOTP_SECRET and save (Render redeploys).
   2) In your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password) choose
      "Add account" > "Enter a setup key", type any name, paste the key, keep "Time based" on.
   From then on, /admin asks for the password AND the 6-digit code. */
const { generateTotpSecret, totpUri, totpCode } = require('../lib/auth');
const secret = process.argv[2] || generateTotpSecret();
console.log('\nADMIN_TOTP_SECRET=' + secret + '\n');
console.log('Key to type into your authenticator app:  ' + secret.match(/.{1,4}/g).join(' '));
console.log('Or open this link on your phone:          ' + totpUri(secret, 'host', 'Manila Prime'));
console.log('\nCheck: the app should now show a 6-digit code. The server expects the same one:  ' + totpCode(secret, Date.now()) + '  (changes every 30 seconds)\n');
console.log('Keep the key private. Anyone with it AND your password can log in. Write it down somewhere safe: if you lose your phone you will need it.');
