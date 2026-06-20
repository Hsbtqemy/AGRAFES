# R-01b : `/health` & `/shutdown` non-bloquants sous handler figé

> **Statut : ✅ implémenté** (approche A ci-dessous) — `RLock` au dispatch +
> `ThreadingHTTPServer` + `daemon_threads`, `sidecar.py` net +25 l ; 3 tests de
> concurrence + 195 tests in-process verts. Cette note reste la référence de design.

Note de cadrage (figée **avant** ouverture du ticket). Suite directe du finding
**R-01b** (`docs/AUDIT_FOLLOW_UP.md`) et de l'**ADR-042** (`docs/DECISIONS.md`), qui
ont livré P0+P1 et **différé** ce volet après une passe adversariale.

**Pré-requis (satisfait)** : friction réellement observée — l'incident R-01
(ouverture d'une DB wedgée sur OneDrive → sidecars orphelins) a montré que sous un
handler bloqué, `/health` et `/shutdown` deviennent muets. P0+P1 éliminent **la fuite**
(reap garanti), mais pas la **non-responsivité** : un sidecar wedgé paraît mort, et son
`/shutdown` gracieux n'aboutit pas (seul le force-kill PID le récupère). Ce ticket
rend `/health` + `/shutdown` vifs sous handler bloqué — proprement cette fois.

---

## 1. La contrainte qui a fait reverter le threading naïf

Passer le serveur en `ThreadingHTTPServer` (le revert d'ADR-042) rendrait `/health` et
`/shutdown` (lock-free) responsives. Mais le code suppose **« une requête à la fois »** :
de nombreux handlers de **lecture** touchent la connexion SQLite **partagée hors
`self._lock()`** — commentaires explicites « Read — no write-lock » :

- `_handle_documents` (`/documents`) — `list_documents(self._conn())`
- `_handle_doc_relations_all` (`/doc_relations/all`)
- `_handle_align_source_changed_summary` (`/align/source_changed_summary`)
- … (**132** appels `self._conn()` au total, pour **62** blocs `with self._lock()` — donc beaucoup de lectures hors lock)

Sûrs **uniquement** parce que le serveur mono-thread sérialise les requêtes. En
threadé, l'écran Constituer (4 GET parallèles) ferait tourner ces lectures **en
concurrence sur la même `sqlite3.Connection`** → « recursive use of cursors ».

> Dette adjacente (déjà notée R-01b) : cette concurrence existe **déjà** aujourd'hui
> entre une lecture de requête et une écriture du `JobManager` (threads worker). Mode
> SQLite « serialized » + mono-thread bornent l'impact, mais le fix ci-dessous doit la
> couvrir **aussi**.

---

## 2. Décision de design — D1 : approche

### A — `RLock` au dispatch *(recommandée)*
Sérialiser **toutes** les requêtes DB via le lock global (comportement identique au
mono-thread actuel), en ne laissant hors-lock que `/health`, `/shutdown`, `/openapi.json`.

- `self._httpd.lock` : `threading.Lock` → **`threading.RLock`** (réentrant).
- Serveur : `HTTPServer` → `ThreadingHTTPServer` + `daemon_threads = True`.
- `do_GET` / `do_POST` / `do_PUT` : envelopper le **dispatch** dans `with self._lock()`,
  sauf les chemins lock-free ci-dessus.
- Les **62** `with self._lock()` internes deviennent des **ré-entrées inoffensives**
  (RLock) — aucun à retirer, aucun à ajouter site par site.

**Effet** : un seul accès DB à la fois (pas de race), mais `/health` + `/shutdown`
répondent même quand un handler tient le lock → le client health-check correctement et
le `/shutdown` gracieux d'un sidecar wedgé aboutit (plus besoin du force-kill PID dans
ce cas).

### B — Connexions par thread (`threading.local`)
`self._conn()` retourne une connexion par thread ; le lock ne sert plus qu'aux
écritures inter-process (SQLite gère le verrouillage fichier via WAL + `busy_timeout`).
Plus idiomatique, mais **refonte du cycle de vie connexion** : `backup()` (`/db/backup`),
`apply_migrations` au démarrage, l'objet `run` partagé, et la fermeture (`wal_checkpoint`
+ `close`) supposent tous **une** connexion. Plus de surface de régression.

**→ Retenu : A.** B est sur-dimensionné pour un outil local mono-utilisateur où la
sérialisation par lock est acceptable ; A atteint l'objectif (responsivité health/shutdown)
au prix minimal et **sans changer la sémantique de concurrence DB actuelle**.

---

## 3. Plan d'implémentation (A)

1. **Lock réentrant** : `self._httpd.lock = threading.RLock()` (`CorpusServer.start`,
   `sidecar.py:7710`). `_lock()` / `_run_async_job` inchangés (ils prennent ce lock).
2. **Serveur threadé** : `ThreadingHTTPServer((host, port), _CorpusHandler)` +
   `self._httpd.daemon_threads = True` (~`sidecar.py:7707`). Import `ThreadingHTTPServer`.
