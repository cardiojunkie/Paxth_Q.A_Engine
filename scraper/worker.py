"""One scrape, one private Crawl4AI browser. JSONL is the only stdout output."""
import asyncio
import contextlib
import hashlib
import ipaddress
import json
import re
import signal
import socket
import sys
import uuid
from urllib.parse import urlsplit, urlunsplit


class ScrapeError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def parse_url(value):
    try:
        url = urlsplit(value)
        if (url.scheme not in ("http", "https") or not url.hostname
                or url.username is not None or url.password is not None
                or any(char in value for char in "\r\n\x00\\") or "%" in url.hostname):
            raise ValueError()
        port = url.port or (443 if url.scheme == "https" else 80)
        if not 1 <= port <= 65535:
            raise ValueError()
        return url, port
    except (TypeError, ValueError):
        raise ScrapeError("Only public HTTP(S) URLs without credentials are supported.", 400)


def public_ip(value):
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address):
        if address in ipaddress.ip_network("64:ff9b::/96") or address in ipaddress.ip_network("64:ff9b:1::/48"):
            return False
        if address.ipv4_mapped:
            address = address.ipv4_mapped
        elif address.sixtofour or address.teredo:
            return False
    return address.is_global and not address.is_multicast and not address.is_reserved


async def resolve_public(host, port):
    try:
        records = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), 5
        )
        addresses = list(dict.fromkeys(record[4][0] for record in records))
        if not addresses or not all(public_ip(address) for address in addresses):
            raise ScrapeError("Private, local and reserved network destinations are blocked.", 400)
        # Prefer IPv4 on the documented IPv4-only deployment; validate all answers first.
        return next((address for address in addresses if ":" not in address), addresses[0])
    except ScrapeError:
        raise
    except (OSError, ValueError, asyncio.TimeoutError):
        raise ScrapeError("The source hostname could not be resolved.")


def page_path(value):
    url, _ = parse_url(value)
    return urlunsplit((url.scheme, url.netloc, url.path or "/", url.query, ""))


class PublicProxy:
    """Pin every HTTP/CONNECT connection to a validated public IP, including redirects."""
    def __init__(self):
        self.server = None
        self.tasks = set()

    async def start(self):
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0, limit=65536)
        return f"http://127.0.0.1:{self.server.sockets[0].getsockname()[1]}"

    async def close(self):
        if self.server:
            self.server.close()
            await self.server.wait_closed()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def handle(self, client, downstream):
        task = asyncio.current_task()
        self.tasks.add(task)
        upstream = None
        pumps = []
        connected = False
        try:
            header = await asyncio.wait_for(client.readuntil(b"\r\n\r\n"), 10)
            lines = header.decode("latin-1").split("\r\n")
            method, target, version = lines[0].split(" ")
            if version not in ("HTTP/1.0", "HTTP/1.1"):
                raise ScrapeError("Invalid proxy request", 400)
            url, port = parse_url("https://" + target if method == "CONNECT" else target)
            if method == "CONNECT" and (url.path or url.query or url.fragment):
                raise ScrapeError("Invalid CONNECT destination", 400)
            if method != "CONNECT" and (url.scheme != "http" or method not in ("GET", "HEAD", "POST", "OPTIONS", "PUT", "PATCH", "DELETE")):
                raise ScrapeError("Unsupported proxy request", 400)
            address = await resolve_public(url.hostname, port)
            remote, upstream = await asyncio.wait_for(asyncio.open_connection(address, port), 10)
            if method == "CONNECT":
                downstream.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await downstream.drain()
            else:
                path = urlunsplit(("", "", url.path or "/", url.query, ""))
                forwarded = [f"{method} {path} HTTP/1.1", f"Host: {url.netloc}", "Connection: close"]
                for line in lines[1:]:
                    if line and line.split(":", 1)[0].lower() not in ("host", "connection", "proxy-connection", "proxy-authorization"):
                        forwarded.append(line)
                upstream.write(("\r\n".join(forwarded) + "\r\n\r\n").encode("latin-1"))
                await upstream.drain()
            connected = True

            async def relay(reader, writer):
                while data := await reader.read(65536):
                    writer.write(data)
                    await writer.drain()

            pumps = [asyncio.create_task(relay(client, upstream)), asyncio.create_task(relay(remote, downstream))]
            await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED, timeout=120)
        except (Exception, asyncio.CancelledError):
            if not connected:
                with contextlib.suppress(Exception):
                    downstream.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    await downstream.drain()
        finally:
            for pump in pumps:
                pump.cancel()
            await asyncio.gather(*pumps, return_exceptions=True)
            for writer in (upstream, downstream):
                if writer:
                    writer.close()
                    with contextlib.suppress(Exception):
                        await writer.wait_closed()
            self.tasks.discard(task)


