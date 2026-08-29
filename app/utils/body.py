"""Request-body parsing shared by the JSON API handlers.

Every mutating endpoint needs the same two guards: the payload must be parseable, and it
must be a JSON *object*. The second one kept being forgotten. `await request.json()`
happily returns an int, string or list for bodies like `5`, `"x"` or `[1]`, and the very
next line is always a `data.get(...)` — which raises AttributeError on those types and
surfaces as a 500 with a stack trace instead of a 400. `ratings.py` and `sos.py` had
grown the check by hand; the rest had not.

Field readers live here too, because `(data.get("x") or "").strip()` — the pattern used
throughout — still raises AttributeError when the client sends a non-string such as
`{"label": 5}` or `{"first_name": {}}`.
"""
from aiohttp import web


class BodyError(Exception):
    """Raised by the readers below; carries the 400 response to return."""

    def __init__(self, response: web.Response):
        super().__init__("invalid request body")
        self.response = response


async def read_json_object(request: web.Request) -> dict:
    """Parse the body as a JSON object, or raise :class:`BodyError` with a 400.

    Usage::

        try:
            data = await read_json_object(request)
        except BodyError as e:
            return e.response
    """
    try:
        data = await request.json()
    except Exception:
        raise BodyError(
            web.json_response({"error": "Invalid JSON"}, status=400)
        ) from None
    if not isinstance(data, dict):
        raise BodyError(
            web.json_response({"error": "Invalid JSON"}, status=400)
        )
    return data


def read_str(
    data: dict,
    key: str,
    *,
    max_length: int | None = None,
    required: bool = False,
    default: str = "",
) -> str:
    """Read ``key`` as a trimmed string.

    A non-string value (number, list, object, bool) is rejected with a 400 rather than
    crashing on ``.strip()`` / ``[:n]``. ``None`` and a missing key both yield ``default``.
    """
    value = data.get(key)
    if value is None:
        if required:
            raise BodyError(
                web.json_response({"error": f"{key} kerak"}, status=400)
            )
        return default
    if not isinstance(value, str):
        raise BodyError(
            web.json_response({"error": f"{key} matn bo'lishi kerak"}, status=400)
        )
    value = value.strip()
    if required and not value:
        raise BodyError(
            web.json_response({"error": f"{key} kerak"}, status=400)
        )
    if max_length is not None:
        value = value[:max_length]
    return value


def read_float(
    data: dict,
    key: str,
    *,
    required: bool = False,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    """Read ``key`` as a float within an optional range, or None when absent.

    Booleans are rejected explicitly: ``isinstance(True, int)`` is True in Python, so a
    plain numeric check would silently accept ``{"latitude": true}`` as 1.0.
    """
    value = data.get(key)
    if value is None or value == "":
        if required:
            raise BodyError(
                web.json_response({"error": f"{key} kerak"}, status=400)
            )
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise BodyError(
            web.json_response({"error": f"{key} son bo'lishi kerak"}, status=400)
        )
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise BodyError(
            web.json_response({"error": f"{key} son bo'lishi kerak"}, status=400)
        ) from None
    # NaN/Infinity round-trip through JSON in Python but poison every comparison and
    # distance calculation downstream, and Postgres rejects them on insert.
    if number != number or number in (float("inf"), float("-inf")):
        raise BodyError(
            web.json_response({"error": f"{key} son bo'lishi kerak"}, status=400)
        )
    if minimum is not None and number < minimum:
        raise BodyError(
            web.json_response({"error": f"{key} noto'g'ri"}, status=400)
        )
    if maximum is not None and number > maximum:
        raise BodyError(
            web.json_response({"error": f"{key} noto'g'ri"}, status=400)
        )
    return number


def read_int(
    data: dict,
    key: str,
    *,
    default: int = 0,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """Read ``key`` as an int within an optional range."""
    value = data.get(key)
    if value is None or value == "":
        number = default
    elif isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise BodyError(
            web.json_response({"error": f"{key} son bo'lishi kerak"}, status=400)
        )
    else:
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            raise BodyError(
                web.json_response({"error": f"{key} son bo'lishi kerak"}, status=400)
            ) from None
    if minimum is not None and number < minimum:
        raise BodyError(
            web.json_response({"error": f"{key} noto'g'ri"}, status=400)
        )
    if maximum is not None and number > maximum:
        raise BodyError(
            web.json_response({"error": f"{key} noto'g'ri"}, status=400)
        )
    return number
