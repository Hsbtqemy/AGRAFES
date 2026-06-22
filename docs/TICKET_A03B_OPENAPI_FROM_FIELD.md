# TICKET — A-03B : dériver les `requestBody` OpenAPI des schémas `Field` (single source)

> Suite du stretch §6 de `TICKET_A03_SCHEMA_VALIDATION.md` (A-03 clos). Objectif :
> une **source unique** pour la validation **et** le contrat OpenAPI, là où c'est
> atteignable sans régression — c.-à-d. un **pilote** prouvé, pas un big-bang.

## 1. État des lieux (vérifié au code, 2026-06-21)

- `openapi_spec()` (`src/multicorpus_engine/sidecar_contract.py`, ~3670 l.) déclare chaque `requestBody` **à la main** : un `$ref` → `#/components/schemas/XxxRequest`, et les `XxxRequest` sont des **JSON Schema écrits à la main** sous `components.schemas` (`type` / `properties` / `required` / `enum` / `nullable` / `description` / `additionalProperties`).
- `scripts/export_openapi.py` sérialise `openapi_spec()` → `docs/openapi.json` (indent 2, `sort_keys=True`). Le **contract-freeze CI** exige que `docs/openapi.json` **et** `tests/snapshots/openapi_paths.json` matchent la sortie de `sidecar_contract.py`.
- Les schémas **`Field`** (validation, `services/validation.py`) vivent **au point d'usage**, éparpillés (handlers `sidecar.py` + `services/*.py`), et **partiellement** : ex. `/export/conllu` n'a un `Field` que pour `out_path` (pas `doc_ids`) ; `/import` n'a **aucun** `Field` (validation dans `import_service`).
- Exemple de référence — `IndexRequest` actuel :
  ```json
  {"type": "object",
   "properties": {"incremental": {"type": "boolean", "description": "If true, runs incremental FTS sync …"}},
   "additionalProperties": false}
  ```
  ⇄ schéma de validation `_handle_index` : `(Field("incremental", bool, required=False, default=False),)`.

## 2. Contraintes (déterminantes pour le design)

- **Contract-freeze = gate CI dur.** Toute dérivation doit produire un `openapi.json` soit **byte-identique**, soit dont le **diff est intentionnel, revu et régénéré** (`python scripts/export_openapi.py` + commit). *Aucun endpoint retiré* (règle existante).
- **Pas de nouvelle dépendance runtime** (stdlib pur — la dérivation est du dict-building).
- **Le growth-gate ne s'applique PAS** : il cible `sidecar.py`, pas `sidecar_contract.py`. Le code de génération va donc dans `sidecar_contract.py`/helper sans contrainte de lignes.
- **3 obstacles structurels** (révélés à la reconnaissance — cadrent le périmètre) :
  1. **Couverture** : les `Field` ne couvrent qu'une minorité d'endpoints, souvent partiellement. Dériver *tous* les `requestBody` supposerait d'écrire des `Field` complets partout = le travail qu'**A-03 a délibérément arrêté** (line-négatif). → **hors périmètre**.
  2. **Perte d'info — champs ET types** (vérifié au code) :
     - *champs* : les JSON Schema manuels portent la liste **complète** des champs ; ex. `POST /conventions` déclare `name, label, color, icon, sort_order`, mais `_CREATE_CONVENTION_SCHEMA` ne couvre que `name`+`label` → dériver **supprimerait** color/icon/sort_order du contrat.
     - *types* : beaucoup de `Field` migrés sont **presence-only** (`type=object`, sans type) car écrits pour matcher byte-identique des gardes legacy lâches (`x is None`) ; les schémas OpenAPI sont **typés**. Ex. `POST /doc_relations/delete` déclare `id: {type: integer}`, mais `Field("id", required=True)` est typeless → dériver **perdrait `type: integer`**. Resserrer le `Field` (`type=int`) **changerait le comportement de validation** (presence-only accepte tout type ; `int` rejette) → re-vérification byte-identique par champ, hors périmètre ici.
     - *descriptions* : `Field` n'a pas de `description` → il faut un **`Field.description`** optionnel.
     - ⇒ **ne dériver QUE des schémas `Field` à couverture *complète* ET *typée*** ; sinon régression du contrat.
  3. **Mismatch sémantique** : le valideur **ignore** les clés en trop (permissif, cf. `validate()` qui ne copie pas les clés hors-schéma) ; certains schémas (ex. `IndexRequest`) déclarent `additionalProperties: false` (strict), d'autres (ex. inline `POST /conventions`) **l'omettent**. → la dérivation **n'invente pas** `additionalProperties` depuis la sémantique du valideur ; elle l'émet comme **choix d'auteur** via un paramètre à **3 états** (`false` / `true` / *omis*) pour rester byte-identique selon le schéma cible. Durcir le valideur pour rejeter les extras est **hors périmètre** (changement de comportement).

