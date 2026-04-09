"""Importers for various corpus formats."""
from .conllu import import_conllu
from .docx_numbered_lines import import_docx_numbered_lines

__all__ = ["import_docx_numbered_lines", "import_conllu"]
