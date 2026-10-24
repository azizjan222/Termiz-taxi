"""Tests for Surxondaryo tumanlararo corridor matching."""

from app.services.corridor import match_corridor_order


def test_corridor_match_south_to_north():
    # Driver going Termiz -> Sariosiyo (0 -> 5)
    assert match_corridor_order("Termiz", "Sariosiyo", "Termiz", "Sariosiyo") == "exact"
    assert match_corridor_order("Termiz", "Sariosiyo", "Termiz", "Denov") == "transit"
    assert match_corridor_order("Termiz", "Sariosiyo", "Qumqo'rg'on", "Sho'rchi") == "transit"
    assert match_corridor_order("Termiz", "Sariosiyo", "Sariosiyo", "Termiz") is None
    assert match_corridor_order("Termiz", "Denov", "Termiz", "Sariosiyo") is None


def test_corridor_match_north_to_south():
    # Driver going Sariosiyo -> Termiz (5 -> 0)
    assert match_corridor_order("Sariosiyo", "Termiz", "Sariosiyo", "Termiz") == "exact"
    assert match_corridor_order("Sariosiyo", "Termiz", "Denov", "Termiz") == "transit"
    assert match_corridor_order("Sariosiyo", "Termiz", "Denov", "Qumqo'rg'on") == "transit"
    assert match_corridor_order("Sariosiyo", "Termiz", "Termiz", "Denov") is None