# Page data can only select a currently observed content control. Never execute model code.
CONTROL_KIND = r"""element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none' || element.disabled) return null;
    const label = (element.getAttribute('aria-label') || element.innerText || element.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 180);
    if (!label || /\b(cart|basket|buy|checkout|wishlist|quantity|size|colou?r|variant|purchase|subscribe|submit|delete|remove|sign.?in|log.?in|location|country|language|sort|filter)\b/i.test(label)) return null;
    if (element.closest('[class*="variant"],[id*="variant"],[class*="swatch"],[id*="swatch"],[data-variant],[class*="product-option"],[id*="product-option"],[role="listbox"]')) return null;
    if (element.matches('input,select,[role=combobox]') || element.getAttribute('aria-haspopup') || element.type === 'submit' && element.closest('form')) return null;
    const href = element.getAttribute('href');
    if (href && !href.startsWith('#')) return null;
    const contentLabel = /\b(description|overview|specifications?|specs|features|details|technical|dimensions|measurements|materials?|audio|display|connectivity|compatibility|reviews?|ratings?|warranty|care|documents?)\b/i.test(label);
    let kind;
    if (element.getAttribute('role') === 'tab' && element.getAttribute('aria-selected') !== 'true' && contentLabel) kind = 'tab';
    else if (element.tagName === 'SUMMARY' && !element.closest('details')?.open && contentLabel) kind = 'accordion';
    else if (element.getAttribute('aria-expanded') === 'false' && element.getAttribute('aria-controls') && contentLabel) kind = 'accordion';
    else if (/^(show|read|load|view|see)\s+(more|all|full|details|specifications|features|description)\b/i.test(label)) kind = 'expand';
    else if (/^(reject|decline|necessary only|only necessary|close|dismiss)\b/i.test(label) && element.closest('[role=dialog],[class*=cookie],[id*=cookie],[class*=consent],[id*=consent]')) kind = 'dismiss';
    return kind ? {label, kind} : null;
}"""


SERIALIZE = """({selector, paired, panels}) => {
    const clone = document.documentElement.cloneNode(true);
    if (selector) {
        const targets = clone.querySelectorAll(selector);
        for (let index = 0; index < targets.length; index++) {
            const chosen = paired ? panels.filter(panel => panel.index === index) : panels;
            targets[index].replaceChildren();
            for (const panel of chosen) {
                const section = document.createElement('section');
                section.setAttribute('data-specification-tab', '');
                const heading = document.createElement('h3'); heading.textContent = panel.label;
                section.append(heading);
                const content = document.createElement('div'); content.innerHTML = panel.html;
                section.append(content); targets[index].append(section);
            }
        }
    }
    return '<!DOCTYPE html>' + clone.outerHTML;
}"""


