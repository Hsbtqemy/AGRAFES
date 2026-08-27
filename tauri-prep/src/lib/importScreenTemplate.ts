/**
 * importScreenTemplate.ts — squelette HTML statique de l'écran ImportScreen, extrait
 * de ImportScreen.render() (U-02).
 *
 * **Maître-détail** (IMPO-01, 27 août 2026). À gauche, la liste des fichiers : nom,
 * statut, et le **verdict** de la déduction — ce qui doit être vu sans qu'on l'ait
 * cherché. À droite, le panneau du fichier **sélectionné** : ses commandes, ce que
 * chaque mode ferait de lui, et un extrait de ce qui serait écrit.
 *
 * Ce que cette forme fait disparaître, et pourquoi :
 *
 * - **Les deux curseurs « 1/1 » + « Suivant »**. Ils n'existaient que parce que
 *   l'aperçu était un panneau *global* sans moyen de savoir de quel fichier on parlait.
 *   La sélection le lui dit. Sur un seul fichier en liste, « 1/1 » et un « Suivant »
 *   désactivé étaient du bruit pur.
 * - **La carte « Aperçu CoNLL-U »**, dépliée en permanence pour annoncer qu'aucun
 *   `.conllu` n'était sélectionné — alors qu'il n'en existe **aucun** sur le disque de
 *   l'utilisateur ni dans son corpus (mesuré le 27 août). Le panneau rend maintenant
 *   l'évidence du fichier sélectionné *quel qu'il soit* : des unités pour un texte, des
 *   tokens pour un CoNLL-U. Un seul panneau, deux rendus — la capacité reste entière,
 *   c'est la carte permanente qui tombe.
 * - **La carte « Index FTS »**. Elle était le **quatrième** point d'entrée de la
 *   réindexation — après la barre du concordancier, le bouton de `MetadataScreen` (qui
 *   dit « ✓ Index à jour » en lisant `fts_stale`) et ses pastilles « ⚠ Index » par
 *   document — et le seul qui ne sût rien de l'état de l'index. Et ce n'est pas après
 *   un import qu'on réindexe, mais après un travail de segmentation ou de curation.
 * - **Le fil d'Ariane** « ① Sources › ② Profil › ③ Validation › ④ Exécution » : sa
 *   classe `active` était écrite en dur sur la première étape et n'a jamais bougé, et
 *   son étape ② nommait un profil de lot qui n'existe plus.
 * - **La carte « Profil de lot »**, réduite à la seule langue par défaut — qui rejoint
 *   la bande de dépôt, puisque sa propre étiquette disait « appliquée aux nouveaux
 *   fichiers ». Elle travaille vraiment : sur 514 fichiers réels, 58 % portent leur
 *   langue dans leur nom, **42 % prennent le défaut**.
 * - **La case « bloquer les doublons » en double** (une dans le profil, une au pied de
 *   page, recopiées en JS). Il n'en reste qu'une, au pied de page, près du geste.
 */

