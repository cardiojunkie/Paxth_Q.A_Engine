"""One isolated CloakBrowser; Scrapling selects captured DOM for Markdown evidence."""
import asyncio
import contextlib
import json
import os
import signal
import sys
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


def same_page(submitted, current):
    a, b = urlsplit(submitted), urlsplit(current)
    original, actual = parse_qs(a.query, keep_blank_values=True), parse_qs(b.query, keep_blank_values=True)
    return (b.scheme in ('http', 'https') and b.port in (None, 80, 443)
            and not b.username and not b.password
            and a.hostname.removeprefix('www.') == (b.hostname or '').removeprefix('www.')
            and a.path.rstrip('/') == b.path.rstrip('/')
            and all(actual.get(key) == value for key, value in original.items())
            and not any(key not in original and any(word in key.lower() for word in ('variant', 'offer', 'seller', 'sku', 'product', 'color', 'colour', 'size', 'quantity')) for key in actual))


# DOM visibility includes offscreen content, but excludes inactive tabs and closed disclosures.
CAPTURE = r"""() => {
 const visible = e => [...e.getClientRects()].some(r => r.width > 0 && r.height > 0) && getComputedStyle(e).visibility !== 'hidden';
 const roots = [...document.querySelectorAll('main,article,[role="main"],[role="dialog"],dialog[open]')].filter(visible);
 const selected = roots.length ? roots.filter(e => !roots.some(p => p !== e && p.contains(e))) : [document.body];
 return selected.map(root => {
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
     if (['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','NAV','HEADER','FOOTER'].includes(e.tagName) ||
         (!visible(e) && getComputedStyle(e).display !== 'contents')) clones[i].remove();
   }
   return copy.outerHTML;
 }).join('\n');
}"""

