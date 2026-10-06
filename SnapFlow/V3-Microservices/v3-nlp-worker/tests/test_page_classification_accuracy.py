"""Source-authored purpose labels against the real worker classifier."""
import importlib.util
from pathlib import Path
import sys

from bs4 import BeautifulSoup
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('classification_worker', ROOT/'main.py')
nlp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nlp)


@pytest.mark.parametrize('route,title,body,expected', [
    ('/', 'Banque BIAT Tunisie', '<main><h1>Un groupe financier</h1><p>Services bancaires.</p><form>Nous contacter</form></main>', 'landing'),
    ('/fr/', 'Agence digitale', '<main><h1>Solutions digitales</h1><h2>Pourquoi nous choisir?</h2><h2>Comment démarrer?</h2><h2>Quels résultats?</h2></main>', 'landing'),
    ('/en/', 'Service', '<main>Our business</main><footer><form>contact support</form></footer>', 'landing'),
    ('/contact', 'Notre équipe', '<main><h1>Nous contacter</h1><form><textarea name="message"></textarea></form></main>', 'contact'),
    ('/article/projet', 'Notre dernier projet', '<main><article><h1>Un projet nouveau</h1><time datetime="2026-09-20">20 septembre</time></article></main>', 'news'),
    ('/services', 'Nos services', '<main><h1>Nos services</h1><p>Catégorie: conseil, publié par notre équipe.</p></main><footer><form>Contact</form></footer>', 'other'),
    ('/services?next=/contact', 'Services', '<main><h1>Nos services</h1></main>', 'other'),
    ('/faq', 'Assistance', '<main><h1>Réponses</h1></main>', 'faq'),
    ('/questions-mise-en-page', 'Guide', '<main><h1>Questions de mise en page</h1><h2>Comment démarrer?</h2><p>Avec un guide.</p></main>', 'other'),
    ('/products/item', 'Article commercial', '<main><h1>Table de bureau</h1></main>', 'product'),
    ('/', '404 Page not found', '<main><h1>Page not found</h1></main>', 'error'),
])
def test_primary_page_purpose(route, title, body, expected):
    soup = BeautifulSoup('<html><body>'+body+'</body></html>', 'html.parser')
    assert nlp.classify_page_type('https://contact-product.test'+route, title, soup.get_text(' ', strip=True), soup=soup) == expected


def test_homepage_news_cards_do_not_declare_page_as_article():
    soup = BeautifulSoup('''<script type="application/ld+json">{"@type":"ItemList","itemListElement":[{"@type":"NewsArticle","url":"https://example.test/news/one"}]}</script><main>Our services</main>''', 'html.parser')
    assert nlp.classify_page_type('https://example.test/', 'Our company', 'Our services', soup=soup, schema_types=['ItemList','NewsArticle']) == 'landing'


def test_graph_article_identity_must_belong_to_current_page():
    soup = BeautifulSoup('''<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","@id":"https://example.test/news/one#article"},{"@type":"WebPage","@id":"https://example.test/#webpage"}]}</script><main>Our services</main>''', 'html.parser')
    assert nlp.classify_page_type('https://example.test/', 'Our company', 'Our services', soup=soup) == 'landing'
    assert nlp.classify_page_type('https://example.test/news/one', 'Project results', 'Project story', soup=soup) == 'news'


def test_explicit_current_page_schema_survives_homepage_precedence():
    soup = BeautifulSoup('''<script type="application/ld+json">{"@type":"FAQPage","@id":"https://example.test/#faq"}</script><main>Questions fréquentes</main>''', 'html.parser')
    assert nlp.classify_page_type('https://example.test/', 'Help', 'Questions fréquentes', soup=soup) == 'faq'
