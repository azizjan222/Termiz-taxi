"""Price wording in notifications.

``price = 0`` is how the app encodes "to be agreed": parcel orders are created that way on
purpose, because the sender and the driver settle the fee themselves. Rendering it
literally produced a push notification reading "Pochta 📦 · 0 so'm", which a driver reads
as a free delivery.
"""
from app.services.notify_i18n import LANGS, new_order, price_text

NEGOTIABLE = {
    "uz": "Kelishiladi",
    "uz-cyrl": "Келишилади",
    "ru": "Договорная",
    "en": "Negotiable",
}


class TestPriceText:
    def test_zero_is_negotiable_in_every_language(self):
        for lang in LANGS:
            assert price_text(lang, 0) == NEGOTIABLE[lang]

    def test_missing_price_is_negotiable(self):
        # The column is nullable, so None must behave like 0 rather than crash.
        assert price_text("uz", None) == "Kelishiladi"

    def test_real_amount_is_formatted_with_currency(self):
        assert price_text("uz", 45000) == "45 000 so'm"
        assert price_text("ru", 45000) == "45 000 сум"

    def test_amount_never_renders_as_negotiable(self):
        for lang in LANGS:
            assert NEGOTIABLE[lang] not in price_text(lang, 10000)

    def test_unknown_language_falls_back_to_uzbek(self):
        assert price_text("de", 0) == "Kelishiladi"

    def test_thousands_are_separated_by_spaces(self):
        # Commas would read as decimals for an amount in so'm.
        assert price_text("uz", 1250000).startswith("1 250 000")
        assert "," not in price_text("uz", 1250000)


class TestNewOrderBody:
    def _body(self, lang, **kw):
        kw.setdefault("service_type", "parcel")
        kw.setdefault("from_city", "Sariosiyo")
        kw.setdefault("to_city", "Termiz")
        kw.setdefault("subject_str", "Pochta")
        return new_order(lang, **kw)[1]

    def test_parcel_without_price_says_negotiable(self):
        body = self._body("uz", price=0)
        assert "Kelishiladi" in body
        assert "0 so'm" not in body

    def test_no_language_leaks_a_zero_amount(self):
        for lang in LANGS:
            assert "0 " not in self._body(lang, price=0)

    def test_priced_order_shows_the_amount(self):
        body = self._body("uz", service_type="taxi", subject_str="3 kishi", price=45000)
        assert "45 000 so'm" in body
        assert "Kelishiladi" not in body

    def test_body_keeps_route_and_subject(self):
        body = self._body("uz", price=0)
        assert "Sariosiyo" in body and "Termiz" in body and "Pochta" in body

    def test_title_differs_between_parcel_and_ride(self):
        parcel = new_order("uz", service_type="parcel", from_city="A", to_city="B",
                           subject_str="Pochta", price=0)[0]
        ride = new_order("uz", service_type="taxi", from_city="A", to_city="B",
                         subject_str="3 kishi", price=1000)[0]
        assert parcel != ride


class TestSingleSourceOfTruth:
    """The rule lives in price_text() only.

    Before this, the "0 means to be agreed" check was copy-pasted per call site, and the
    copies drifted: app/api/drivers.py guarded it, app/bot/handlers/orders.py guarded it in
    one message and not in the neighbouring one, and the push notification did not guard it
    at all. Everything now routes through price_text.
    """

    def test_bot_and_admin_channels_agree_with_push(self):
        # The bot and admin listings render Uzbek, so they must match the uz rendering.
        assert price_text("uz", 0) == "Kelishiladi"
        assert price_text("uz", 45000) == "45 000 so'm"

    def test_no_duplicate_implementation_remains(self):
        import pathlib
        root = pathlib.Path(__file__).resolve().parent.parent
        offenders = []
        for path in [
            "app/admin_commands.py",
            "app/bot/handlers/orders.py",
            "app/services/push.py",
        ]:
            text = (root / path).read_text(encoding="utf-8")
            # A literal fallback string outside notify_i18n means the rule was re-inlined.
            if '"Kelishiladi"' in text or "'Kelishiladi'" in text:
                offenders.append(path)
        assert not offenders, f"price rule re-implemented in: {offenders}"
