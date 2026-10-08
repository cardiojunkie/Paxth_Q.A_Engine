import asyncio
import unittest
from unittest.mock import patch
from browser_scrape import amazon_asin, same_page, markdown_sections, wait_for_readiness, main, RetrievalError


class ExtractionChecks(unittest.TestCase):
    def test_amazon_scope(self):
        for path in ['/Name/dp/B0GQCXP6VM/ref?th=1', '/gp/product/b0gqcxp6vm']:
            self.assertEqual(amazon_asin('https://www.amazon.ae' + path), 'B0GQCXP6VM')
        for url in ['https://amazon.com/dp/B0GQCXP6VM', 'https://amazon.ae.evil.com/dp/B0GQCXP6VM',
                    'https://amazon.ae/', 'https://amazon.ae/dp/B0GQCXP6VMEXTRA']:
            self.assertIsNone(amazon_asin(url))

    def test_identity_and_evidence(self):
        original = 'https://example.com/product?offer=42&offer=43&variant=blue&blank='
        self.assertTrue(same_page(original, original + '&tracking=1#details'))
        self.assertTrue(same_page(original, original.replace('example.com', 'www.example.com')))
        for changed in ['https://example.com/other', original.replace('blue', 'red'), original.replace('42&offer=43', '43&offer=42'), original.replace('&blank=', ''), 'http://127.0.0.1/product', 'https://example.com:3000/product', original + '&sku=different']:
            self.assertFalse(same_page(original, changed))
        markdown = markdown_sections('<main><h1>Café 😀 漢字</h1><article><p>Nested content once</p></article><table><tr><th>Rating</th><th>Voltage</th></tr><tr><td>4.8</td><td>220 V</td></tr></table><ul><li>12.75 kg</li></ul><a href="https://example.com/manual">Guide</a></main><nav>Unrelated</nav>')
        for text in ['# Café 😀 漢字', '4.8', '220 V', '|', '* 12.75 kg', '[Guide](https://example.com/manual)']:
            self.assertIn(text, markdown)
        self.assertEqual(markdown.count('Nested content once'), 1)
        self.assertNotIn('Unrelated', markdown)

    def test_whole_body_and_bounded_readiness(self):
        markdown = markdown_sections('<body><p>Product identity outside main</p><main><article><header><h1>Product title</h1></header><p>Main details</p></article></main><p>Specifications outside main</p><nav>Unrelated</nav></body>')
        for text in ['Product identity outside main', 'Product title', 'Main details', 'Specifications outside main']:
            self.assertIn(text, markdown)
        self.assertNotIn('Unrelated', markdown)

        clock = [0.0]
        async def sleep(seconds):
            clock[0] += seconds
        async def observe():
            return {'html': 'Loading' if clock[0] < 3 else '220 V', 'busy': clock[0] < 3, 'position': (0, 800, 800)}
        async def check():
            result, ready = await wait_for_readiness(observe, 8, minimum=2)
            self.assertTrue(ready)
            self.assertEqual(result['html'], '220 V')
            self.assertGreaterEqual(clock[0], 3.75)
            clock[0] = 0
            async def unchanged():
                return {'html': 'Safe earlier evidence', 'busy': False, 'position': (0, 800, 800)}
            previous = await unchanged()
            result, ready = await wait_for_readiness(unchanged, 5, previous=previous)
            self.assertFalse(ready)
            self.assertEqual(clock[0], 5)
            self.assertEqual(result['html'], 'Safe earlier evidence')
            clock[0] = 0
            scrolled = {**previous, 'position': (650, 800, 1450)}
            async def moved_only():
                return scrolled
            result, ready = await wait_for_readiness(moved_only, 5, previous=previous)
            self.assertFalse(ready, 'Auto-scrolling to a control is not a content change')
            clock[0] = 0
            result, ready = await wait_for_readiness(moved_only, 5, previous=previous, allow_scroll=True)
            self.assertTrue(ready, 'An intentional scroll can settle without changing existing content')
            clock[0] = 0
            result, ready = await wait_for_readiness(unchanged, 8, minimum=2)
            self.assertTrue(ready)
            self.assertEqual(clock[0], 2)
        with patch('browser_scrape.time.monotonic', side_effect=lambda: clock[0]), patch('browser_scrape.asyncio.sleep', side_effect=sleep):
            asyncio.run(check())

    def test_hard_failure_never_returns_markdown(self):
        async def fail(_data):
            error = RetrievalError('PAGE_CHANGED')
            error.report = {'durationMs': 10, 'characters': 0, 'clicks': 1, 'scrolls': 0, 'warnings': [], 'unresolvedControls': []}
            raise error
        with patch('browser_scrape.retrieve', side_effect=fail):
            result = asyncio.run(main({'url': 'https://example.com/product'}))
        self.assertEqual(result['code'], 'PAGE_CHANGED')
        self.assertNotIn('markdown', result)
        self.assertEqual(result['report']['characters'], 0)


if __name__ == '__main__':
    unittest.main()
