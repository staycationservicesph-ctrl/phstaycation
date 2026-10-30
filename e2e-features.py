"""Browser test for: shareable search links + saved units.  Run: python3 test/e2e-features.py  (needs playwright + chromium)"""
import os, subprocess, tempfile, time, urllib.request, datetime
from playwright.sync_api import sync_playwright
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); PORT = 3098; BASE = 'http://127.0.0.1:%d' % PORT
res = []
def check(n, c, x=''): res.append(bool(c)); print(('PASS ' if c else 'FAIL ') + n + ((' | ' + str(x)) if (x and not c) else ''))
env = dict(os.environ, PORT=str(PORT), SQLITE_PATH=os.path.join(tempfile.mkdtemp(), 'f.db'), SESSION_SECRET='s' * 40, ADMIN_PASSWORD='correct horse battery', EMAIL_PROVIDER='none', NODE_NO_WARNINGS='1')
for k in ('VERCEL', 'DATABASE_URL'): env.pop(k, None)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + '/api/health', timeout=1); break
        except Exception: time.sleep(0.2)
    m = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    CI, CO = (m + datetime.timedelta(days=30)).isoformat(), (m + datetime.timedelta(days=33)).isoformat()
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page(); errs = []
        pg.on('console', lambda x: errs.append(x.text) if x.type == 'error' else None); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/?utm_source=fb&checkin=%s&checkout=%s&guests=3' % (CI, CO)); pg.wait_for_selector('.card')
        check('F1 dates and guests prefilled from link', pg.input_value('#s-ci') == CI and pg.input_value('#s-co') == CO and pg.input_value('#s-g') == '3')
        check('F1b cards show total for the linked stay', '3 nights' in pg.inner_text('.card .pr'))
        pg.select_option('#s-g', '2')
        u = pg.url; check('F2 link updates when search changes, keeps other params', 'guests=2' in u and 'utm_source=fb' in u and CI in u, u)
        pg.goto(BASE + '/?checkin=2020-01-01&checkout=2020-01-03&guests=99'); pg.wait_for_selector('.card')
        check('F3 past dates and bad guest count ignored', pg.input_value('#s-ci') >= m.isoformat() and pg.input_value('#s-g') == '2')
        pg.goto(BASE + '/?checkin=<script>&checkout=x'); pg.wait_for_selector('.card')
        check('F3b junk params ignored, page fine', pg.locator('.card').count() > 0)
        pg.goto(BASE + '/'); pg.wait_for_selector('.card')
        check('F4 plain visit leaves the address clean', '?' not in pg.url, pg.url)
        check('F5 Saved-only filter hidden until something is saved', pg.locator('#f-saved-w').is_hidden())
        n = pg.locator('.card').count(); h = pg.locator('.card .heart').nth(1); uid = h.get_attribute('data-save')
        h.click()
        check('F6 heart toggles', pg.locator('.card .heart[data-save="%s"]' % uid).get_attribute('aria-pressed') == 'true')
        check('F6b Saved only (1) appears', pg.locator('#f-saved-w').is_visible() and pg.inner_text('#f-saved-n') == '1')
        pg.reload(); pg.wait_for_selector('.card')
        check('F7 saved unit remembered after reload', pg.locator('.card .heart[data-save="%s"]' % uid).get_attribute('aria-pressed') == 'true')
        pg.check('#f-saved'); check('F8 Saved only shows just that unit', pg.locator('.card').count() == 1 and pg.locator('.card .heart').get_attribute('data-save') == uid)
        pg.locator('.card .heart').click()
        check('F9 unsaving the last one restores full list and hides filter', pg.locator('.card').count() == n and pg.locator('#f-saved-w').is_hidden())
        ctx.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked')}})")
        pg2 = ctx.new_page(); e2 = []; pg2.on('pageerror', lambda e: e2.append(str(e)))
        pg2.goto(BASE + '/'); pg2.wait_for_selector('.card'); pg2.locator('.card .heart').first.click()
        check('F10 works (no crash) when browser storage is blocked', not e2 and pg2.locator('.card').count() > 0, e2)
        pg.set_viewport_size({'width': 360, 'height': 800}); pg.wait_for_timeout(200)
        bx = pg.locator('.card .heart').first.bounding_box(); check('F11 heart is a 40px touch target', bx and bx['width'] >= 40 and bx['height'] >= 40, bx)
        check('F12 no console or CSP errors', not errs, errs)
        b.close()
finally:
    srv.terminate()
print('SUMMARY: %d passed, %d failed' % (sum(res), len(res) - sum(res)))