CONTROLS = r"""() => {
 const unsafe = /\b(buy|cart|checkout|purchase|order|subscribe|sign.?in|log.?in|register|submit|send|accept|reject|consent|delete|remove|download|share|print|quantity|variant|colou?r|size|payment|wishlist|compare|filter|sort|next page|previous page)\b/i;
 const known = /\b(view|show|read|see|load)\s+(more|all|full|details)|\b(expand|specifications?|description|technical|features|details|dossier)\b/i;
 const roots = [...document.querySelectorAll('main,article,[role="main"],[role="dialog"],dialog[open]')];
 let counter = Number(document.documentElement.dataset.paxthCounter || 0);
 const result = [];
 for(const e of document.querySelectorAll('summary,button,[role="button"],[role="tab"],[aria-expanded],a[href^="#"]')) {
   if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden' || e.disabled || e.getAttribute('aria-disabled') === 'true') continue;
   if (roots.length && !roots.some(r => r.contains(e))) continue;
   if (e.closest('form,nav,header,footer,[role="menu"],[role="radiogroup"],[class*="variant"],[id*="variant"],[class*="swatch"],[id*="swatch"],[data-option-index]')) continue;
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


def markdown_sections(html):
    from scrapling import Selector
    from markdownify import markdownify
    document = Selector(html)
    roots = document.css('main, article, [role="main"], [role="dialog"], dialog[open]')
    # Captures are already visibility-filtered and URLs resolved against document.baseURI.
    roots = [node for node in roots if not node.xpath('ancestor::main | ancestor::article | ancestor::*[@role="main" or @role="dialog"] | ancestor::dialog[@open]')]
    selected = '\n'.join(node.html_content for node in roots) if roots else html
    return markdownify(selected, heading_style='ATX', strip=['script', 'style', 'nav', 'header', 'footer']).strip()


async def retrieve(data):
    from cloakbrowser import binary_info, launch_async
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
            nonlocal violation
            request = route.request
            parsed = urlsplit(request.url)
            if parsed.scheme not in ('http', 'https') or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
                await route.abort()
                return
            if request.is_navigation_request() and request.frame == page.main_frame:
                if request.method != 'GET' or not same_page(data['url'], request.url):
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

        async def blocked():
            text = (await page.locator('body').inner_text()).strip().lower()
            title = (await page.title()).lower()
            challenge = await page.locator('iframe[src*="captcha"], iframe[src*="challenges.cloudflare"], #challenge-running, #cf-challenge-running').count()
            phrases = ('verify you are human', 'checking your browser', 'access denied', 'just a moment', 'captcha', 'unusual traffic', 'automated access')
            return bool(challenge or (len(text) < 6000 and any(p in text or p in title for p in phrases)))

        async def capture():
            if violation:
                raise RetrievalError(violation)
            if not same_page(data['url'], page.url):
                raise RetrievalError('PAGE_CHANGED')
            if await blocked():
                raise RetrievalError('PAGE_BLOCKED')
            html = await page.evaluate(CAPTURE)
            if len(html) > 2_000_000:
                raise RetrievalError('CONTENT_TOO_LARGE')
            markdown = markdown_sections(html)
            for block in markdown.split('\n\n'):
                key = block.strip()
                if key and key not in seen:
                    seen.add(key)
                    chunks.append(key)
            if sum(map(len, chunks)) + 2 * len(chunks) > 199_000:
                raise RetrievalError('CONTENT_TOO_LARGE')

        async def settle():
            await asyncio.sleep(0.8)
            await capture()

        async def candidates():
            return [c for c in await page.evaluate(CONTROLS) if c['id'] not in visited]

        async def click(control_id):
            nonlocal clicks, violation
            controls = {c['id']: c for c in await candidates()}
            control = controls.get(control_id)
            if control is None or not control_id.isdecimal() or len(control_id) > 8:
                raise RetrievalError('INCOMPLETE_CONTENT')
            target = page.locator(f'[data-paxth-control="{control_id}"]')
            if await target.count() != 1:
                raise RetrievalError('INCOMPLETE_CONTENT')
            if clicks >= 20:
                raise RetrievalError('INCOMPLETE_CONTENT')
            clicks += 1
            before = await page.evaluate(CAPTURE)
            await target.click(timeout=5000)
            await settle()
            after = await page.evaluate(CAPTURE)
            if not control['repeat'] or before == after:
                visited.add(control_id)
            if before == after and not control['closing']:
                raise RetrievalError('INCOMPLETE_CONTENT')

        async def scroll():
            nonlocal scrolls
            if scrolls >= 20:
                raise RetrievalError('INCOMPLETE_CONTENT')
            scrolls += 1
            # CloakBrowser's humanized mouse triggers lazy rendering.
            await page.mouse.wheel(0, 650)
            await settle()

        try:
            last_response = await page.goto(data['url'], wait_until='domcontentloaded', timeout=30000)
            await asyncio.sleep(1)
            # Bound automatic challenge clearance; never solve or click CAPTCHAs.
            for _ in range(10):
                if not await blocked():
                    break
                await asyncio.sleep(1)
            if await blocked() or last_response and last_response.status in (401, 403, 429):
                raise RetrievalError('PAGE_BLOCKED')
            if last_response and last_response.status >= 400:
                raise RetrievalError('PAGE_UNAVAILABLE')
            await capture()
        except RetrievalError:
            raise
        except Exception:
            raise RetrievalError(violation or 'PAGE_UNAVAILABLE')

        # ponytail: deterministic DOM controls only; unsupported hidden panels need manual content.
        while True:
            controls = await candidates()
            standard = next((c for c in controls if c['standard']), None)
            if standard:
                await click(standard['id'])
                continue
            state = await page.evaluate('() => ({y: scrollY, height: innerHeight, total: document.documentElement.scrollHeight})')
            if state['y'] + state['height'] < state['total'] - 5:
                await scroll()
                continue
            # A bottom scroll also triggers IntersectionObserver and delayed lazy loading.
            before = await page.evaluate(CAPTURE)
            await scroll()
            if before != await page.evaluate(CAPTURE):
                continue
            break

        if await candidates():
            raise RetrievalError('INCOMPLETE_CONTENT')
        await capture()
        markdown = '\n\n'.join(chunks)
        if not markdown:
            raise RetrievalError('EMPTY_PAGE')
        return {'markdown': markdown, 'finalUrl': page.url}
    finally:
        if browser:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(browser.close(), 5)


async def main(data):
    try:
        return await asyncio.wait_for(retrieve(data), 115)
    except RetrievalError as error:
        return {'error': True, 'code': error.code, 'reason': error.reason}
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
