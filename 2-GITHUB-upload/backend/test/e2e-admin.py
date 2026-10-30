"""Browser test: 2-step login + rooms/availability management in the host dashboard.  Run: python3 test/e2e-admin.py"""
import base64, hashlib, hmac, os, struct, subprocess, tempfile, time, urllib.request, json
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PW = 'correct horse battery'; SECRET = base64.b32encode(os.urandom(20)).decode().rstrip('=')
res = []
def check(n, c, x=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ((' | ' + str(x)) if (x and not c) else ''))
def totp(offset=0):
    key = base64.b32decode(SECRET + '=' * (-len(SECRET) % 8)); c = int(time.time() // 30) + offset
    h = hmac.new(key, struct.pack('>Q', c), hashlib.sha1).digest(); o = h[-1] & 15
    return '%06d' % ((struct.unpack('>I', h[o:o+4])[0] & 0x7fffffff) % 1000000)
def start(port, extra):
    env = dict(os.environ, PORT=str(port), SQLITE_PATH=os.path.join(tempfile.mkdtemp(), 'a.db'), SESSION_SECRET='s' * 40, ADMIN_PASSWORD=PW, EMAIL_PROVIDER='none', NODE_NO_WARNINGS='1', **extra)
    for k in ('VERCEL', 'RENDER', 'DATABASE_URL'): env.pop(k, None)
    p = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try: urllib.request.urlopen('http://127.0.0.1:%d/api/health' % port, timeout=1); break
        except Exception: time.sleep(0.2)
    return p
S1, S2 = start(3096, {'ADMIN_TOTP_SECRET': SECRET}), start(3095, {})
B1, B2 = 'http://127.0.0.1:3096', 'http://127.0.0.1:3095'
try:
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(); pg = ctx.new_page(); errs = []; dialogs = []
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'status of 401' not in m.text and 'status of 409' not in m.text else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('dialog', lambda d: (dialogs.append(d.message), d.accept()))
        pg.goto(B1 + '/admin'); pg.wait_for_selector('#login:not([hidden])')
        check('A1 code field is shown when 2-step is on', pg.locator('#code-w').is_visible())
        pg.fill('#pw', PW); pg.fill('#code', '000000'); pg.click('#login-btn'); pg.wait_for_selector('#msg:not([hidden])')
        check('A2 wrong code refused with a clear message', 'Wrong password or code' in pg.inner_text('#msg') and pg.locator('#dash').is_hidden())
        pg.fill('#pw', PW); pg.fill('#code', totp()); pg.click('#login-btn'); pg.wait_for_selector('#dash:not([hidden])')
        check('A3 password + current code opens the dashboard', pg.locator('#dash').is_visible())
        check('A3b no "2-step is OFF" warning', pg.locator('#tf-warn').is_hidden())
        # same code again from another browser context must fail
        c2 = br.new_context(); p2 = c2.new_page(); p2.goto(B1 + '/admin'); p2.wait_for_selector('#login:not([hidden])')
        p2.fill('#pw', PW); p2.fill('#code', totp()); p2.click('#login-btn'); p2.wait_for_selector('#msg:not([hidden])')
        check('A4 the same code cannot be used twice', p2.locator('#dash').is_hidden()); c2.close()
        # add a room (with an HTML attempt in the text)
        pg.wait_for_selector('#units tr'); n0 = pg.locator('#units tr').count()
        pg.click('#u-sum'); pg.fill('#u-id', 'T-77'); pg.fill('#u-tower', '<img src=x onerror=alert(1)>Test Tower'); pg.fill('#u-beds', 'King Bed'); pg.fill('#u-desc', 'A test room'); pg.fill('#u-perks', 'Netflix')
        pg.fill('#u-base', '2'); pg.fill('#u-max', '3'); pg.fill('#u-extra', '250'); pg.fill('#u-wd', '2222'); pg.fill('#u-we', '2888'); pg.click('#u-go')
        pg.locator('#units tr').nth(n0).wait_for()
        check('A5 new room appears in the dashboard as On', 'T-77' in pg.inner_text('#units') and pg.locator('#units tr:last-child .badge.ok').count() == 1)
        check('A5b HTML in the name is shown as text, not run', pg.locator('#units img').count() == 0 and not dialogs, dialogs)
        if not pg.locator('#u-det[open]').count(): pg.click('#u-sum')
        pg.fill('#u-id', 'T-77'); pg.fill('#u-tower', 'x'); pg.fill('#u-beds', 'x'); pg.fill('#u-wd', '1000'); pg.fill('#u-we', '1200')
        pg.click('#u-go'); pg.wait_for_selector('#msg.bad:not([hidden])')
        check('A6 duplicate unit number is refused', 'already exists' in pg.inner_text('#msg'))
        pg.click('#u-cancel') if pg.locator('#u-cancel:visible').count() else None
        # public site shows it
        pub = br.new_context().new_page(); pub.goto(B1 + '/'); pub.wait_for_selector('.card')
        check('A7 guests see the new room', 'T-77' in pub.inner_text('#grid') and '2,222' in pub.inner_text('#grid'))
        # edit
        pg.locator('#units tr:last-child [data-act="edit-unit"]').click()
        check('A8 edit form is filled and the id is locked', pg.input_value('#u-id') == 'T-77' and pg.eval_on_selector('#u-id', 'e=>e.readOnly') and pg.locator('#u-wd').is_hidden())
        pg.fill('#u-tower', 'Renamed Tower'); pg.click('#u-go'); pg.locator('#units').get_by_text('Renamed Tower').wait_for()
        check('A9 edit saved', 'Renamed Tower' in pg.inner_text('#units'))
        # turn off / on
        pg.locator('#units tr:last-child [data-act="toggle-unit"]').click(); pg.wait_for_selector('#units tr:last-child .badge.no')
        pub = br.new_context().new_page(); pub.goto(B1 + '/'); pub.wait_for_selector('.card')  # a fresh visitor (returning visitors may see a cached list for a few minutes)
        check('A10 turned-off room disappears for guests', 'T-77' not in pub.inner_text('#grid'))
        pg.locator('#units tr:last-child [data-act="toggle-unit"]').click(); pg.wait_for_selector('#units tr:last-child .badge.ok')
        check('A11 turned back on', pg.locator('#units tr:last-child .badge.ok').count() == 1)
        # prices + log
        row = pg.locator('#rates tr[data-unit="T-77"]'); row.locator('[data-f="weekday"]').fill('2300'); row.locator('[data-act="save-rate"]').click()
        pg.locator('#audit').get_by_text('rates changed').first.wait_for()
        log = pg.inner_text('#audit')
        check('A12 activity log shows login, room and price changes', all(w in log for w in ['login ok', 'unit added', 'rates changed', 'unit off']) and PW not in log and SECRET not in log, log[:300])
        # phone width
        pg.set_viewport_size({'width': 360, 'height': 800}); pg.wait_for_timeout(300)
        check('A13 dashboard has no sideways scroll at 360px', pg.evaluate('document.documentElement.scrollWidth-innerWidth') <= 1, pg.evaluate('document.documentElement.scrollWidth-innerWidth'))
        check('A14 no console or CSP errors', not errs, errs)
        # 2-step OFF server
        c3 = br.new_context(); q = c3.new_page(); q.goto(B2 + '/admin'); q.wait_for_selector('#login:not([hidden])')
        check('A15 no code field when 2-step is off', q.locator('#code-w').is_hidden())
        q.fill('#pw', PW); q.click('#login-btn'); q.wait_for_selector('#dash:not([hidden])')
        check('A16 warning banner shown when 2-step is off', q.locator('#tf-warn').is_visible())
        br.close()
finally:
    S1.terminate(); S2.terminate()
print('SUMMARY: %d passed, %d failed' % (sum(res), len(res) - sum(res)))