3. **Carve-out + dispatch sous lock** (mirror de `_do_GET_inner` existant) :
   - `do_GET` : si `path in {"/health", "/openapi.json"}` → `_do_GET_inner()` direct
     (lock-free) ; sinon `with self._lock(): self._do_GET_inner()`.
   - `do_POST` : garder le **token-gate** (717) tel quel (pas d'accès DB) ; puis si
     `path == "/shutdown"` → `_handle_shutdown()` (lock-free) ; sinon extraire le grand
     `if/elif` en `_do_POST_inner()` et l'appeler sous `with self._lock()`.
   - `do_PUT` : extraire `_do_PUT_inner()` et l'appeler sous `with self._lock()`
     (aucun chemin PUT lock-free).
4. **Test de concurrence réel** (cf. §5).

Estimation : **~+25-40 lignes nettes** sur `sidecar.py` (extractions `_do_POST_inner` /
`_do_PUT_inner` + carve-outs) — **sous le growth-gate** (< 500 / 90 j). Contrat OpenAPI
**inchangé** (aucun endpoint touché).

---

## 4. Pourquoi c'est sûr (preuves rassemblées)

- **Job-runner compatible** : `_run_async_job` prend déjà `self._httpd.lock`
  (`sidecar.py:7840,7850`) → jobs (threads worker) et requêtes (threads de requête) se
  sérialisent via le même lock, exactement comme aujourd'hui. Le `RLock` ne change ça
  que pour le thread qui détient déjà (réentrance), jamais entre threads distincts.
- **Pas de deadlock** (vérifié à l'impl) : aucun handler n'attend un thread/job —
  `JobManager.submit` est fire-and-forget (`thread.start()` + `return`, aucun `.join()`),
  le dict des jobs est géré par un lock *propre* au JobManager (pas le lock serveur), et
  aucun handler ne fait `.wait()`/`.join()`/`.result()`. Le cycle « handler tient le lock
  ∧ attend un job ∧ job attend le lock » ne peut donc pas se former.
- **Pas de streaming** : un seul `self.wfile.write` dans tout le fichier → réponses JSON
  one-shot. Envelopper le dispatch ne tient donc **pas** le lock pendant une réponse
  longue (il n'y en a pas).
- **Sémantique DB inchangée** : les requêtes DB restent traitées une à la fois ; seule
  la responsivité de `/health` + `/shutdown` sous handler bloqué change.
- **`daemon_threads = True`** : un thread de requête figé (I/O OneDrive) ne bloque jamais
  la sortie du process à l'arrêt.

---

## 5. Tests

- **Nouveau — concurrence (le test retiré au revert, correct cette fois)** : démarrer
  `CorpusServer` in-process, tenir `_httpd.lock` depuis le test, lancer un GET DB
  (`/corpus/info`) qui bloque sur le lock dans un thread, et asserter que `/health`
  répond < 1 s. **Doit passer** avec A ; avec le serveur mono-thread actuel ce test
  échouerait (`/health` resterait bloqué derrière le handler occupé). Variante :
  `/shutdown` aboutit pendant qu'un handler tient le lock.
- **Non-régression** : suite `test_sidecar_*` complète en CI (les tests subprocess
  doivent rester verts ; la sérialisation par lock est préservée).
- **Garde anti-deadlock** : un test qui enchaîne un handler verrouillé (write) appelant
  un sous-handler verrouillé, pour pinner la réentrance du `RLock`.

---

## 6. Risques & coûts

| Risque | Mitigation |
|--------|------------|
| Deadlock par double-acquire (`Lock` non réentrant) | `RLock` (point 1) + test de réentrance |
| Token de `/shutdown` contourné par le carve-out | Le token-gate (717) reste **avant** le carve-out ; `/shutdown` reste protégé |
| Hot-path touché (do_GET/POST/PUT) | Extractions mécaniques `_do_*_inner` + suite CI complète |
| Lecture-vs-job non verrouillée (dette préexistante) | Couverte : tout le dispatch passe sous lock |
| Handler long tenant le lock (export volumineux) | Acceptable (outil local mono-user) ; sinon, sortir l'I/O disque du lock — résiduel §7 |

---

## 7. Résiduel à confirmer au moment du ticket

- **I/O sous lock (exports, import, envoi réponse)** : le dispatch tient le lock sur
  **toute** la durée du handler — lecture DB, parsing/écriture fichier (`/import`,
  `/export/*`) et envoi de la réponse compris. **Ce n'est pas une régression** : l'ancien
  serveur mono-thread sérialisait déjà tout pareil (la boucle `serve` restait occupée
  jusqu'au retour du handler). C'est plutôt une **opportunité d'optimisation** future
  (faire *mieux* que l'ancien) : ne tenir le lock que pour l'accès DB et le relâcher avant
  l'I/O fichier/réseau. Non nécessaire pour un usage local mono-utilisateur.
- **`/jobs/<id>` polling** pendant un job long : **OK** — le worker prend `self._httpd.lock`
  *par écriture* (`with lock`, pas sur toute la durée du job) et le statut est lu via le
  lock propre du JobManager (pas le DB) ; le polling passe donc entre deux écritures.
- **Garde environnementale P3** (orthogonale) : avertir si la DB est sous un dossier
  cloud-sync (OneDrive) — réduit la fréquence du déclencheur à la source.
