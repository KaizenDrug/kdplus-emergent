"""Conservative catalog matching for reorder decision support.

A match is an inventory clue, NOT an automatic therapeutic substitution.
Missing catalog fields never produce a match.
"""
import re


FORM_ALIASES = {
    "tab": "tablet", "tabs": "tablet", "tablets": "tablet",
    "cap": "capsule", "caps": "capsule", "capsules": "capsule",
    "syr": "syrup", "syrups": "syrup",
    "susp": "suspension", "suspensions": "suspension",
    "soln": "solution", "sol": "solution",
}


def _normalized(value):
    return " ".join(str(value or "").strip().casefold().split())


def match_key(product):
    """Require exact generic, strength and dosage form after conservative cleanup.

    Formulation/release, route and pack differences may still require review.
    Do not use this key to merge stock or automatically substitute products.
    """
    if product.get("product_type", "REGULAR") != "REGULAR":
        return None
    generic = re.sub(r"\s*([+/])\s*", r"\1", _normalized(product.get("generic_name")))
    strength = re.sub(r"\s+", "", _normalized(product.get("strength")))
    form = _normalized(product.get("dosage_form"))
    form = FORM_ALIASES.get(form, form)
    if not generic or not strength or not form:
        return None
    return generic, strength, form
