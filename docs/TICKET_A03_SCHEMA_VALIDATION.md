# TICKET — A-03 : validateur de schéma pour les entrées du sidecar

> Cadrage (gelé avant ouverture). Audit A-03 (🟠 P0-1) : **66 blocs de validation
> manuelle** dans le sidecar, sans validateur de schéma. Objectif : un validateur
> déclaratif unique remplaçant les `if not isinstance(...): raise ValidationError(...)`
> ad hoc, **sans changer le comportement wire** (codes d'erreur byte-identiques).

## 1. État des lieux (vérifié au code, 2026-06-21)

- Validation **manuelle, éparpillée, dupliquée** dans `sidecar.py` (handlers) **et** `services/*.py`, via **deux mécanismes distincts** (vérifié) :
  - **services** : `raise ValidationError` (**22**) + 47 autres `raise BadRequestError/NotFoundError/ConflictError` ;
  - **sidecar.py** : **0 `raise ValidationError`** — les handlers valident *inline* puis `return` via `self._send_error(msg, code=ERR_VALIDATION|ERR_BAD_REQUEST, http_status=400)` (291 appels `_send_error` ; `ERR_VALIDATION|ERR_BAD_REQUEST` 241×).
  → **~92 *sites* de validation** au total (umbrella des deux mécanismes — **pas** 92 `raise`). `isinstance(...)` : **106** dans `sidecar.py` (+14 services = 120) ; ~63 checks « required/missing » (dont 35 `is required` côté sidecar). **Aucun helper de validation** (seul `_require_token_for_write` ; `_send_error` est de l'*émission*, `_ensure_*` du schéma DB).
- Patterns types — **service** : `if not isinstance(body.get("x"), str): raise ValidationError("x is required")` ; **handler sidecar** : `if not isinstance(x, str): self._send_error("x is required", code=ERR_BAD_REQUEST, http_status=400); return`. Plus checks d'enum (`status not in STATUSES`), coercition int (`int(doc_id_raw)`), bornes.
- Les erreurs typées existent déjà (A-01) : `services/errors.py` → `ValidationError`/`BadRequestError`/`NotFoundError`/`ConflictError`, mappées par les adaptateurs vers les codes wire historiques (`VALIDATION_ERROR`/`BAD_REQUEST`…).
- **Surface wire** : `error_payload` met `message` **et** `error_code` sur le wire. Le **snapshot de contrat ne fige PAS les messages** (`tests/snapshots/output_contracts.json`), mais **24 tests** assertent un `error_code` (parfois un sous-texte de message).

## 2. Contraintes (déterminantes pour le design)

1. **Pas de nouvelle dépendance runtime** (CLAUDE.md : moteur ≈ stdlib). ⇒ **pas** de `pydantic`/`jsonschema`/`marshmallow`. Le validateur sera **maison, stdlib pur** (~120–150 l.).
2. **Growth gate `sidecar.py`** (net +500 l. / 90 j). ⇒ le validateur vit dans un **nouveau module** (`services/validation.py`) — il ne compte pas contre `sidecar.py`, et remplacer les blocs inline par `validate(body, SCHEMA)` **réduit** `sidecar.py` (croissance nette négative, *aide* le gate).
3. **Gel de contrat / byte-identique** : invariant dur = **conserver le `error_code` par endpoint** (le code wire historique). Les messages ne sont pas figés par le snapshot mais 24 tests les touchent ⇒ garder des messages équivalents, ou mettre à jour la poignée de tests qui assertent un sous-texte.
4. **Intégration A-01** : le validateur lève les erreurs typées de `services/errors.py` ⇒ le mapping adaptateur→code wire est **réutilisé tel quel**. **Ne pas** rouvrir la décomposition A-01 (parkée) — A-03 est orthogonal (validation, pas extraction de domaine).
5. **Périmètre = validation STRUCTURELLE** (présence / type / enum / bornes / coercition). Les checks **sémantiques** (existence → `NotFoundError`, conflit → `ConflictError`, dépendants DB) **restent** dans les services.

## 3. Design retenu — validateur déclaratif maison

Nouveau module `services/validation.py` (stdlib pur) :

```python
@dataclass(frozen=True)
class Field:
    name: str
    type: type | tuple[type, ...]      # str / int / bool / (int, float) …
    required: bool = True
    enum: tuple[str, ...] | None = None
    min: float | None = None           # bornes numériques / longueur
    max: float | None = None
    default: Any = _UNSET

def validate(body: Mapping, schema: Sequence[Field], *, where: str = "body") -> dict:
    """Retourne un dict validé/coercé ; lève ValidationError (message stable) au 1er échec."""
```

- Schémas par endpoint = `tuple[Field, ...]`, déclarés **près du service** (ou dans `sidecar_contract.py` — cf. *stretch* §6).
- Messages **normalisés et stables** (ex. `"<field> is required"`, `"<field> must be <type>"`, `"<field> must be one of …"`) → cohérence + tests prévisibles.
- Lève `ValidationError`/`BadRequestError` (`services/errors.py`) — **jamais** le code wire directement. Le code (`ERR_VALIDATION` vs `ERR_BAD_REQUEST`) est choisi **par endpoint** par l'appelant (cf. §2.3), pas par le validateur : beaucoup de blocs `sidecar.py` retournent historiquement `ERR_BAD_REQUEST`, pas `ERR_VALIDATION`.
- **Deux formes d'intégration** (cf. les deux mécanismes du §1) :
  - **service** (lève déjà) : `body = validate(body, SCHEMA)` se propage à l'adaptateur A-01 qui mappe vers le code wire — *drop-in*.
  - **handler `sidecar.py`** (émet via `_send_error`, ne lève pas) : la levée du validateur doit être **attrapée et traduite** — soit `try: validate(...) except ValidationError as e: self._send_error(e.message, code=<code historique de ce bloc>, http_status=400); return`, soit un **wrapper/décorateur** de handler mappant `ServiceError → _send_error`. **Mécanisme à figer en phase 1** (c'est le chemin qui domine les ~66 blocs).

**Alternatives écartées** : `jsonschema`/`pydantic` (dépendance) ; TypedDict seul (pas de validation runtime).

## 4. Décomposition (incrémentale, modèle S-03/A-01)

1. **Phase 1 — socle** : `services/validation.py` (`Field` + `validate`) + tests unitaires exhaustifs (types, enum, bornes, coercition, required, defaults). Migrer **2 endpoints preuve, un de chaque forme** (§3) : un **service** (ex. `conventions_service`, levée *drop-in*) **et** un **handler `sidecar.py` inline** (ex. `/index`, qui force à figer le mécanisme catch→`_send_error` avec le code historique). Vérifier le wire **byte-identique** (`error_code` + message) via tests de contrat + tests endpoint.
2. **Phases 2..N — migration par lots** (par domaine/service) : remplacer les blocs structurels par des schémas `Field`. Chaque lot **préserve le `error_code`** ; mettre à jour la poignée de tests qui assertent un sous-texte de message si nécessaire. Lots petits (revue + CI par lot).
3. **Clôture** : les ~66 blocs structurels migrés ; `error_code` byte-identique partout ; `sidecar.py` à la baisse ; 0 nouvelle dépendance.

## 5. Risques & mitigations

- **Tests sidecar non-runnables localement** (subprocess, cf. CLAUDE.md) ⇒ filet = **CI par lot** (comme S-03/T-04). Lots petits.
- **Régression silencieuse de message** ⇒ invariant = `error_code` (couvert par 24 tests) ; diff des messages revu par lot ; messages normalisés documentés.
- **Coercition** (ex. `int(doc_id)`) : reproduire à l'identique le comportement (rejet vs cast) endpoint par endpoint — ne pas « durcir » en passant (sinon changement de contrat).

## 6. Stretch (hors périmètre initial)

Héberger les schémas `Field` dans `sidecar_contract.py` permettrait, à terme, de **dériver les `requestBody` OpenAPI** des mêmes schémas (source unique entrée-validée / contrat documenté). À évaluer après la migration — ne pas bloquer A-03 dessus.

## 7. Définition de fini

- `services/validation.py` + tests unitaires verts.
- ~66 blocs structurels migrés vers des schémas déclaratifs ; checks sémantiques laissés aux services.
- `error_code` **byte-identique** par endpoint (contract-freeze + tests endpoint verts en CI).
- `sidecar.py` net ≤ 0 ligne ajoutée (idéalement réduit) ; **aucune** nouvelle dépendance runtime.

## 8. Clôture (2026-06-21) — livré, et pourquoi on s'arrête là

**Statut : CLOS.** Le socle est livré, la couche service est migrée, la viabilité
sur un handler `sidecar.py` est **prouvée en CI**. La traîne des handlers inline est
**délibérément laissée en backlog** — un finding chiffré pendant la migration montre
qu'aller plus loin *field-by-field* irait à l'encontre du but du ticket.

### Livré (mergé dans `dev`)

| Lot | PR | Contenu |
|----|----|---------|
| 1 — socle + 2 preuves | #94 | `services/validation.py` (`Field` + `validate`, **stdlib pur**, 0 dépendance) + tests ; preuves `conventions_service` (drop-in service) **et** `/index` (handler inline catch→`_send_error`) |
| 2 | #95 | facettes `items` + bornes-collections ; `documents_service` |
| 3 | #96 | coerce-int ids ; `units_service` |
| 4 | #97 | facette `nullable` ; `tokens_service` |
| 5 | #98 | `doc_relations_service` (`delete_doc_relation` ; `set_doc_relation` laissé inline — garde combiné cross-field + truthy) |
| 6 — preuve sidecar | #99 | handlers inline `_handle_export_conllu`/`_handle_export_ske` (`out_path`), byte-identique vérifié contre les tests wire CI |

Facettes du valideur : `type` / `required` / `enum` / bornes (num **et** longueur str/collections) / `coerce` int / `default` / `strip` / `items` / `nullable` ; lève `ValidationError`/`BadRequestError` typées, jamais de code wire ; **0 nouvelle dépendance**.

### Pourquoi la traîne sidecar n'est PAS poursuivie (révision du §7)

Le §7 visait « ~66 blocs migrés » et « `sidecar.py` net ≤ 0 ligne ». **Mesuré au lot 6 : migrer un garde *mono-champ* est line-POSITIF** — #99 = **net +26 lignes** sur `sidecar.py` pour 2 handlers (imports locaux + `try/except` + commentaire A-03 > le garde inline de 4 lignes). Grinder la traîne field-by-field **gonflerait** `sidecar.py` au lieu de le réduire : cela contredit l'objectif. Les objectifs chiffrés du §7 (« ~66 blocs », « net ≤ 0 ») sont donc **abandonnés sciemment** au profit de l'intégrité (ne pas net-ajouter du code pour cocher une case).

### Réouvrir un jour ? Deux seules voies à gain réel (sinon, ne pas toucher)

1. **Handlers « gras »** (≥ 3-4 `isinstance`) où un schéma collapse en **net-négatif** — viser ceux-là uniquement, pas les gardes à 1 champ. (Le bloc params-de-jobs est gras mais **conditionnel** → à expertiser, probablement pas un bon candidat.)
2. **Helper partagé** : DRY les **8** gardes `out_path` identiques derrière un `_require_out_path(body)` (réduit les lignes sans schéma par handler).

### Invariants confirmés

`error_code` byte-identique sur tous les endpoints touchés (contract-freeze + tests wire verts en CI) ; messages non figés (seul le `error_code` l'est) ; périmètre strictement **structurel** (sémantique → services). Méthode capitalisée pour réutilisation hors A-03.
