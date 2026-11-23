from app.reports import parse_number, parse_report

REPORT = """---
id: dorpsstraat-12-utrecht
adres: Dorpsstraat 12
plaats: Utrecht
vraagprijs: € 450.000 k.k.
woonoppervlakte: 120 m²
energielabel: Label A++
erfpacht: false
---
# Dorpsstraat 12, Utrecht

**Bouwjaar:** 1932
- Perceel: 210 m²
| Slaapkamers | 3 |

## Pluspunten
- Veel licht
- Rustige straat

## Minpunten
- Fundering onbekend
"""


def test_front_matter_and_body():
    house_id, fields, body = parse_report("x.md", REPORT.encode())
    assert house_id == "dorpsstraat-12-utrecht"
    assert fields["vraagprijs"] == 450000
    assert fields["woonoppervlakte"] == 120
    assert fields["energielabel"] == "A++"
    assert fields["erfpacht"] == "Eigen grond"
    assert "extra" not in fields
    assert fields["bouwjaar"] == 1932
    assert fields["perceel"] == 210
    assert fields["slaapkamers"] == 3
    assert fields["pluspunten"] == ["Veel licht", "Rustige straat"]
    assert fields["minpunten"] == ["Fundering onbekend"]
    assert body.startswith("# Dorpsstraat 12")


def test_without_front_matter_uses_file_name_and_heading():
    house_id, fields, _ = parse_report("huizen/Kerkweg 3.md", b"# Kerkweg 3\nVraagprijs: 1,2 mln\n")
    assert house_id == "kerkweg-3"
    assert fields["adres"] == "Kerkweg 3"
    assert fields["vraagprijs"] == 1200000


def test_json_report():
    house_id, fields, body = parse_report(
        "a.json", b'{"adres": "Laan 1", "prijs": "395000", "rapport": "Mooi"}'
    )
    assert house_id == "a"
    assert fields["vraagprijs"] == 395000
    assert body == "Mooi"


def test_numbers():
    assert parse_number("7,5/10") == 7.5
    assert parse_number("€ 450k") == 450000
    assert parse_number("geen") is None
