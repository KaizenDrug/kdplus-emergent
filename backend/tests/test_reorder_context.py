"""Pure unit tests for conservative same-generic reorder indicators."""
from reorder_context import match_key


def test_normalizes_common_catalog_spacing_and_forms():
    a = {"generic_name": "Azithromycin", "strength": "500 mg", "dosage_form": "TAB"}
    b = {"generic_name": "azithromycin", "strength": "500MG", "dosage_form": "tablets"}
    assert match_key(a) == match_key(b)


def test_does_not_match_different_strength_or_form():
    base = {"generic_name": "Azithromycin", "strength": "500mg", "dosage_form": "tablet"}
    assert match_key(base) != match_key({**base, "strength": "250mg"})
    assert match_key(base) != match_key({**base, "dosage_form": "suspension"})


def test_requires_complete_structured_fields_and_excludes_promos():
    base = {"generic_name": "Azithromycin", "strength": "500mg", "dosage_form": "tablet"}
    for field in ("generic_name", "strength", "dosage_form"):
        assert match_key({**base, field: ""}) is None
    assert match_key({**base, "product_type": "PROMO"}) is None


def test_preserves_combination_identity():
    a = {"generic_name": "Amoxicillin + Clavulanic acid", "strength": "500mg/125mg", "dosage_form": "tablet"}
    b = {"generic_name": "Amoxicillin/Clavulanic acid", "strength": "500mg/125mg", "dosage_form": "tablet"}
    assert match_key(a) != match_key(b)  # Ambiguous separators are not auto-equated.
