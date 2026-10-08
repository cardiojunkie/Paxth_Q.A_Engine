"""One isolated CloakBrowser; Scrapling selects captured DOM for Markdown evidence."""
import asyncio
import contextlib
import json
import os
import re
import signal
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

os.environ.setdefault('CLOAKBROWSER_VERSION', '146.0.7680.177.5')
os.environ['CLOAKBROWSER_AUTO_UPDATE'] = 'false'
os.environ['ANONYMIZED_TELEMETRY'] = 'false'


class RetrievalError(Exception):
    def __init__(self, code, reason=None):
        self.code = code
        self.reason = reason
        super().__init__(code)


async def wait_for_readiness(observe, timeout, minimum=0, previous=None, allow_scroll=False):
    """Wait for visible DOM and relevant requests to settle within one bounded window."""
    start = stable_since = time.monotonic()
    state = None
    while True:
        observation = await observe()
        now = time.monotonic()
        current = (observation['html'], observation['busy'], observation['position'])
        if current != state:
            state, stable_since = current, now
        changed = previous is None or observation['html'] != previous['html'] or allow_scroll and observation['position'] != previous['position']
        if changed and not observation['busy'] and now - start >= minimum and now - stable_since >= 0.75:
            return observation, True
        if now - start >= timeout:
            return observation, False
        await asyncio.sleep(0.25)


def same_page(submitted, current):
    a, b = urlsplit(submitted), urlsplit(current)
    original, actual = parse_qs(a.query, keep_blank_values=True), parse_qs(b.query, keep_blank_values=True)
    return (b.scheme in ('http', 'https') and b.port in (None, 80, 443)
            and not b.username and not b.password
            and a.hostname.removeprefix('www.') == (b.hostname or '').removeprefix('www.')
            and a.path.rstrip('/') == b.path.rstrip('/')
            and all(actual.get(key) == value for key, value in original.items())
            and not any(key not in original and any(word in key.lower() for word in ('variant', 'offer', 'seller', 'sku', 'product', 'color', 'colour', 'size', 'quantity')) for key in actual))


def amazon_asin(url):
    parsed = urlsplit(url)
    match = re.search(r'/(?:dp|gp/product)/([A-Z0-9]{10})(?:/|$)', parsed.path, re.I)
    return match[1].upper() if parsed.hostname in ('amazon.ae', 'www.amazon.ae') and match else None


AMAZON_GATE = r"""() => {
 const text = (document.body?.innerText || '').toLowerCase();
 const forms = [...document.forms];
 const message = text.includes('click the button below to continue shopping') || text.includes('انقر فوق الزر أدناه لمتابعة التسوق');
 if (!message && !forms.some(f => f.action.includes('/errors_page/validateCaptcha'))) return null;
 const blocked = {safe: false};
 if (forms.length !== 1) return blocked;
 const form = forms[0], action = new URL(form.action);
 const controls = [...form.elements];
 const submits = controls.filter(e => ['BUTTON','INPUT'].includes(e.tagName) && e.type === 'submit');
 const hidden = controls.filter(e => e.tagName === 'INPUT' && e.type === 'hidden');
 const names = ['amzn','amzn-r','field-keywords'];
 if (!message || form.method.toLowerCase() !== 'get' || action.origin !== location.origin ||
     action.pathname !== '/errors_page/validateCaptcha' || action.search || action.hash ||
     submits.length !== 1 || submits[0].disabled || !submits[0].getClientRects().length ||
     hidden.length !== names.length || names.some(name => hidden.filter(e => e.name === name && !e.disabled).length !== 1) ||
     controls.length !== hidden.length + 1 || submits[0].name || submits[0].hasAttribute('formaction') || submits[0].hasAttribute('formmethod') ||
     document.querySelector('input:not([type="hidden"]):not([type="submit"]),textarea,select,iframe') ||
     [...document.images].some(e => /captcha/i.test(e.src + ' ' + e.alt))) return blocked;
 document.querySelectorAll('[data-paxth-amazon-continue]').forEach(e => e.removeAttribute('data-paxth-amazon-continue'));
 submits[0].setAttribute('data-paxth-amazon-continue', 'true');
 return {safe: true, action: action.href, fields: Object.fromEntries(hidden.map(e => [e.name, [e.value]]))};
}"""

