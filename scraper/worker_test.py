"""Run with the scraper venv: python -m unittest discover -s scraper -p '*_test.py'."""
import asyncio
import contextlib
import json
import socket
import unittest
from unittest.mock import patch

from worker import PublicProxy, ScrapeError, Session, parse_url, public_ip, resolve_public


class NetworkChecks(unittest.IsolatedAsyncioTestCase):
    async def test_private_dns_and_rebinding_are_rejected(self):
        for value in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::a00:1", "2002:7f00:1::", "224.0.0.1"):
            self.assertFalse(public_ip(value), value)
        self.assertTrue(public_ip("8.8.8.8"))
        self.assertTrue(public_ip("2606:4700:4700::1111"))
        for value in ("file:///etc/passwd", "https://user:secret@example.com/", "http://[fe80::1%eth0]/", "http://example.com:99999"):
            with self.assertRaises(ScrapeError):
                parse_url(value)
        loop = asyncio.get_running_loop()
        def record(ip):
            return (socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 80))
        with patch.object(loop, "getaddrinfo", return_value=[record("8.8.8.8"), record("127.0.0.1")]):
            with self.assertRaisesRegex(ScrapeError, "Private"):
                await resolve_public("mixed.example", 80)
        with patch.object(loop, "getaddrinfo", side_effect=[[record("8.8.8.8")], [record("169.254.169.254")]]):
            self.assertEqual(await resolve_public("rebind.example", 80), "8.8.8.8")
            with self.assertRaises(ScrapeError):
                await resolve_public("rebind.example", 80)

    async def test_proxy_pins_the_socket_and_blocks_connect_to_private_hosts(self):
        proxy = PublicProxy()
        proxy_url = await proxy.start()
        port = int(proxy_url.rsplit(":", 1)[1])
        received = []

        async def upstream(reader, writer):
            received.append(await reader.readuntil(b"\r\n\r\n"))
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\npinned")
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(upstream, "127.0.0.1", 0)
        fixture_port = server.sockets[0].getsockname()[1]
        original_open = asyncio.open_connection
        connected = []

        async def open_pinned(host, target_port, **kwargs):
            if host == "8.8.8.8":
                connected.append((host, target_port))
                return await original_open("127.0.0.1", fixture_port)
            return await original_open(host, target_port, **kwargs)

        try:
            with patch("worker.resolve_public", return_value="8.8.8.8"), patch("worker.asyncio.open_connection", side_effect=open_pinned):
                reader, writer = await original_open("127.0.0.1", port)
                writer.write(b"GET http://public.example/data HTTP/1.1\r\nHost: localhost\r\n\r\n")
                await writer.drain()
                self.assertIn(b"pinned", await asyncio.wait_for(reader.read(), 3))
                writer.close()
            self.assertEqual(connected, [("8.8.8.8", 80)])
            self.assertIn(b"Host: public.example", received[0])
            self.assertNotIn(b"Host: localhost", received[0])
            for target in ("127.0.0.1:80", "169.254.169.254:80", "[::1]:443"):
                reader, writer = await original_open("127.0.0.1", port)
                writer.write(f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n".encode())
                await writer.drain()
                self.assertIn(b"403 Forbidden", await asyncio.wait_for(reader.read(), 3))
                writer.close()
        finally:
            await proxy.close()
            server.close()
            await server.wait_closed()


class BrowserChecks(unittest.IsolatedAsyncioTestCase):
    async def test_source_tabs_safe_actions_and_network_guards(self):
        from bs4 import BeautifulSoup

        received = []
        content = "Product specifications and reference information. " * 20
        fixture = f"""<!doctype html><html><head><title>Fixture product</title></head><body>
            <h1>Fixture product</h1><p>{content}</p>
            <div id="product">
              <button class="tab">Features</button><div class="panel">Stale features</div>
              <button class="tab">Measurements</button><div class="panel">Stale measurements</div>
              <button aria-controls="extra" aria-expanded="false" id="more">Additional specifications</button>
              <div id="extra"></div><div style="height:1800px"></div><p id="lazy"></p>
            </div>
            <button id="buy">Buy now</button><button aria-haspopup="listbox">Colour</button>
            <button role="tab">Red</button><button role="tab">Blue</button>
            <button role="tab" aria-selected="true">Description</button>
            <div class="variant"><button role="tab">Audio</button></div>
            <script>
              const values = ['<table><tr><th>Model</th><td>A1</td></tr></table>', '<p>Width: 10 cm</p>'];
              document.querySelectorAll('.tab').forEach((tab, i) => tab.onclick = () => document.querySelectorAll('.panel')[i].innerHTML = values[i]);
              document.querySelector('#more').onclick = () => {{ document.querySelector('#extra').innerHTML = '<p>Weight: 42 g</p>'; document.querySelector('#more').setAttribute('aria-expanded', 'true'); }};
              window.addEventListener('scroll', () => {{ if (scrollY > 400) document.querySelector('#lazy').textContent = 'Lazy warranty: 2 years'; }});
            </script></body></html>"""

        async def serve(reader, writer):
            request = await reader.readuntil(b"\r\n\r\n")
            path = request.split(b" ")[1].decode()
            received.append(path)
            if path == "/redirect":
                writer.write(f"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{port}/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".encode())
            else:
                body = fixture.encode()
                writer.write(f"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
            await writer.drain()
            writer.close()

        server = await asyncio.start_server(serve, "127.0.0.1", 0)
        port = server.sockets[0].getsockname()[1]
        original_resolve = resolve_public

        async def fixture_dns(host, target_port):
            # Test-local mock only: the production worker has no private-host bypass.
            return "127.0.0.1" if host == "fixture.test" else await original_resolve(host, target_port)

        session = Session()
        try:
            with patch("worker.resolve_public", side_effect=fixture_dns):
                observation = await session.open(f"http://fixture.test:{port}/product", {
                    "selectors": "#product", "tabSelector": ".tab", "tabContentSelector": ".panel", "tabWaitMs": 0,
                })
                self.assertEqual(observation["title"], "Fixture product")
                self.assertEqual([control["label"] for control in observation["controls"]], ["Additional specifications"])
                initial = await session.capture()
                source = BeautifulSoup(initial["captures"][0]["html"], "html.parser").select_one("#product").get_text()
                self.assertIn("A1", source)
                self.assertIn("Width: 10 cm", source)
                self.assertIn("Lazy warranty: 2 years", source)
                self.assertNotIn("Stale", source)
                await session.act({"type": "click", "target": observation["controls"][0]["id"]})
                after = await session.capture()
                self.assertIn("Weight: 42 g", after["captures"][-1]["html"])
                for capture in after["captures"]:
                    self.assertNotIn("Stale", BeautifulSoup(capture["html"], "html.parser").select_one("#product").get_text())
                with self.assertRaisesRegex(ScrapeError, "latest observation"):
                    await session.act({"type": "click", "target": "invented"})
                with self.assertRaisesRegex(ScrapeError, "Unsupported"):
                    await session.act({"type": "eval", "code": "fetch('http://localhost')"})
                # More configured tabs than LLM decisions still capture every shared panel.
                await session.page.set_content(f'''<h1>Product reference</h1><p>{content}</p>
                    <main id="shared-product"><div id="tabs"></div><div id="shared">Initial panel</div></main>
                    <script>for(let i=0;i<9;i++){{const b=document.createElement('button');
                    b.className='shared-tab';b.textContent='Specification '+i;
                    b.onclick=()=>document.querySelector('#shared').innerHTML='<p>Value '+i+'</p>';
                    document.querySelector('#tabs').append(b);}}</script>''')
                session.rule.update(tabSelector=".shared-tab", tabContentSelector="#shared", tabWaitMs=0)
                session.panels = []
                await session.capture_tabs()
                await session.save_capture("Shared panels")
                shared = BeautifulSoup(session.captures[-1]["html"], "html.parser").select_one("#shared").get_text()
                for index in range(9):
                    self.assertIn(f"Specification {index}", shared)
                    self.assertIn(f"Value {index}", shared)
                self.assertNotIn("Initial panel", shared)
                # One disabled tab retains the other panels and reports an explicit warning.
                await session.page.locator('.shared-tab').nth(0).evaluate('(e) => e.disabled=true')
                session.panels = []
                await session.capture_tabs()
                self.assertEqual(len(session.panels), 8)
                self.assertIn("Specification 0", session.warnings[-1])
                session.rule.update(tabSelector="[", tabContentSelector="#shared")
                with self.assertRaisesRegex(ScrapeError, "Invalid configured"):
                    await session.capture_tabs()
                await session.page.set_content(f'<h1>Sign in</h1><p>{content}</p><input type="password">')
                with self.assertRaisesRegex(ScrapeError, "sign-in"):
                    await session.check_page()
                await session.page.set_content('<html><head><title>Just a moment...</title></head><body><div id="cf-challenge-running">Verify you are human</div></body></html>')
                with self.assertRaises(ScrapeError):
                    await session.check_page()
                await session.page.set_content(f'<main id="product"><h1>Product</h1><p>{content}</p></main>')
                session.status = 404
                with self.assertRaisesRegex(ScrapeError, "HTTP 404"):
                    await session.check_page()
                session.status = 200
                # Browser subrequests cannot bypass the proxy's loopback protection.
                await session.page.evaluate("url => fetch(url).catch(() => null)", f"http://127.0.0.1:{port}/private")
                self.assertNotIn("/private", received)
                # Configured navigation controls fail rather than returning a different product.
                await session.page.evaluate("() => { const a=document.createElement('a'); a.className='bad'; a.href='/other'; a.textContent='Elsewhere'; document.body.append(a); }")
                session.rule.update(tabSelector=".bad", tabContentSelector="#product")
                with self.assertRaisesRegex(ScrapeError, "navigated away"):
                    await session.capture_tabs()
                self.assertNotIn("/other", received)
                await session.close()
                blocked = Session()
                try:
                    with self.assertRaises(ScrapeError):
                        await blocked.open(f"http://fixture.test:{port}/redirect")
                    self.assertNotIn("/private", received)
                finally:
                    await blocked.close()
        finally:
            await session.close()
            server.close()
            await server.wait_closed()


if __name__ == "__main__":
    unittest.main()
