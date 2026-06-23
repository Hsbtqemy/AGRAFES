"""Unit tests for the shared XML 1.0 text helpers."""

from multicorpus_engine.xml_text import strip_xml10_invalid, xml_escape


def test_strip_keeps_plain_text_and_whitespace():
    assert strip_xml10_invalid("abc") == "abc"
    # tab / LF / CR are the only control chars permitted in XML 1.0
    assert strip_xml10_invalid("a\tb\nc\rd") == "a\tb\nc\rd"


def test_strip_keeps_high_unicode():
    accent = chr(0x00E9)  # é
    cjk = chr(0x6F22)     # 漢
    emoji = chr(0x1F600)  # astral plane
    fffd = chr(0xFFFD)    # replacement char — last valid before the 0xFFFE/0xFFFF gap
    s = accent + cjk + emoji + fffd
    assert strip_xml10_invalid(s) == s


def test_strip_removes_control_and_noncharacters():
    assert strip_xml10_invalid("a" + chr(0x00) + "b" + chr(0x07) + chr(0x1F) + "c") == "abc"
    # 0xFFFE / 0xFFFF are not valid XML chars
    assert strip_xml10_invalid("x" + chr(0xFFFE) + chr(0xFFFF) + "y") == "xy"


def test_strip_empty():
    assert strip_xml10_invalid("") == ""


def test_xml_escape_all_specials():
    assert xml_escape("a&b") == "a&amp;b"
    assert xml_escape("a<b>c") == "a&lt;b&gt;c"
    assert xml_escape('say "hi"') == "say &quot;hi&quot;"
    assert xml_escape("don't") == "don&apos;t"


def test_xml_escape_strips_then_escapes():
    assert xml_escape("x" + chr(0x00) + "<y>") == "x&lt;y&gt;"