class Session:
    def __init__(self):
        self.crawler = None
        self.page = None
        self.proxy = PublicProxy()
        self.session_id = uuid.uuid4().hex
        self.rule = {}
        self.controls = {}
        self.captures = []
        self.hashes = set()
        self.capture_bytes = 0
        self.warnings = []
        self.panels = []
        self.paired = False
        self.panel_count = 0
        self.original_path = None
        self.navigation_error = False
        self.status = None
        self.closed = False
        self.actions = 0
        self.observation_id = 0

    async def open(self, url, rule=None):
        if self.crawler:
            raise ScrapeError("A worker handles only one product page.", 400)
        parsed, port = parse_url(url)
        await resolve_public(parsed.hostname, port)
        self.rule = rule or {}
        if not isinstance(self.rule, dict):
            raise ScrapeError("Invalid saved selector rule.", 422)
        tab = self.rule.get("tabSelector") or ""
        panel = self.rule.get("tabContentSelector") or ""
        wait = self.rule.get("tabWaitMs", 300)
        wait = 300 if wait is None else wait
        if not isinstance(tab, str) or not isinstance(panel, str) or bool(tab.strip()) != bool(panel.strip()):
            raise ScrapeError("Tab and panel selectors must be provided together.", 422)
        if type(wait) is not int or not 0 <= wait <= 10000:
            raise ScrapeError("Dynamic tab wait must be an integer between 0 and 10000 ms.", 422)
        self.rule.update(tabSelector=tab.strip(), tabContentSelector=panel.strip(), tabWaitMs=wait)
        from crawl4ai import AsyncWebCrawler, BrowserConfig
        proxy_url = await self.proxy.start()
        browser = BrowserConfig(
            headless=True, enable_stealth=True, verbose=False,
            text_mode=False, accept_downloads=False, ignore_https_errors=False,
            proxy_config={"server": proxy_url},
            extra_args=["--proxy-bypass-list=<-loopback>", "--disable-quic",
                        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                        "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"],
        )
        self.crawler = AsyncWebCrawler(config=browser)

        async def on_page(page, context, **_):
            self.page = page
            await context.add_init_script("Object.defineProperty(window, 'RTCPeerConnection', {value: undefined, writable: false, configurable: false});")
            # The proxy protects service-worker and subresource traffic too. Routing
            # additionally prevents non-HTTP document loads and product navigation.
            async def route_request(route):
                request = route.request
                if request.is_navigation_request():
                    try:
                        destination = page_path(request.url)
                        if request.frame == page.main_frame and self.original_path and destination != self.original_path:
                            self.navigation_error = True
                            await route.abort()
                            return
                    except ScrapeError:
                        await route.abort()
                        return
                await route.continue_()
            await context.route("**/*", route_request)
            context.on("page", lambda other: asyncio.create_task(other.close()) if other != page else None)
            return page

        self.crawler.crawler_strategy.set_hook("on_page_context_created", on_page)
        await self.crawler.start()
        await self.refresh(url, initial=True)
        self.original_path = page_path(self.page.url)
        if self.rule["tabSelector"]:
            await self.capture_tabs()
        await self.save_capture("Product page")
        return await self.observe()

    async def refresh(self, url=None, initial=False):
        from crawl4ai import CrawlerRunConfig, CacheMode
        result = await self.crawler.arun(
            url=url or self.page.url,
            config=CrawlerRunConfig(
                session_id=self.session_id, js_only=not initial,
                cache_mode=CacheMode.BYPASS, simulate_user=True, verbose=False,
                page_timeout=30000, wait_until="domcontentloaded", delay_before_return_html=0.3,
                scan_full_page=initial, max_scroll_steps=30, scroll_delay=0.1,
                max_retries=0,
            ),
        )
        self.status = result.status_code if result.status_code is not None else self.status
        if not result.success:
            raise ScrapeError("The source page could not be retrieved: " + (result.error_message or "browser failure")[:500])
        await self.check_page()

    async def check_page(self):
        if not self.page or self.page.is_closed():
            raise ScrapeError("The browser page is unavailable.")
        if self.navigation_error or self.original_path and page_path(self.page.url) != self.original_path:
            raise ScrapeError("A content control navigated away from the product page.", 422)
        if self.status is not None and self.status >= 400:
            raise ScrapeError(f"Source website returned HTTP {self.status}.")
        html = await self.page.content()
        from crawl4ai.antibot_detector import is_blocked
        blocked, reason = is_blocked(self.status, html)
        if blocked:
            raise ScrapeError("The source returned a verification page: " + reason)
        host = urlsplit(self.page.url).hostname or ""
        if re.search(r"(^|\.)amazon\.(?:[a-z]{2,3}|(?:co|com)\.[a-z]{2})$", host, re.I) and (
            re.search(r"<form\b[^>]*\baction\s*=\s*[\"'][^\"']*validateCaptcha", html, re.I)
            or re.search(r"Click the button below to continue shopping", html, re.I)
        ):
            raise ScrapeError("Amazon returned a verification page instead of product content.")
        if await self.page.locator('input[type="password"]:visible').count():
            raise ScrapeError("The source requires sign-in before its content can be retrieved.")

    async def capture_tabs(self):
        tab_selector = self.rule["tabSelector"]
        panel_selector = self.rule["tabContentSelector"]
        try:
            tabs = self.page.locator(tab_selector)
            count = await tabs.count()
            panel_count = await self.page.locator(panel_selector).count()
        except Exception:
            raise ScrapeError("Invalid configured tab or content selector.", 422)
        if not 1 <= count <= 50:
            raise ScrapeError(f"Expected 1-50 dynamic tabs, found {count}.", 422)
        self.paired = count > 1 and panel_count == count
        self.panel_count = panel_count
        if panel_count != 1 and not self.paired:
            raise ScrapeError(f"Expected one shared panel or {count} paired panels, found {panel_count}.", 422)
        for index in range(count):
            label = f"Tab {index + 1}"
            try:
                label = (await tabs.nth(index).inner_text()).strip() or label
                await tabs.nth(index).click(timeout=5000)
                await asyncio.sleep(self.rule["tabWaitMs"] / 1000)
                await self.check_page()
                panels = self.page.locator(panel_selector)
                if await panels.count() != panel_count:
                    raise ScrapeError("The configured content panel count changed.", 422)
                # Save the live panel before the next control can overwrite it.
                self.panels.append({"index": index, "label": label, "html": await panels.nth(index if self.paired else 0).inner_html()})
            except ScrapeError:
                raise
            except Exception:
                await self.check_page()
                self.warnings.append(f"Specification tab not captured: {label}")
        if not self.panels:
            raise ScrapeError("No configured specification tabs could be captured.", 422)

    async def observe(self):
        await self.check_page()
        for element, _ in self.controls.values():
            with contextlib.suppress(Exception):
                await element.dispose()
        self.controls = {}
        self.observation_id += 1
        candidates = await self.page.query_selector_all('button,[role="tab"],summary,[aria-expanded],a[href^="#"]')
        offered = []
        # ponytail: inspect 200 controls; add section-based discovery if real pages exceed this ceiling.
        for element in candidates[:200]:
            try:
                if self.rule.get("tabSelector") and await element.evaluate("(element, selector) => element.matches(selector)", self.rule["tabSelector"]):
                    continue
                details = await element.evaluate(CONTROL_KIND)
                if details and len(offered) < 80:
                    control_id = f"o{self.observation_id}-c{len(offered) + 1}"
                    self.controls[control_id] = (element, details)
                    offered.append({"id": control_id, **details})
            except Exception:
                continue
        return {"url": self.page.url, "title": await self.page.title(),
                "text": (await self.page.locator("body").inner_text())[:30000], "controls": offered}

    async def save_capture(self, label):
        await self.check_page()
        if self.panels and await self.page.locator(self.rule["tabContentSelector"]).count() != self.panel_count:
            raise ScrapeError("The configured content panel count changed.", 422)
        html = await self.page.evaluate(SERIALIZE, {
            "selector": self.rule.get("tabContentSelector") if self.panels else None,
            "paired": self.paired, "panels": self.panels,
        })
        digest = hashlib.sha256(html.encode()).digest()
        if digest not in self.hashes:
            self.capture_bytes += len(html.encode())
            if self.capture_bytes > 20_000_000:
                raise ScrapeError("The page exceeded the 20 MB source capture limit.", 413)
            self.hashes.add(digest)
            self.captures.append({"label": label[:180], "html": html})

    async def act(self, action):
        if not isinstance(action, dict) or action.get("type") not in ("click", "scroll", "wait"):
            raise ScrapeError("Unsupported browser action.", 422)
        if self.actions >= 8:
            raise ScrapeError("The browser action limit was reached.", 422)
        self.actions += 1
        await self.save_capture("Before interaction")
        label = action["type"]
        if action["type"] == "click":
            target = action.get("target")
            if not isinstance(target, str) or target not in self.controls:
                raise ScrapeError("Choose a content control from the latest observation.", 422)
            element, details = self.controls[target]
            if await element.evaluate(CONTROL_KIND) != details:
                raise ScrapeError("The content control changed; inspect the page again.", 422)
            label = details["label"]
            await element.click(timeout=5000)
        elif action["type"] == "scroll":
            await self.page.mouse.wheel(0, 800)
        else:
            await asyncio.sleep(0.5)
        await self.refresh()
        await self.save_capture(label)
        return await self.observe()

    async def capture(self):
        await self.save_capture("Product page")
        return {"captures": self.captures, "warnings": self.warnings}

    async def close(self):
        if self.closed:
            return
        self.closed = True
        if self.crawler:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self.crawler.close(), 8)
        await self.proxy.close()