export function importScreenTemplate(): string {
  return `
      <div class="imp-scroll">
      <div class="card imp-head-card">
        <div class="imp-head-top">
          <div>
            <h2 class="prep-screen-title" style="margin:0 0 4px">
              Importer des fichiers
              <button type="button" id="imp-refresh-btn" class="btn btn-secondary btn-sm"
                      title="Re-charger la liste des documents du corpus depuis la base (vérification doublons, candidats famille)"
                      style="margin-left:0.6rem;vertical-align:middle">↻ Actualiser</button>
            </h2>
            <p class="imp-head-desc">Ajoutez vos fichiers source : le mode d'import est déduit de chacun et affiché sur sa ligne. Sélectionnez un fichier pour voir ce que chaque mode en ferait.</p>
          </div>
          <div id="imp-state-banner" class="prep-runtime-state prep-state-info" aria-live="polite">
            En attente de connexion sidecar…
          </div>
        </div>
      </div>

      <!-- Maître-détail : la liste choisit, le panneau montre. -->
      <div class="imp-workspace">

        <div class="imp-col-main">
          <div class="card imp-files-card">
            <div class="imp-file-card-head">
              <h3 style="margin:0">Fichiers source</h3>
              <span id="imp-summary" class="chip">0 fichier</span>
            </div>
            <div class="imp-dropzone" id="imp-dropzone">
              <div class="imp-dropzone-text">📂 Glissez vos fichiers ici</div>
              <div class="imp-dropzone-sub">.docx &middot; .odt &middot; .txt &middot; .conllu &middot; .tei &middot; .xml</div>
              <div class="prep-btn-row" style="justify-content:center;margin-top:6px">
                <button id="imp-add-btn" class="btn btn-primary btn-sm">Ajouter des fichiers…</button>
                <button id="imp-clear-btn" class="btn btn-secondary btn-sm">Vider</button>
              </div>
              <div class="imp-dropzone-lang">
                <label for="imp-default-lang">Langue par défaut</label>
                <input
                  id="imp-default-lang"
                  type="text"
                  value="fr"
                  placeholder="fr, en, …"
                  maxlength="10"
                  autocomplete="off"
                  spellcheck="false"
                  inputmode="text"
                  title="Utilisée quand le nom du fichier ne porte pas de code de langue. 42 % des fichiers d'un corpus réel sont dans ce cas."
                />
                <button type="button" id="imp-apply-defaults-btn" class="btn btn-secondary btn-sm"
                        title="Réapplique la langue aux fichiers en attente. Le mode d'import, lui, est déduit de chaque fichier.">
                  Appliquer
                </button>
              </div>
            </div>
            <div id="imp-list" class="imp-file-list">
              <p class="empty-hint">Aucun fichier sélectionné.</p>
            </div>
            <div class="imp-precheck-strip">
              <span class="imp-diag"><span class="imp-diag-label">En attente</span> <span class="imp-diag-value" id="imp-diag-pending">0</span></span>
              <span class="imp-diag"><span class="imp-diag-label">Importés</span> <span class="imp-diag-value" id="imp-diag-done">0</span></span>
              <span class="imp-diag"><span class="imp-diag-label">Erreurs</span> <span class="imp-diag-value" id="imp-diag-errors">0</span></span>
              <span class="imp-diag imp-diag-total"><span class="imp-diag-label">Total</span> <span class="imp-diag-value" id="imp-diag-total">0</span></span>
            </div>
          </div>
        </div>

        <!-- Panneau du fichier sélectionné -->
        <div class="imp-col-side">
          <section class="card imp-detail-card">
            <div class="imp-detail-head">
              <h3 id="imp-detail-title" style="margin:0">Aucun fichier sélectionné</h3>
              <button type="button" id="imp-detail-refresh" class="btn btn-secondary btn-sm"
                      title="Relire le fichier">↻ Relire</button>
            </div>
            <p id="imp-detail-empty" class="hint">
              Cliquez un fichier de la liste pour voir ce que chaque mode d'import en ferait,
              et ajuster son mode, sa langue ou son titre.
            </p>

            <div id="imp-detail-body" hidden>
              <div class="imp-detail-controls">
                <label class="imp-detail-field imp-detail-field-mode">
                  <span>Mode d'import</span>
                  <select id="imp-detail-mode" title="Mode d'import — déduit du fichier, ajustable si vous savez quelque chose que le fichier ne dit pas"></select>
                </label>
                <label class="imp-detail-field imp-detail-field-col" id="imp-detail-col-wrap">
                  <span>Colonne</span>
                  <input id="imp-detail-col" type="number" min="1" step="1" placeholder="aucune"
                         title="Colonne du tableau à extraire (1 = première). Laisser vide pour ignorer les tables." />
                </label>
                <label class="imp-detail-field imp-detail-field-lang">
                  <span>Langue</span>
                  <input id="imp-detail-lang" type="text" maxlength="10" placeholder="lang" />
                </label>
                <label class="imp-detail-field imp-detail-field-title">
                  <span>Titre</span>
                  <input id="imp-detail-title-inp" type="text" placeholder="titre" />
                </label>
              </div>

              <div id="imp-text-cmp" class="imp-cmp" hidden></div>

              <div id="imp-text-tables" class="imp-tables-note" hidden>
                <span id="imp-text-tables-msg" class="hint"></span>
                <button type="button" id="imp-text-tables-split" class="btn btn-secondary btn-sm"
                        title="Ajoute le fichier une fois par colonne dans la liste d'import, titres suffixés — chaque colonne deviendra un document distinct">Un document par colonne</button>
              </div>

              <p id="imp-detail-summary" class="hint imp-conllu-summary"></p>

              <div class="imp-conllu-table-wrap" id="imp-text-wrap">
                <table class="imp-conllu-table" aria-label="Aperçu unités texte">
                  <thead>
                    <tr><th>ID</th><th>Type</th><th>Texte (extrait)</th></tr>
                  </thead>
                  <tbody id="imp-text-rows">
                    <tr><td colspan="3" class="empty-hint">Aperçu indisponible.</td></tr>
                  </tbody>
                </table>
              </div>

              <div class="imp-conllu-table-wrap" id="imp-conllu-wrap" hidden>
                <table class="imp-conllu-table" aria-label="Aperçu tokens CoNLL-U">
                  <thead>
                    <tr><th>Phrase</th><th>ID</th><th>Forme</th><th>Lemme</th><th>UPOS</th></tr>
                  </thead>
                  <tbody id="imp-conllu-rows">
                    <tr><td colspan="5" class="empty-hint">Aperçu indisponible.</td></tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
      </div>

      <!-- Footer docked at bottom of main prep-pane (above scrolling content) -->
      <div class="imp-footer-bar">
        <div class="imp-footer-meta">
          <span class="hint" style="margin:0">Importe tous les fichiers en attente, chacun dans le mode affiché sur sa ligne.</span>
        </div>
        <label class="imp-footer-check" title="Si coché : refuse l'import lorsqu'un document avec le même nom de fichier existe déjà dans le corpus (chemins différents inclus).">
          <input type="checkbox" id="imp-check-filename-footer" />
          Bloquer doublons par nom
        </label>
        <div class="prep-btn-row">
          <button id="imp-import-btn" class="btn btn-primary" title="Importer tous les fichiers en attente" aria-label="Importer tous les fichiers en attente" disabled>⬆ Importer</button>
        </div>
      </div>
    `;
}