AMAZON_PRODUCT = r"""() => {
 const title = document.querySelector('#productTitle');
 return {title: title?.getClientRects().length ? title.innerText.trim() : '',
         asin: (document.querySelector('#ASIN, input[name="ASIN"]')?.value || '').trim().toUpperCase()};
}"""


# DOM visibility includes offscreen content, but excludes inactive tabs and closed disclosures.
CAPTURE = r"""() => {
 const visible = e => [...e.getClientRects()].some(r => r.width > 0 && r.height > 0) && getComputedStyle(e).visibility !== 'hidden';
 return [document.body].filter(Boolean).map(root => {
   const copy = root.cloneNode(true);
   const original = [root, ...root.querySelectorAll('*')];
   const clones = [copy, ...copy.querySelectorAll('*')];
   for(let i = original.length - 1; i >= 0; i--) {
     const e = original[i];
     for (const attribute of ['href', 'src']) {
       if (e.hasAttribute(attribute)) {
         try { clones[i].setAttribute(attribute, new URL(e.getAttribute(attribute), document.baseURI).href); } catch { clones[i].removeAttribute(attribute); }
       }
     }
     const chrome = ['HEADER','FOOTER'].includes(e.tagName) && !e.closest('main,article,[role="main"],[role="dialog"],dialog[open]');
     if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','NAV'].includes(e.tagName) || chrome || e.matches('[role="banner"],[role="contentinfo"]') ||
         (!visible(e) && getComputedStyle(e).display !== 'contents')) clones[i].remove();
   }
   return copy.outerHTML;
 }).join('\n');
}"""

CONTROLS = r"""() => {
 const unsafe = /\b(buy|cart|checkout|purchase|order|subscribe|sign.?in|log.?in|register|submit|send|accept|reject|consent|delete|remove|download|share|print|quantity|variant|colou?r|size|payment|wishlist|compare|filter|sort|next page|previous page)\b/i;
 const known = /\b(view|show|read|see|load)\s+(more|all|full|details)|\b(expand|specifications?|description|technical|features|details|dossier)\b/i;
 const visible = e => [...e.getClientRects()].some(r => r.width > 0 && r.height > 0) && getComputedStyle(e).visibility !== 'hidden';
 const dialogs = [...document.querySelectorAll('[role="dialog"],dialog[open]')].filter(visible);
 const scope = dialogs.at(-1) || document;
 let counter = Number(document.documentElement.dataset.paxthCounter || 0);
 const result = [];
 for(const e of scope.querySelectorAll('summary,button,[role="button"],[role="tab"],[aria-expanded],a[href^="#"]')) {
   if (!visible(e) || e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
   if (e.closest('form,nav,header,footer,[role="menu"],[role="radiogroup"],[class*="variant" i],[id*="variant" i],[class*="swatch" i],[id*="swatch" i],[data-option-index]')) continue;
   const text = (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 200);
   const context = (e.closest('fieldset,[role="group"]')?.textContent || '').slice(0, 400);
   if (unsafe.test(text + ' ' + context) || e.matches('[type="submit"],[type="reset"]')) continue;
   const href = e.getAttribute('href');
   if (href && !href.startsWith('#')) continue;
   const detail = e.tagName === 'SUMMARY';
   const tab = e.getAttribute('role') === 'tab';
   if (detail && e.parentElement.open || tab && e.getAttribute('aria-selected') === 'true') continue;
   const expanded = e.getAttribute('aria-expanded');
   if (expanded === 'true') continue;
   const closing = !!e.closest('[role="dialog"],dialog[open]') && /^(close|dismiss|×|x)$/i.test(text);
   if (!text && !detail) continue;
   if (!e.dataset.paxthControl) e.dataset.paxthControl = String(++counter);
   const targetIds = (e.getAttribute('aria-controls') || (href?.startsWith('#') ? href.slice(1) : '')).split(/\s+/).filter(Boolean);
   const hiddenTarget = targetIds.some(id => { const target = document.getElementById(id); return target && !target.getClientRects().length; });
   const standard = detail || tab || expanded === 'false' || known.test(text) || closing;
   if (!standard && !hiddenTarget && e.getAttribute('aria-haspopup') !== 'dialog') continue;
   result.push({id: e.dataset.paxthControl, text, standard, closing,
                repeat: /\b(load|show|view)\s+more\b/i.test(text)});
 }
 document.documentElement.dataset.paxthCounter = String(counter);
 return result;
}"""

