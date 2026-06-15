import pytest

from semantic_observation import (
    build_semantic_signature,
    classify_message_evidence,
    compare_semantic_signatures,
    reference_quality,
)


def classify(text: str, **overrides):
    return classify_message_evidence(
        [
            {
                "text": text,
                "selector": ".form-message",
                "role": "alert",
                "is_new": True,
                **overrides,
            }
        ]
    )


def test_mae_consent_copy_is_never_a_success():
    result = classify(
        "En validant votre demande, vous confirmez avoir pris connaissance "
        "de notre politique de protection des données."
    )

    assert result["consent_legal_messages"]
    assert not result["success_messages"]


def test_french_application_validation_is_detected():
    result = classify("L'adresse de courriel adresse-invalide n'est pas valide.")

    assert result["validation_messages"]
    assert "invalid_format" in result["validation_messages"][0]["concepts"]
    assert result["validation_messages"][0]["language"] == "fr"


def test_french_explicit_confirmation_is_detected():
    result = classify(
        "Votre demande a bien été envoyée. Nous allons vous contacter rapidement.",
        role="status",
        selector=".messages--status",
    )

    assert result["success_messages"]
    assert "submission_accepted" in result["success_messages"][0]["concepts"]


@pytest.mark.parametrize(
    "message",
    [
        "Votre message nous est bien parvenu.",
        "Nous accusons réception de votre demande.",
        "Votre dossier a été enregistré sous le numéro 4582.",
        "Soumission effectuée avec succès.",
        "Un courriel de confirmation vous sera envoyé.",
        "Votre compte a été créé.",
        "Merci pour votre demande, nous vous contacterons prochainement.",
    ],
)
def test_french_success_vocabulary_requires_explicit_business_outcome(message):
    result = classify(message, role="status", selector=".messages--status")

    assert result["success_messages"], message
    assert not result["validation_messages"], message
    assert not result["consent_legal_messages"], message


@pytest.mark.parametrize(
    "message",
    [
        "Ce champ ne peut pas être vide.",
        "Merci de renseigner votre numéro de téléphone.",
        "La saisie est incorrecte.",
        "Cette adresse électronique est invalide.",
        "La valeur ne respecte pas le format attendu.",
        "Le mot de passe doit contenir au moins 8 caractères.",
        "Cette extension de fichier n'est pas autorisée.",
        "Veuillez cocher la case de consentement.",
        "Le consentement est obligatoire.",
    ],
)
def test_french_validation_vocabulary_covers_common_form_messages(message):
    result = classify(message, role="alert", selector=".form-item--error-message")

    assert result["validation_messages"], message
    assert not result["success_messages"], message


@pytest.mark.parametrize(
    "message",
    [
        "Vos identifiants sont incorrects.",
        "Votre compte est verrouillé.",
        "Cette adresse est déjà inscrite.",
        "Le créneau sélectionné est indisponible.",
        "Votre paiement a été refusé.",
        "Nous ne pouvons pas traiter cette demande.",
        "L'utilisateur est introuvable.",
        "La réservation n'est plus disponible.",
    ],
)
def test_french_business_rejection_vocabulary(message):
    result = classify(message, role="alert", selector=".message-error")

    assert result["rejection_messages"], message
    assert not result["success_messages"], message


@pytest.mark.parametrize(
    "message",
    [
        "Une erreur technique est survenue.",
        "Le service est temporairement indisponible.",
        "La connexion avec le serveur est impossible.",
        "Le délai d'attente est dépassé.",
        "Veuillez réessayer plus tard.",
    ],
)
def test_french_technical_error_vocabulary(message):
    result = classify(message, role="alert", selector=".technical-error")

    assert result["technical_error_messages"], message
    assert not result["success_messages"], message


