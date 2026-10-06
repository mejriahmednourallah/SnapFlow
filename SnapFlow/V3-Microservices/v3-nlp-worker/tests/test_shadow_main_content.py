import main as nlp


def test_shadow_content_is_retained_beside_rich_main():
    main = " ".join(f"Main article paragraph {i}." for i in range(35))
    html = f"<main>{main}</main><section data-snapflow-shadow-text='true'>You can request erasure of your personal data.</section>"
    text, source, _metadata = nlp.extract_text_main_content_first(html)
    assert source.startswith("main_candidate:")
    assert "request erasure" in text
    assert text.count("request erasure") == 1


def test_shadow_already_in_main_is_not_duplicated():
    main = " ".join(f"Main article paragraph {i}." for i in range(35))
    html = f"<main>{main}<section data-snapflow-shadow-text='true'>Shadow topic evidence.</section></main>"
    text, _source, _metadata = nlp.extract_text_main_content_first(html)
    assert text.count("Shadow topic evidence.") == 1