READINESS = r"""() => {
 const visible = e => [...e.getClientRects()].some(r => r.width > 0 && r.height > 0) && getComputedStyle(e).visibility !== 'hidden';
 return {
   loading: [...document.querySelectorAll('[aria-busy="true"],[role="progressbar"]:not([aria-valuenow]),[data-loading="true"]')].some(visible),
   position: [scrollY, innerHeight, document.documentElement.scrollHeight],
   dialog: [...document.querySelectorAll('[role="dialog"],dialog[open]')].some(visible),
   frames: document.querySelectorAll('iframe').length,
   shadow: [...document.querySelectorAll('*')].some(e => e.shadowRoot)
 };
}"""

WARNING_MESSAGES = {
    'AMAZON_CONTINUE_RECOVERED': 'Amazon.ae continue shopping was submitted once and the requested product was verified.',
    'READINESS_TIMEOUT': 'Page content or relevant requests did not settle within the readiness window.',
    'INTERACTION_NO_CHANGE': 'A content control did not reveal a settled content or control-state change.',
    'INTERACTION_LIMIT': 'The page exceeded the limit of 20 content interactions.',
    'SCROLL_LIMIT': 'The page exceeded the limit of 20 scroll interactions.',
    'UNSUPPORTED_CONTROLS': 'Potential content controls remain unsupported or unresolved.',
    'DIALOG_UNRESOLVED': 'An open dialog could not be safely resolved before continuing.',
    'IFRAME_CONTENT_UNCHECKED': 'Embedded frame content was not inspected.',
    'SHADOW_CONTENT_UNCHECKED': 'Open shadow-root content was not inspected.',
}


def markdown_sections(html):
    from scrapling import Selector
    from markdownify import markdownify
    from bs4 import BeautifulSoup
    document = Selector(html)
    roots = document.css('body')
    # Captures are already visibility-filtered and URLs resolved against document.baseURI.
    selected = roots[0].html_content if roots else html
    soup = BeautifulSoup(selected, 'html.parser')
    for chrome in soup.select('script,style,noscript,template,nav,[role="banner"],[role="contentinfo"]'):
        chrome.decompose()
    return markdownify(str(soup), heading_style='ATX').strip()


