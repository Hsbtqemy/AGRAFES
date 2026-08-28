"""La sonde d'import distant : lire un dossier WebDAV sans rien écrire (SD-01).

La couche WebDAV (propfind/download) est simulée ; le parse tourne pour de vrai sur
de vrais fichiers, puisque c'est précisément ce que la sonde doit rendre fidèlement —
elle appelle le **même** ``preview_text_units`` que ``/import/preview``.

Aucune base n'apparaît ici, et c'est le premier fait à vérifier : ``probe_remote_folder``
ne prend pas de connexion. C'est structurel, pas une politesse.
"""

from __future__ import annotations

import io
from pathlib import Path
from unittest import mock

from multicorpus_engine.remote import probe, webdav

_BASE = "https://dav.example/folder/"


def _make_docx_bytes(paragraphs: list[str]) -> bytes:
    import docx

    d = docx.Document()
    for p in paragraphs:
        d.add_paragraph(p)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def _entry(name: str, size: int = 1000, is_dir: bool = False) -> webdav.RemoteEntry:
    return webdav.RemoteEntry(
        name=name, href=_BASE + name, is_dir=is_dir,
        size=size, modified=None, content_type=None,
    )


def _download_from(payloads, telecharges=None, pics=None):
    """Simule ``webdav.download``, en notant ce qui a été demandé.

    *telecharges* recueille les URL réellement téléchargées — c'est ainsi qu'on prouve
    qu'un fichier a été **ignoré sans être rapatrié**. *pics* enregistre le nombre de
    fichiers présents dans le temporaire au moment de chaque appel.
    """
    def _fake(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        if telecharges is not None:
            telecharges.append(url)
        if pics is not None:
            pics.append(len(list(Path(dest_path).parent.iterdir())))
        data = payloads[url]
        if max_bytes is not None and len(data) > max_bytes:
            raise webdav.WebdavTooLarge(url)
        Path(dest_path).write_bytes(data)
        return len(data)
    return _fake


def _run(entries, payloads, telecharges=None, pics=None, **kwargs):
    fake = _download_from(payloads, telecharges=telecharges, pics=pics)
    with mock.patch.object(webdav, "propfind", return_value=entries), \
         mock.patch.object(webdav, "download", fake):
        return probe.probe_remote_folder(url=_BASE, auth_header={}, **kwargs)


# ── Ce que la sonde lit, et dans quel mode ──────────────────────────────────

def test_chaque_extension_est_lue_dans_son_mode_de_sonde() -> None:
    """Le mode de LECTURE, pas le mode d'import — miroir de `_analyzeFile` côté front."""
    payloads = {
        _BASE + "a.docx": _make_docx_bytes(["Bonjour.", "Le monde."]),
        _BASE + "b.txt": b"[1] Une ligne.\n[2] Une autre.\n",
    }
    rapport = _run([_entry("a.docx"), _entry("b.txt")], payloads)

    par_nom = {f["name"]: f for f in rapport["files"]}
    assert par_nom["a.docx"]["mode"] == "docx_paragraphs"
    assert par_nom["b.txt"]["mode"] == "txt_numbered_lines"
    assert rapport["probed"] == 2
    assert rapport["errors"] == 0


def test_tei_et_conllu_ne_sont_jamais_telecharges() -> None:
    """Ces formats se décrivent eux-mêmes : rien à déduire, donc rien à rapatrier.

    C'est la moitié de l'économie du lot — et une promesse qu'un simple statut ne
    prouverait pas : on vérifie qu'aucun octet n'a été demandé.
    """
    telecharges: list[str] = []
    payloads = {_BASE + "a.txt": b"[1] Une ligne.\n"}
    rapport = _run(
        [_entry("roman.xml"), _entry("corpus.conllu"), _entry("a.txt")],
        payloads, telecharges=telecharges,
    )

    assert telecharges == [_BASE + "a.txt"]
    par_nom = {f["name"]: f for f in rapport["files"]}
    assert par_nom["roman.xml"]["status"] == "skipped-no-probe"
    assert par_nom["corpus.conllu"]["status"] == "skipped-no-probe"
    assert par_nom["roman.xml"]["mode"] is None
    assert rapport["skipped_no_probe"] == 2
    assert rapport["probed"] == 1


def test_la_forme_rendue_est_celle_de_import_preview() -> None:
    """L'écran rejoue sa déduction dessus sans branche distante : mêmes clés."""
    payloads = {_BASE + "a.txt": b"[1] Une ligne.\n[2] Une autre.\n[3] Une troisieme.\n"}
    rapport = _run([_entry("a.txt")], payloads)
    fichier = rapport["files"][0]

    for cle in ("units", "units_total", "units_line", "units_structure", "truncated", "tables"):
        assert cle in fichier, f"cle manquante : {cle}"
    assert fichier["units_total"] == 3
    assert fichier["units_line"] == 3
    assert fichier["units_structure"] == 0
    assert fichier["truncated"] is False
    assert [u["external_id"] for u in fichier["units"]] == [1, 2, 3]


def test_limit_borne_l_echantillon_sans_fausser_les_comptes() -> None:
    """C'est ce qui permet de déduire sans rapatrier le document entier."""
    corps = "".join(f"[{i}] Ligne {i}.\n" for i in range(1, 21)).encode("utf-8")
    rapport = _run([_entry("long.txt")], {_BASE + "long.txt": corps}, limit=4)
    fichier = rapport["files"][0]

    assert len(fichier["units"]) == 4
    assert fichier["units_total"] == 20
    assert fichier["units_line"] == 20      # le compte porte sur TOUT le fichier
    assert fichier["truncated"] is True


# ── Ce qui ne doit jamais interrompre le lot ────────────────────────────────

def test_un_fichier_illisible_n_interrompt_pas_le_lot() -> None:
    payloads = {
        _BASE + "casse.docx": b"ceci n est pas un docx",
        _BASE + "bon.txt": b"[1] Une ligne.\n",
    }
    rapport = _run([_entry("casse.docx"), _entry("bon.txt")], payloads)

    par_nom = {f["name"]: f for f in rapport["files"]}
    assert par_nom["casse.docx"]["status"] == "error"
    assert par_nom["casse.docx"]["error"]
    assert par_nom["bon.txt"]["status"] == "probed"
    assert rapport["errors"] == 1
    assert rapport["probed"] == 1


def test_une_erreur_reseau_par_fichier_est_un_statut_pas_une_exception() -> None:
    def _fake(url, dest_path, *, auth_header, max_bytes=None, timeout=30):
        raise webdav.WebdavError("502 upstream")

    with mock.patch.object(webdav, "propfind", return_value=[_entry("a.txt")]), \
         mock.patch.object(webdav, "download", _fake):
        rapport = probe.probe_remote_folder(url=_BASE, auth_header={})

    assert rapport["files"][0]["status"] == "error"
    assert "502" in rapport["files"][0]["error"]


def test_un_fichier_trop_gros_n_est_pas_telecharge() -> None:
    telecharges: list[str] = []
    rapport = _run(
        [_entry("enorme.txt", size=5_000_000)], {}, telecharges=telecharges,
        max_file_mb=1.0,
    )
    assert telecharges == []
    assert rapport["files"][0]["status"] == "skipped-oversize"
    assert rapport["skipped_oversize"] == 1


# ── Les gardes ──────────────────────────────────────────────────────────────

def test_un_href_non_liste_par_le_serveur_n_est_jamais_rapatrie() -> None:
    """La garde anti-SSRF de `propfind` ne se contourne pas par la selection."""
    telecharges: list[str] = []
    payloads = {_BASE + "a.txt": b"[1] Une ligne.\n"}
    rapport = _run(
        [_entry("a.txt")], payloads, telecharges=telecharges,
        only_hrefs={_BASE + "a.txt", "https://ailleurs.example/secret.txt"},
    )
    assert telecharges == [_BASE + "a.txt"]
    assert rapport["total"] == 1


def test_le_glob_include_restreint_la_sonde() -> None:
    payloads = {_BASE + "a.txt": b"[1] Une ligne.\n"}
    rapport = _run([_entry("a.txt"), _entry("b.docx")], payloads, include="*.txt")
    assert rapport["total"] == 1
    assert rapport["files"][0]["name"] == "a.txt"


def test_les_dossiers_sont_ignores() -> None:
    payloads = {_BASE + "a.txt": b"[1] Une ligne.\n"}
    rapport = _run([_entry("sous-dossier", is_dir=True), _entry("a.txt")], payloads)
    assert rapport["total"] == 1


def test_le_temporaire_ne_garde_qu_un_fichier_a_la_fois() -> None:
    """L'occupation disque reste celle d'UN fichier, pas celle du lot (SID-15).

    Sans le ``unlink`` par tour, le temporaire enflerait jusqu'a la taille du dossier —
    invisible sur un lot de trois fichiers, couteux sur quarante-quatre.
    """
    pics: list[int] = []
    payloads = {_BASE + f"f{i}.txt": b"[1] Une ligne.\n" for i in range(4)}
    _run([_entry(f"f{i}.txt") for i in range(4)], payloads, pics=pics)
    # Le compte est pris APRES le mkstemp du fichier courant : 1 = rien n'a survecu au
    # tour precedent.
    assert pics == [1, 1, 1, 1]


def test_un_dossier_vide_rend_un_rapport_vide_sans_echouer() -> None:
    rapport = _run([], {})
    assert rapport["total"] == 0
    assert rapport["files"] == []
    assert rapport["probed"] == 0