## 3. Design retenu — générateur `Field → JSON Schema`, piloté

1. **Étendre `Field`** d'un attribut **`description: str | None = None`** (frozen dataclass ; n'affecte pas `validate()`). Rétro-compatible (défaut `None`).
2. **Générateur** `field_schema_to_openapi(schema: Sequence[Field], *, additional_properties: bool | None = False, include_default: bool = False) -> dict` (dans `sidecar_contract.py` ou un helper qu'il importe). `additional_properties` à 3 états : `False`/`True` émet la clé, `None` l'**omet**. Mapping :
   - `type` → `{"type": <nom JSON>}` (réutiliser `_TYPE_NAMES` de `validation.py` ; tuple → `oneOf`/union si rencontré, sinon scalaire) ; `object` (pas de type) → pas de clé `type` ;
   - `required=True` → ajouté au tableau `required` (omis si vide, pour matcher l'existant) ;
   - `enum` → `"enum"` ; `min`/`max` → `minimum`/`maximum` (numérique) ou `minLength`/`maxLength` (str) ou `minItems`/`maxItems` (list) selon `type` ;
   - `default` (si `≠ _UNSET`) → `"default"` — **émission togglable** (`include_default: bool`), car l'`IndexRequest` actuel n'a PAS de `default` : le pilote choisit byte-identique (supprimer) vs documenté (émettre + régénérer le freeze) ;
   - `items` → `{"items": {"type": …}}` ; `nullable=True` → `"nullable": true` ;
   - `description` → `"description"` (si non `None`) ;
   - conteneur : `{"type": "object", "properties": {…}, [required], "additionalProperties": <param>}`.
3. **Source unique des schémas de requête** : déposer les `Field`-tuples **canoniques** dans un endroit unique (ex. constantes dans `sidecar_contract.py`, ou `services/request_schemas.py`) que **les deux** consomment — le handler (`validate(body, SCHEMA)`) **et** `openapi_spec()` (`field_schema_to_openapi(SCHEMA)`). Pour le pilote : extraire le `_INDEX_SCHEMA` aujourd'hui inline dans `_handle_index`.
4. **Pilote = `/index`** (seul endpoint à couverture `Field` *complète ET typée* : 1 champ `bool`). Cible : `field_schema_to_openapi(_INDEX_SCHEMA, additional_properties=False, include_default=False)` **reproduit byte-identique l'`IndexRequest` actuel** (`Field.description` portant le texte existant ; `default` supprimé via le toggle). Si on préfère *documenter* le défaut (`include_default=True`), l'écart (`"default": false`) est assumé et le freeze régénéré — décision à acter en phase 1.

## 4. Décomposition (incrémentale, modèle A-03)

1. **Phase 1 — socle + pilote `/index`** : `Field.description` + `field_schema_to_openapi` + tests unitaires du générateur (chaque facette → fragment JSON Schema attendu) ; extraire `_INDEX_SCHEMA` en source unique ; brancher `IndexRequest` sur le générateur ; **régénérer `docs/openapi.json` + snapshot** et faire passer le contract-freeze (diff revu). Vérifier `/index` toujours byte-identique côté validation.
2. **Phases 2..N — quasi vides aujourd'hui, à NE PAS forcer** : audit au code (2026-06-21) — *aucun* autre endpoint migré n'est un candidat propre : `conventions/create` est **partiel** (color/icon/sort_order absents du `Field`), `doc_relations/delete` / `documents/*` / `units/*` ont des `Field` **type-lâches** (presence-only) qui perdraient le `type` OpenAPI, l'export est partiel (`out_path` seul). Étendre exige d'abord de **compléter + typer** les `Field` — donc de **rouvrir le travail qu'A-03 a arrêté** (line-négatif) et de **re-vérifier le byte-identique** de validation à chaque resserrage de type. ⇒ traiter ces endpoints **un par un, seulement si justifié**, jamais en masse. Réaliste : `/index` est ~tout le périmètre proprement dérivable en l'état.
3. **Clôture** : générateur + `Field.description` + `/index` dérivé prouvé en CI ; décisions `additionalProperties` / `default` / type-looseness documentées ; **extension = backlog explicitement gated** sur la complétude+typage des `Field`. Le livrable réel d'A-03B est donc **l'outil + la preuve + le gate documenté**, pas une couverture large.

## 5. Risques & mitigations

- **Diff de freeze non maîtrisé** ⇒ régénérer via `scripts/export_openapi.py`, **review du diff JSON** par endpoint ; viser le byte-identique, sinon écart intentionnel documenté en commit.
- **Dérive de doc (perte de `description`/champs)** ⇒ ne dériver QUE des `Field` complets + `Field.description` obligatoire là où l'existant en a un ; test comparant le `requestBody` généré à l'attendu.
- **Mismatch `additionalProperties`** ⇒ paramètre explicite 3 états (`false`/`true`/`None`=omis), **pas** dérivé du valideur ; durcissement du valideur hors périmètre.
- **Couplage `sidecar_contract` → `services.validation`** ⇒ import unidirectionnel (contrat dépend de la validation, jamais l'inverse) ; pas de cycle.

## 6. Définition de fini (pilote)

- `Field.description` ajouté (rétro-compatible) ; `validate()` inchangé ; tests valideur toujours verts.
- `field_schema_to_openapi()` + tests unitaires (toutes facettes).
- `/index` : `IndexRequest` **dérivé** de `_INDEX_SCHEMA` (source unique handler + contrat) ; `docs/openapi.json` + snapshot régénérés ; **contract-freeze vert en CI** ; `/index` validation byte-identique.
- Décisions documentées (ce ticket ou `DECISIONS.md`) : `additionalProperties` (param 3 états), `default` (toggle), **type-looseness** (pourquoi on ne resserre pas les `Field` migrés), et le **gate d'extension** (complétude+typage requis).
- **Aucune** nouvelle dépendance.

## 7. Clôture — pilote livré (2026-06-21)

**Livré** (le livrable réel = **l'outil + la preuve + le gate**, pas une couverture large) :

- **`Field.description`** ajouté (`services/validation.py`, frozen dataclass, défaut `None`, **en queue** des champs → rétro-compat positionnelle). Pure métadonnée : `validate()` ne le lit jamais → validation byte-identique (vérifié sur `{}`, `{incremental:true}`, `{incremental:"yes"}`, `{incremental:null}`, non-objet).
- **`field_schema_to_openapi()`** + `INDEX_SCHEMA` dans le **nouveau module `services/request_schemas.py`** (single source consommée par `_handle_index` **et** `openapi_spec()`). Couplage unidirectionnel `sidecar_contract → request_schemas → validation` (zéro cycle). Stdlib pur, **aucune** dépendance.
- **Pilote `/index`** : `IndexRequest` dérivé de `INDEX_SCHEMA` → **byte-identique** à l'ancien schéma manuel (freeze CI vert, `docs/openapi.json` + snapshot **inchangés** — `scripts/export_openapi.py` produit zéro diff). `_handle_index` valide contre le **même** `INDEX_SCHEMA`.
- **Tests** : `tests/services/test_request_schemas.py` (26) — byte-identité du pilote (vs schéma attendu, vs spec live, vs `docs/openapi.json` commité) + chaque facette (type scalaire / sentinel `object` sans `type` / tuple→`oneOf` / `required` listé+omis-si-vide / `enum` / bornes num→`minimum`-`maximum`, str→`minLength`-`maxLength`, list→`minItems`-`maxItems`, dict→`minProperties`-`maxProperties` / `items` / `nullable` / toggle `default` on-off-unset / `description` / `additionalProperties` 3 états) + `description` ignorée par `validate()`.

**Décisions actées** (cf. §2, §3) :

- **`additionalProperties` = choix d'auteur 3 états** (`False`/`True` émettent, `None` **omet**), **pas** dérivé de la sémantique (permissive) du valideur. Durcir le valideur pour rejeter les extras reste **hors périmètre** (changement de comportement). Pilote : `False`.
- **`default` = toggle** (`include_default`). Pilote : **off** → `default` supprimé pour matcher l'`IndexRequest` historique (qui n'en portait pas). Documenter le défaut = `include_default=True` + régénérer le freeze (écart assumé).
- **Type-looseness — on NE resserre PAS les `Field` migrés.** Beaucoup sont presence-only (`type=object`) pour matcher byte-identique des gardes legacy lâches ; resserrer (`type=int`…) **changerait la validation** (presence-only accepte tout type, `int` rejette) → bascule 200→400. Le générateur respecte le `Field` tel quel (`object` → pas de clé `type`).
- **Gate d'extension** (backlog explicite) : un endpoint n'est dérivable proprement **que si** son `Field`-schéma est **complet** (tous les champs du contrat) **ET typé** (pas de presence-only là où le contrat est typé). Sinon la dérivation **supprime** des propriétés ou perd le `type`. Étendre exige donc de **compléter + typer** les `Field` d'abord — soit **rouvrir le travail line-négatif qu'A-03 a arrêté** + re-vérifier le byte-identique par champ. ⇒ endpoint par endpoint, **jamais en masse**. En l'état, **`/index` est ~tout le périmètre proprement dérivable**.

🏁 **A-03B clos sur le pilote.** Extension = backlog gated (complétude+typage des `Field`).