async def retrieve(data):
    from cloakbrowser import binary_info, launch_async
    from playwright.async_api import TimeoutError as BrowserTimeoutError
    started = time.monotonic()
    override = os.environ.get('CLOAKBROWSER_BINARY_PATH')
    installed = override or binary_info()['binary_path']
    if not Path(installed).is_file():
        raise RetrievalError('BROWSER_UNAVAILABLE', 'BINARY_MISSING')
    # ensure_binary otherwise can initiate a download even with updates disabled.
    os.environ['CLOAKBROWSER_BINARY_PATH'] = installed
    browser = None
    chunks, seen = [], set()
    visited = set()
    clicks = scrolls = 0
    violation = None
    last_response = None
    pending = set()
    amazon_target = urlsplit(data.get('url', '')).hostname in ('amazon.ae', 'www.amazon.ae')
    requested_asin = amazon_asin(data.get('url', ''))
    verification = None
    verification_submitted = False
    warnings, unresolved = [], []

    def warn(code):
        if not any(warning['code'] == code for warning in warnings):
            warnings.append({'code': code, 'message': WARNING_MESSAGES[code]})

    def report(discard=False):
        return {'durationMs': round((time.monotonic() - started) * 1000),
                'characters': 0 if discard else len('\n\n'.join(chunks)),
                'clicks': clicks, 'scrolls': scrolls, 'warnings': warnings, 'unresolvedControls': unresolved}
    try:
        try:
            browser = await launch_async(headless=os.environ.get('SCRAPER_HEADLESS') == 'true', humanize=True,
                proxy={'server': data.get('proxy', 'http://127.0.0.1:9')}, timeout=20000,
                args=['--proxy-bypass-list=<-loopback>', '--disable-quic',
                      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
            context = await browser.new_context(service_workers='block', accept_downloads=False, permissions=[])
            page = await context.new_page()
            page.set_default_timeout(5000)
        except Exception as error:
            message = str(error)
            reason = ('SYSTEM_DEPENDENCIES_MISSING' if 'error while loading shared libraries' in message
                      else 'DISPLAY_UNAVAILABLE' if 'Missing X server' in message or 'Unable to open display' in message
                      else None)
            raise RetrievalError('BROWSER_UNAVAILABLE', reason) from None

        if data.get('mode') == 'check':
            await page.evaluate("document.body.innerHTML = '<main>Browser runtime check</main>'")
            if 'Browser runtime check' not in markdown_sections(await page.evaluate(CAPTURE)):
                raise RetrievalError('BROWSER_UNAVAILABLE', 'SYSTEM_DEPENDENCIES_MISSING')
            return {'success': True}

        async def guard(route):
            nonlocal violation, verification_submitted
            request = route.request
            parsed = urlsplit(request.url)
            if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
                await route.abort()
                return
            if request.is_navigation_request() and request.frame == page.main_frame:
                allowed = same_page(data['url'], request.url)
                if verification and request.method == 'GET':
                    action = urlsplit(verification['action'])
                    if (parsed.scheme, parsed.netloc, parsed.path) == (action.scheme, action.netloc, action.path):
                        allowed = not verification_submitted and parse_qs(parsed.query, keep_blank_values=True) == verification['fields']
                        if allowed:
                            verification_submitted = True
                    elif (parsed.scheme, parsed.netloc, parsed.path, parsed.query) == (action.scheme, action.netloc, '/', ''):
                        allowed = verification_submitted
                if request.method != 'GET' or not allowed:
                    violation = 'PAGE_CHANGED'
                    await route.abort()
                    return
            if request.method not in ('GET', 'HEAD'):
                # Permit read-only GraphQL rendering, never mutations or ordinary forms.
                try:
                    query = json.loads(request.post_data or '{}').get('query', '').lstrip()
                except (ValueError, AttributeError):
                    query = ''
                if not (request.resource_type in ('xhr', 'fetch') and query.startswith(('query ', 'query{', 'query {', '{')) and 'mutation' not in query.lower()):
                    await route.abort()
                    return
            await route.continue_()

        await context.route('**/*', guard)
        await context.route_web_socket('**/*', lambda websocket: websocket.close())
        context.on('page', lambda popup: asyncio.create_task(popup.close()) if popup != page else None)
        def received(response):
            nonlocal last_response
            if response.request.is_navigation_request() and response.request.frame == page.main_frame:
                last_response = response
        page.on('response', received)
        # ponytail: ignore known telemetry URLs; extend this list only for demonstrated long-poll noise.
        def requested(request):
            if request.resource_type in ('xhr', 'fetch') and not any(word in request.url.lower() for word in ('analytics', 'telemetry', 'tracking', '/beacon', 'doubleclick', 'google-analytics')):
                pending.add(request)
        page.on('request', requested)
        page.on('requestfinished', lambda request: pending.discard(request))
        page.on('requestfailed', lambda request: pending.discard(request))

        async def blocked():
            if amazon_target and await page.evaluate(AMAZON_GATE) is not None:
                return True
            text = (await page.locator('body').inner_text()).strip().lower()
            title = (await page.title()).lower()
            challenge = await page.locator('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #challenge-running, #cf-challenge-running').count()
            phrases = ('verify you are human', 'checking your browser', 'access denied', 'just a moment', 'captcha', 'unusual traffic', 'automated access')
            return bool(challenge or (len(text) < 6000 and any(p in text or p in title for p in phrases)))

        async def observe():
            if violation:
                raise RetrievalError(violation)
            if not same_page(data['url'], page.url):
                raise RetrievalError('PAGE_CHANGED')
            if await blocked():
                raise RetrievalError('PAGE_BLOCKED')
            product = await page.evaluate(AMAZON_PRODUCT) if requested_asin else None
            if product and product['asin'] and product['asin'] != requested_asin:
                raise RetrievalError('PAGE_CHANGED')
            html = await page.evaluate(CAPTURE)
            if len(html) > 2_000_000:
                raise RetrievalError('CONTENT_TOO_LARGE')
            state = await page.evaluate(READINESS)
            if state['frames']:
                warn('IFRAME_CONTENT_UNCHECKED')
            if state['shadow']:
                warn('SHADOW_CONTENT_UNCHECKED')
            return {'html': html, 'busy': state['loading'] or len(pending) or product is not None and not product['title'],
                    'position': tuple(state['position']), 'dialog': state['dialog'], 'productTitle': product['title'] if product else None}

        async def capture(observation=None):
            observation = observation or await observe()
            if requested_asin and not observation['productTitle']:
                raise RetrievalError('PAGE_UNAVAILABLE')
            html = observation['html']
            markdown = markdown_sections(html)
            for block in markdown.split('\n\n'):
                key = block.strip()
                if key and key not in seen:
                    seen.add(key)
                    chunks.append(key)
            if sum(map(len, chunks)) + 2 * len(chunks) > 199_000:
                raise RetrievalError('CONTENT_TOO_LARGE')

        async def candidates():
            return [c for c in await page.evaluate(CONTROLS) if c['id'] not in visited]

        async def click(control_id):
            nonlocal clicks, violation
            controls = {c['id']: c for c in await candidates()}
            control = controls.get(control_id)
            if control is None or not control_id.isdecimal() or len(control_id) > 8:
                raise RetrievalError('INCOMPLETE_CONTENT', 'UNSUPPORTED_CONTROLS')
            target = page.locator(f'[data-paxth-control="{control_id}"]')
            if await target.count() != 1:
                raise RetrievalError('INCOMPLETE_CONTENT', 'UNSUPPORTED_CONTROLS')
            if clicks >= 20:
                raise RetrievalError('INCOMPLETE_CONTENT', 'INTERACTION_LIMIT')
            clicks += 1
            before = await observe()
            action_started = time.monotonic()
            try:
                await target.click(timeout=5000)
            except BrowserTimeoutError:
                await capture()
                raise RetrievalError('INCOMPLETE_CONTENT', 'INTERACTION_NO_CHANGE') from None
            after, ready = await wait_for_readiness(observe, max(0, 5 - (time.monotonic() - action_started)), previous=before)
            await capture(after)
            if not ready:
                raise RetrievalError('INCOMPLETE_CONTENT', 'READINESS_TIMEOUT' if after['busy'] else 'INTERACTION_NO_CHANGE')
            if not control['repeat'] or before['html'] == after['html']:
                visited.add(control_id)

        async def scroll(bottom=False):
            nonlocal scrolls
            if scrolls >= 20:
                raise RetrievalError('INCOMPLETE_CONTENT', 'SCROLL_LIMIT')
            scrolls += 1
            # CloakBrowser's humanized mouse triggers lazy rendering.
            before = await observe()
            action_started = time.monotonic()
            await page.mouse.wheel(0, 650)
            after, ready = await wait_for_readiness(observe, max(0, 5 - (time.monotonic() - action_started)), minimum=1 if bottom else 0, previous=None if bottom else before, allow_scroll=True)
            await capture(after)
            if not ready:
                raise RetrievalError('INCOMPLETE_CONTENT', 'READINESS_TIMEOUT' if after['busy'] else 'INTERACTION_NO_CHANGE')
            return before, after

        async def recover_amazon(gate):
            nonlocal verification, clicks
            if not requested_asin or not gate['safe']:
                raise RetrievalError('PAGE_BLOCKED')
            verification = gate
            try:
                clicks += 1
                async with page.expect_navigation(wait_until='domcontentloaded', timeout=15000):
                    await page.locator('[data-paxth-amazon-continue="true"]').click(timeout=5000)
                if violation:
                    raise RetrievalError(violation)
                if not verification_submitted:
                    raise RetrievalError('PAGE_BLOCKED')
                current, action = urlsplit(page.url), urlsplit(gate['action'])
                homepage = (current.scheme, current.netloc, current.path, current.query) == (action.scheme, action.netloc, '/', '')
                if not homepage and not same_page(data['url'], page.url):
                    raise RetrievalError('PAGE_CHANGED')
                verification = None  # Restore the usual guard before returning to the exact product URL.
                if homepage:
                    await page.goto(data['url'], wait_until='domcontentloaded', timeout=15000)
                initial, ready = await wait_for_readiness(observe, 8, minimum=2)
                if not initial['productTitle']:
                    raise RetrievalError('PAGE_UNAVAILABLE')
                return initial, ready
            except (asyncio.TimeoutError, BrowserTimeoutError):
                raise RetrievalError(violation or 'PAGE_BLOCKED') from None
            finally:
                verification = None

        initial_result = None
        try:
            last_response = await page.goto(data['url'], wait_until='domcontentloaded', timeout=30000)
            if not same_page(data['url'], page.url):
                raise RetrievalError('PAGE_CHANGED')
            gate = await page.evaluate(AMAZON_GATE) if amazon_target else None
            if gate is not None:
                initial_result = await asyncio.wait_for(recover_amazon(gate), 15)
            # Bound automatic challenge clearance; never solve or click CAPTCHAs.
            for _ in range(10):
                if not await blocked():
                    break
                await asyncio.sleep(1)
            if await blocked() or last_response and last_response.status in (401, 403, 429):
                raise RetrievalError('PAGE_BLOCKED')
            if last_response and last_response.status >= 400:
                raise RetrievalError('PAGE_UNAVAILABLE')
            if initial_result:
                warn('AMAZON_CONTINUE_RECOVERED')
        except RetrievalError:
            raise
        except asyncio.TimeoutError:
            raise RetrievalError(violation or 'PAGE_BLOCKED') from None
        except Exception:
            raise RetrievalError(violation or 'PAGE_UNAVAILABLE')

        status = 'collected'
        try:
            initial, ready = initial_result or await wait_for_readiness(observe, 8, minimum=2)
            await capture(initial)
            if not ready:
                raise RetrievalError('INCOMPLETE_CONTENT', 'READINESS_TIMEOUT')
            # ponytail: deterministic DOM controls only; unsupported panels are reported for manual review.
            while True:
                controls = await candidates()
                standard = next((c for c in controls if c['standard']), None)
                if standard:
                    await click(standard['id'])
                    continue
                observation = await observe()
                if observation['dialog']:
                    raise RetrievalError('INCOMPLETE_CONTENT', 'DIALOG_UNRESOLVED')
                y, height, total = observation['position']
                if y + height < total - 5:
                    await scroll()
                    continue
                # Confirm bottom observations at least one second apart after lazy-loading triggers.
                before, after = await scroll(bottom=True)
                if before['html'] != after['html'] or before['position'] != after['position']:
                    continue
                break
            if await candidates():
                raise RetrievalError('INCOMPLETE_CONTENT', 'UNSUPPORTED_CONTROLS')
            await capture()
        except RetrievalError as error:
            if error.code != 'INCOMPLETE_CONTENT':
                raise
            status = 'partial'
            warn(error.reason or 'UNSUPPORTED_CONTROLS')
            await capture()  # Recheck identity/access before retaining any partial evidence.
            for control in await candidates():
                label = ' '.join(control['text'].split())[:120] or 'Unlabeled content control'
                if label not in unresolved and len(unresolved) < 20:
                    unresolved.append(label)
        markdown = '\n\n'.join(chunks)
        if not markdown:
            raise RetrievalError('EMPTY_PAGE')
        return {'status': status, 'markdown': markdown, 'finalUrl': page.url, 'report': report()}
    except RetrievalError as error:
        error.report = report(discard=True)
        raise
    finally:
        if browser:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(browser.close(), 5)


async def main(data):
    try:
        return await asyncio.wait_for(retrieve(data), 115)
    except RetrievalError as error:
        return {'error': True, 'code': error.code, 'reason': error.reason,
                **({'report': error.report} if hasattr(error, 'report') else {})}
    except ModuleNotFoundError:
        return {'error': True, 'code': 'BROWSER_UNAVAILABLE', 'reason': 'PYTHON_DEPENDENCIES_MISSING'}
    except (asyncio.CancelledError, asyncio.TimeoutError):
        return {'error': True, 'code': 'TIMEOUT'}
    except Exception:
        return {'error': True, 'code': 'INCOMPLETE_CONTENT'}


if __name__ == '__main__':
    data = json.loads(sys.stdin.read(512 * 1024))
    with contextlib.redirect_stdout(sys.stderr):
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        task = loop.create_task(main(data))
        loop.add_signal_handler(signal.SIGTERM, task.cancel)
        result = loop.run_until_complete(task)
        loop.close()
    print(json.dumps(result, ensure_ascii=False))
