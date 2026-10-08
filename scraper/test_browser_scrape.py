import unittest
from browser_scrape import same_page, markdown_sections


class ExtractionChecks(unittest.TestCase):
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


if __name__ == '__main__':
    unittest.main()
