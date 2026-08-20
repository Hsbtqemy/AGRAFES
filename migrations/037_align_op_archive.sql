-- Migration 037: rendre annulables les sept verbes de lot de l'espace Alignement
-- (décision D-3, audit ALI-22 (a) / ALI-20 / une partie d'ALI-07).
--
-- POURQUOI UN TROISIÈME PROPRIÉTAIRE, ET PAS UNE DES DEUX ARCHIVES EXISTANTES
--
-- prep_action_history (019) est linéaire PAR DOCUMENT : son doc_id est NOT NULL et
-- désigne un seul document. align_run_purge (036) est clé par run_id. Un geste de lot
-- n'a ni l'un ni l'autre : il porte sur N liens quelconques, éventuellement sur
-- plusieurs paires de documents, et — c'est le point — **il ne touche aucune unité**.
-- Il n'existe donc aucune action de préparation à quoi le rattacher. C'est l'impasse
-- que l'audit avait nommée en ALI-17 et confirmée en §12.4.
--
-- CE QUI DIFFÈRE DES DEUX AUTRES ARCHIVES, ET QUI COMMANDE LA FORME DU RETOUR
--
-- 035 et 036 n'archivent que des liens DÉTRUITS : leur restitution est un INSERT, et
-- « le lien existe déjà » y signifie « quelqu'un a repris la place », donc on passe.
-- Ici, six verbes sur sept ne détruisent rien : ils MUTENT une ligne qui survit
-- (status, span, bead_uid, pivot_unit_id). Un INSERT OR IGNORE laisserait la mutation
-- en place et rapporterait « restauré ». La restitution est donc UPDATE-si-présent /
-- INSERT-si-absent, et c'est la seule différence de fond entre cette table et les deux
-- autres — les colonnes, elles, sont identiques, et pour la même raison : link_id est
-- archivé, donc la restitution est IDENTIQUE et non une re-création approchée.
--
-- LA PILE EST BORNÉE
--
-- Les deux archives existantes ne gardent que ce qu'une opération a détruit — rare.
-- Celle-ci écrit à chaque geste de lot, y compris « accepter », qui est le geste le
-- plus fréquent de l'écran. Sans borne, la table croîtrait avec l'usage normal et non
-- avec les accidents. On ne garde donc que les ALIGN_OP_KEEP opérations les plus
-- récentes (voir align_ops_service.py) : c'est ce que le bandeau « Annuler » promet —
-- défaire ce qu'on vient de faire, pas ce qu'on a fait le mois dernier.
--
-- Additive : deux tables neuves, aucune reconstruction. Vide sur toute base existante.

CREATE TABLE IF NOT EXISTS align_op (
    op_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT    NOT NULL,   -- 'batch_update' aujourd'hui ; voir la note ci-dessous
    performed_at TEXT    NOT NULL,   -- ISO 8601 UTC
    description  TEXT    NOT NULL,   -- libellé court, affiché tel quel par le bandeau
    links_count  INTEGER NOT NULL    -- nombre de liens archivés, pour l'affichage
);

-- `kind` n'a qu'une valeur aujourd'hui. La colonne existe parce que le §12 de l'audit
-- demandait « une clé d'opération générique + la nature de l'opération », et parce que
-- align_run_purge est le candidat naturel à s'y replier un jour (kind='run_purge').
-- Cette migration ne l'y replie PAS : ses lignes sont vivantes sur les bases réelles et
-- les déplacer coûterait une migration de données sans rien payer aujourd'hui.

CREATE TABLE IF NOT EXISTS align_op_link_snapshots (
    op_id              INTEGER NOT NULL,
    link_id            INTEGER NOT NULL,
    run_id             TEXT    NOT NULL,
    pivot_unit_id      INTEGER NOT NULL,
    target_unit_id     INTEGER NOT NULL,
    external_id        INTEGER NOT NULL,
    pivot_doc_id       INTEGER NOT NULL,
    target_doc_id      INTEGER NOT NULL,
    created_at         TEXT    NOT NULL,
    status             TEXT    NULL,
    source_changed_at  TEXT    NULL,
    bead_id            INTEGER NULL,
    bead_uid           TEXT    NULL,
    target_char_start  INTEGER NULL,
    target_char_end    INTEGER NULL,
    -- 1 : le lien EXISTAIT avant l'opération, défaire = lui rendre ces colonnes.
    -- 0 : l'opération l'a CRÉÉ, défaire = le supprimer. Les colonnes portent alors ses
    --     valeurs à la création, ce qui évite de relâcher les NOT NULL pour un cas où
    --     l'on ne se sert que du link_id.
    existed            INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (op_id, link_id),
    FOREIGN KEY (op_id) REFERENCES align_op(op_id) ON DELETE CASCADE
);

-- POURQUOI UNE OPÉRATION PEUT S'ÉTENDRE SUR PLUSIEURS REQUÊTES
--
-- Deux gestes de la matrice sont multi-requêtes : la coupe à cheval et le rattachement
-- au voisin appellent POST /align/link/create PUIS batch_update. Une archive par requête
-- offrirait un « Annuler » qui ressusciterait le lien supprimé en laissant le lien créé
-- — exactement l'état en doublon qu'ALI-22 décrit, sous une commande qui a l'air
-- complète. Les routes create / delete acceptent donc un op_id : le geste ouvre une
-- opération à son premier appel et les suivants la rejoignent. La clé primaire
-- (op_id, link_id) et l'INSERT OR IGNORE font que le PREMIER instantané d'un lien
-- gagne — c'est celui d'avant le geste, le seul qui vaille.

-- La garde de fraîcheur demande « une opération PLUS RÉCENTE a-t-elle touché l'un de
-- ces liens ? ». C'est une recherche par link_id à travers les opérations, l'inverse de
-- la clé primaire.
CREATE INDEX IF NOT EXISTS idx_align_op_snap_link
    ON align_op_link_snapshots(link_id);