@pytest.mark.parametrize(
    "message",
    [
        "J'ai lu et j'accepte les conditions.",
        "Vous confirmez avoir pris connaissance de la politique de confidentialité.",
        "En validant votre demande, vous acceptez le traitement des données.",
        "J'autorise le traitement de mes données.",
    ],
)
def test_french_legal_consent_copy_is_excluded_from_success(message):
    result = classify(message)

    assert result["consent_legal_messages"], message
    assert not result["success_messages"], message


def test_french_required_consent_is_a_validation_not_static_legal_copy():
    result = classify(
        "Veuillez accepter les conditions pour poursuivre.",
        role="alert",
        selector=".form-item--error-message",
    )

    assert result["validation_messages"]
    assert not result["consent_legal_messages"]


def test_english_confirmation_and_validation_are_distinct():
    success = classify("Your request was successfully sent. We received your message.")
    validation = classify("Please fill in this required email field.")

    assert success["success_messages"]
    assert success["success_messages"][0]["language"] == "en"
    assert validation["validation_messages"]
    assert validation["validation_messages"][0]["language"] == "en"


def test_arabic_confirmation_and_validation_are_detected():
    success = classify("تم إرسال الطلب بنجاح، سنتصل بكم قريبا.")
    validation = classify("يرجى إدخال الحقل المطلوب قبل إرسال الطلب.")

    assert success["success_messages"]
    assert success["success_messages"][0]["language"] == "ar"
    assert validation["validation_messages"]
    assert validation["validation_messages"][0]["language"] == "ar"


def test_negated_positive_phrases_are_rejections_not_successes():
    french = classify("Votre demande n'a pas été envoyée.")
    english = classify("Your request could not be successfully submitted.")
    arabic = classify("لم يتم إرسال الطلب.")

    for result in (french, english, arabic):
        assert result["rejection_messages"]
        assert not result["success_messages"]


def test_preexisting_message_is_ignored():
    result = classify_message_evidence(
        [
            {
                "text": "Votre demande a bien été envoyée.",
                "selector": ".messages--status",
                "role": "status",
                "is_new": False,
                "is_changed": False,
            }
        ]
    )

    assert not result["success_messages"]
    assert not result["validation_messages"]
    assert not result["rejection_messages"]


def test_validation_and_success_are_both_preserved_for_business_precedence():
    result = classify_message_evidence(
        [
            {
                "text": "Votre demande a bien été envoyée.",
                "selector": ".messages--status",
                "role": "status",
                "is_new": True,
            },
            {
                "text": "Le champ email est obligatoire.",
                "selector": ".form-item--error-message",
                "role": "alert",
                "is_new": True,
            },
        ]
    )

    assert result["success_messages"]
    assert result["validation_messages"]


def test_reference_quality_prefers_explicit_confirmation():
    result = reference_quality(
        execution_status="passed",
        submission={
            "response_status": 200,
            "dom_changed": True,
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [
                    {"text": "Demande reçue", "concepts": ["submission_accepted"]}
                ],
                "validation_messages": [],
                "rejection_messages": [],
            },
        },
        oracle={"score": 1.0},
    )

    assert result["score"] >= 0.65
    assert result["conclusive"] is True


def test_semantic_comparison_requires_matching_success_concepts():
    reference = build_semantic_signature(
        {
            "response_status": 200,
            "final_url": "https://example.com/contact",
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [{"concepts": ["submission_accepted"]}],
            },
        }
    )
    accepted = compare_semantic_signatures(
        {
            "response_status": 200,
            "final_url": "https://example.com/contact",
            "semantic_dom": {
                "form_lifecycle": "replaced",
                "success_messages": [{"concepts": ["submission_accepted"]}],
            },
        },
        reference,
    )
    rejected = compare_semantic_signatures(
        {
            "response_status": 200,
            "final_url": "https://example.com/contact",
            "semantic_dom": {
                "form_lifecycle": "retained",
                "validation_messages": [{"concepts": ["required_field"]}],
            },
        },
        reference,
    )

    assert accepted["similarity_score"] >= 0.7
    assert rejected["similarity_score"] < 0.7