async def run():
    protocol_out = sys.stdout
    sys.stdout = sys.stderr
    session = Session()
    reader = asyncio.StreamReader(limit=1_000_000)
    transport, _ = await asyncio.get_running_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    task = asyncio.current_task()
    for name in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(name, task.cancel)
    request_id = None

    def reply(value):
        protocol_out.write(json.dumps(value, ensure_ascii=False) + "\n")
        protocol_out.flush()

    try:
        async with asyncio.timeout(120):
            while line := await reader.readline():
                request_id = None
                try:
                    request = json.loads(line)
                    if not isinstance(request, dict):
                        raise ScrapeError("Invalid worker request.", 400)
                    request_id = request.get("id")
                    command = request.get("command")
                    if command == "close":
                        await session.close()
                        reply({"id": request_id, "ok": True, "result": {}})
                        break
                    if command == "open":
                        result = await session.open(request.get("url"), request.get("rule"))
                    elif not session.page:
                        raise ScrapeError("Open a product page first.", 400)
                    elif command == "observe":
                        result = await session.observe()
                    elif command == "act":
                        result = await session.act(request.get("action"))
                    elif command == "capture":
                        result = await session.capture()
                    else:
                        raise ScrapeError("Unknown worker command.", 400)
                    reply({"id": request_id, "ok": True, "result": result})
                except Exception as error:
                    message = str(error)[:800] if isinstance(error, ScrapeError) else "The browser could not complete this request."
                    if isinstance(error, json.JSONDecodeError):
                        message = "Invalid JSON worker request."
                    reply({"id": request_id, "ok": False, "error": message, "status": 400 if isinstance(error, json.JSONDecodeError) else getattr(error, "status", 502)})
    except TimeoutError:
        reply({"id": request_id, "ok": False, "error": "The scrape exceeded its 120 second limit.", "status": 504})
    finally:
        transport.close()
        await session.close()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
