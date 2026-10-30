"""End-to-end test: real server.js + real SQLite database + real Chromium.
Run:  python3 test/e2e.py      (needs: pip install playwright && playwright install chromium)"""
import json, os, subprocess, sys, tempfile, time, urllib.request, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 3099
BASE = 'http://127.0.0.1:%d' % PORT
PASSWORD = 'correct horse battery'
res = []
def check(name, cond, extra=''):
    res.append((name, bool(cond))); print(('PASS ' if cond else 'FAIL ') + name + ((' | ' + str(extra)) if (extra and not cond) else ''))

tmp = tempfile.mkdtemp()
env = dict(os.environ, PORT=str(PORT), SQLITE_PATH=os.path.join(tmp, 'e2e.db'), SESSION_SECRET='s' * 40, ADMIN_PASSWORD=PASSWORD, EMAIL_PROVIDER='none', NODE_NO_WARNINGS='1')
for k in ('VERCEL', 'DATABASE_URL'): env.pop(k, None)
srv = subprocess.Popen(['node', 'server.js'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(50):
        try: urllib.request.urlopen(BASE + '/api/health', timeout=1); break
        except Exception: time.sleep(0.2)
    manila = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).date()
    CI, CO = (manila + datetime.timedelta(days=20)).isoformat(), (manila + datetime.timedelta(days=22)).isoformat()
    ipn = [0]
    with sync_playwright() as p:
        b = p.chromium.launch()
        def ctx(w=1280, h=800):
            ipn[0] += 1
            c = b.new_context(viewport={'width': w, 'height': h}, extra_http_headers={'X-Forwarded-For': '10.9.0.%d' % ipn[0]})
            pg = c.new_page(); pg.set_default_timeout(8000)
            logs = {'errors': [], 'external': []}
            pg.on('pageerror', lambda e: logs['errors'].append('pageerror: ' + str(e)))
            pg.on('console', lambda m: logs['errors'].append(m.text) if (m.type == 'error' and not ('Failed to load resource' in m.text and ('409' in m.text or '401' in m.text))) else None)
            pg.on('request', lambda r: logs['external'].append(r.url) if not r.url.startswith(BASE) and not r.url.startswith('data:') else None)
            return c, pg, logs
        def pick(pg, unit, ci, co):
            pg.select_option('#a-unit', unit)
            pg.evaluate("""([ci,co])=>{}""", [ci, co])
        def choose_dates(pg, ci, co):
            # navigate the calendar to the month of ci, then click both days
            for _ in range(6):
                if pg.locator('#cal [data-day="%s"]' % ci).count() and pg.locator('#cal [data-day="%s"]' % co).count(): break
                pg.click('[data-act=nextm]')
            pg.click('#cal [data-day="%s"]' % ci); pg.click('#cal [data-day="%s"]' % co)
        def fill_form(pg, name='E2E Guest', phone='09171234567', email='e2e@example.com'):
            pg.fill('#d-name', name); pg.fill('#d-phone', phone); pg.fill('#d-email', email); pg.check('#d-rules')

        # ---- E1 public page
        c, pg, logs = ctx(); pg.goto(BASE + '/'); pg.wait_for_selector('#grid .card')
        check('E1 page loads, 14 units from the API, no console/CSP errors', pg.locator('#grid .card').count() == 14 and not logs['errors'], logs['errors'])
        check('E1b nothing loaded from any other website', not logs['external'], logs['external'])
        check('E1c price badge reads from live data', 'From' in pg.locator('#pbadge').inner_text() and '1,999' in pg.locator('#pbadge').inner_text(), pg.locator('#pbadge').inner_text())
        check('E1d images are real cached files (not embedded text)', pg.evaluate("document.documentElement.innerHTML.indexOf('base64')")==-1)
        c.close()

        # ---- E2 book + E3 conflict between two visitors
        cA, A, la = ctx(); cB, B, lb = ctx()
        A.goto(BASE + '/'); A.wait_for_selector('#grid .card'); B.goto(BASE + '/'); B.wait_for_selector('#grid .card')  # B loads BEFORE A books
        A.select_option('#a-unit', '595'); choose_dates(A, CI, CO); A.click('[data-act=proceed]'); fill_form(A); A.click('[data-act=reserve]'); A.wait_for_selector('#bk-done h3', state='visible')
        txt = A.locator('#bk-done').inner_text()
        check('E2 visitor A gets "Request received", reference code, not-confirmed wording, 24h hold', 'Request received' in txt and 'not a confirmed booking' in txt and 'MP-' in txt and '24 hours' in txt, txt[:150])
        code = A.locator('#bk-done .code').inner_text()
        check('E2b reference has the server format', len(code) == 9 and code.startswith('MP-'), code)
        B.select_option('#a-unit', '595'); choose_dates(B, CI, CO)   # B's page is stale: still thinks these dates are free
        B.click('[data-act=proceed]'); fill_form(B, name='Visitor B', email='b@example.com'); B.click('[data-act=reserve]'); B.wait_for_timeout(800)
        msg = B.locator('#calmsg').inner_text()
        check('E3 stale visitor B is told the dates were just taken (server said 409)', 'just taken' in msg, msg)
        B.reload(); B.wait_for_selector('#grid .card'); B.select_option('#a-unit', '595')
        for _ in range(6):
            if B.locator('#cal [data-day="%s"]' % CI).count(): break
            B.click('[data-act=nextm]')
        check('E3b after reload those days show as taken', 'tk' in (B.locator('#cal [data-day="%s"]' % CI).get_attribute('class') or ''))
        B.select_option('#a-unit', '1537')
        check('E3c a different unit is still open for the same dates', 'tk' not in (B.locator('#cal [data-day="%s"]' % CI).get_attribute('class') or ''))
        check('E3d no errors in either browser', not la['errors'] and not lb['errors'], la['errors'] + lb['errors'])
        cA.close(); cB.close()

        # ---- E4 admin
        cH, H, lh = ctx(); H.goto(BASE + '/admin'); H.wait_for_selector('#login-form', state='visible')
        check('E4 /admin shows only a login form to visitors', H.locator('#dash').is_hidden())
        H.fill('#pw', 'wrong password here'); H.click('#login-btn'); H.wait_for_timeout(500)
        check('E4b wrong password shows an error and stays logged out', 'Wrong password' in H.locator('#msg').inner_text() and H.locator('#dash').is_hidden())
        H.fill('#pw', PASSWORD); H.click('#login-btn'); H.wait_for_selector('#stats .hst')
        check('E4c correct password shows the dashboard with the pending request', code in H.locator('#rows').inner_text() and 'E2E Guest' in H.locator('#rows').inner_text())
        check('E4d session cookie is HttpOnly (page JavaScript cannot read it)', 'mp_admin' not in H.evaluate('document.cookie'))
        H.click('[data-act=confirm]'); H.wait_for_timeout(700)
        check('E4e Confirm works', 'Booking confirmed' in H.locator('#msg').inner_text())
        H.select_option('#f-status', 'confirmed'); check('E4f confirmed list shows it', code in H.locator('#rows').inner_text())
        r = urllib.request.urlopen(BASE + '/api/availability?from=%s&to=%s' % (CI, CO)); busy = json.loads(r.read())['busy']
        check('E4g confirmed dates stay blocked publicly', any(x['unit'] == '595' and x['status'] == 'confirmed' for x in busy), busy)
        H.once('dialog', lambda d: d.accept()); H.click('[data-act=cancel]'); H.wait_for_timeout(700)
        busy = json.loads(urllib.request.urlopen(BASE + '/api/availability?from=%s&to=%s' % (CI, CO)).read())['busy']
        check('E4h Cancel frees the dates for other guests', not any(x['unit'] == '595' for x in busy), busy)
        # rates
        row = H.locator('#rates tr[data-unit="855"]'); row.locator('[data-f=weekday]').fill('2100'); row.locator('[data-f=weekend]').fill('2600'); row.locator('[data-act=save-rate]').click(); H.wait_for_timeout(600)
        units = json.loads(urllib.request.urlopen(BASE + '/api/units').read())['units']; u855 = [u for u in units if u['id'] == '855'][0]
        check('E4i saving rates in the dashboard changes the public price', u855['price'] == 2100 and u855['weekend'] == 2600, u855)
        # block dates
        H.select_option('#b-unit', '372'); H.fill('#b-from', CI); H.fill('#b-to', CO); H.click('#b-go'); H.wait_for_timeout(600)
        busy = json.loads(urllib.request.urlopen(BASE + '/api/availability?from=%s&to=%s' % (CI, CO)).read())['busy']
        check('E4j blocking dates blocks them publicly', any(x['unit'] == '372' and x['status'] == 'blocked' for x in busy), busy)
        check('E4k no errors on the dashboard (CSP etc.)', not lh['errors'], lh['errors'])
        # logout
        H.click('#logout'); H.wait_for_selector('#login-form', state='visible')
        status = H.evaluate("fetch('/api/admin/bookings').then(r=>r.status)")
        check('E4l after logout the admin API refuses (401)', status == 401, status)
        cH.close()

        # ---- E5 stored XSS attempt shown in dashboard
        cX, X, lx = ctx(); X.goto(BASE + '/'); X.wait_for_selector('#grid .card')
        res_x = X.evaluate("""async(a)=>{const r=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unit:'1537',ci:a[0],co:a[1],guests:2,name:'<img src=x onerror=window.__x=1> Eve',phone:'09171234567',email:'x@y.co',rules:true})});return r.status}""", [CI, CO])
        cX.close()
        cH, H, lh = ctx(); H.goto(BASE + '/admin'); H.wait_for_selector('#login-form', state='visible'); H.fill('#pw', PASSWORD); H.click('#login-btn'); H.wait_for_selector('#stats .hst')
        check('E5 booking with an HTML payload as its name was accepted as plain text', res_x == 201)
        check('E5b dashboard shows it as text and runs nothing', H.evaluate('window.__x') is None and H.locator('#rows img').count() == 0 and '<img' in H.locator('#rows').inner_text())
        cH.close()

        # ---- E6 failure states
        cF, F, lf = ctx(); F.route('**/api/units', lambda r: r.abort()); F.goto(BASE + '/'); F.wait_for_selector('[data-act=retry-load]')
        check('E6 if the server cannot be reached the visitor sees a message + retry button', 'could not load' in F.locator('#grid').inner_text())
        F.unroute('**/api/units'); F.click('[data-act=retry-load]'); F.wait_for_selector('#grid .card')
        check('E6b retry loads the units', F.locator('#grid .card').count() == 14)
        F.select_option('#a-unit', '1585'); choose_dates(F, CI, CO); F.click('[data-act=proceed]'); fill_form(F, name='Retry Guest')
        F.route('**/api/bookings', lambda r: r.abort()); F.click('[data-act=reserve]'); F.wait_for_timeout(600)
        check('E6c network failure on submit keeps the form and says so', 'could not reach' in F.locator('#d-err').inner_text() and F.input_value('#d-name') == 'Retry Guest' and F.locator('[data-act=reserve]').is_enabled())
        F.unroute('**/api/bookings'); F.click('[data-act=reserve]'); F.wait_for_selector('#bk-done h3', state='visible')
        check('E6d retry after the network is back succeeds', 'Request received' in F.locator('#bk-done').inner_text())
        cF.close()

        # ---- E7 group inquiry
        cG, G, lg = ctx(); G.goto(BASE + '/'); G.wait_for_selector('#grid .card'); G.select_option('#s-g', '5'); G.click('#grid [data-act=open-inq]')
        G.fill('#q-name', 'Group Lead'); G.fill('#q-phone', '09171234567'); G.fill('#q-email', 'g@x.co'); G.fill('#q-g', '8'); G.fill('#q-ci', CI); G.fill('#q-co', CO); G.click('#q-go'); G.wait_for_selector('text=Inquiry sent')
        cH, H, lh = ctx(); H.goto(BASE + '/admin'); H.wait_for_selector('#login-form', state='visible'); H.fill('#pw', PASSWORD); H.click('#login-btn'); H.wait_for_selector('#stats .hst')
        check('E7 group inquiry reaches the dashboard', 'Group Lead' in H.locator('#inq').inner_text() and '8 guests' in H.locator('#inq').inner_text())
        cG.close()

        # ---- E8 responsive
        for w in (360, 390, 768, 1280):
            c8, P8, l8 = ctx(w=w); P8.goto(BASE + '/'); P8.wait_for_selector('#grid .card')
            check('E8 public site: no horizontal scroll at %dpx' % w, P8.evaluate('document.documentElement.scrollWidth-window.innerWidth') <= 1)
            P8.goto(BASE + '/admin'); P8.wait_for_selector('#login-form', state='visible'); P8.fill('#pw', PASSWORD); P8.click('#login-btn'); P8.wait_for_selector('#stats .hst')
            check('E8b dashboard: page itself does not scroll sideways at %dpx' % w, P8.evaluate('document.documentElement.scrollWidth-window.innerWidth') <= 1)
            c8.close()
        # ---- E9 security headers
        hdr = urllib.request.urlopen(BASE + '/').headers
        check('E9 security headers present (CSP without unsafe-inline scripts)', "script-src 'self'" in hdr['Content-Security-Policy'] and "'unsafe-inline'" not in hdr['Content-Security-Policy'].split('script-src')[1].split(';')[0] and hdr['X-Frame-Options'] == 'DENY')
        try: urllib.request.urlopen(BASE + '/../server.js'); leak = True
        except Exception: leak = False
        try: urllib.request.urlopen(BASE + '/%2e%2e/server.js'); leak2 = True
        except Exception: leak2 = False
        check('E9b source files and database are not downloadable', not leak and not leak2)
        b.close()
finally:
    srv.terminate()
print('\nSUMMARY: %d passed, %d failed' % (sum(1 for _, c in res if c), sum(1 for _, c in res if not c)))
sys.exit(0 if all(c for _, c in res) else 1)
