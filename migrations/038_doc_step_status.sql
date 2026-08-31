-- Migration 038: doc_step_status — la couche manuelle du statut par étape (ACT-01)
--
-- La page Actions ne sait dire que ce qu'elle dérive : des unités existent ⇒ segmenté,
-- des liens existent ⇒ aligné. Le jugement de l'utilisateur n'a nulle part où se poser.
-- Une segmentation appliquée mais insatisfaisante rend le même écran qu'une réussie, et
-- rien ne survit à la fermeture du programme.
-- Modèle : docs/DESIGN_step_status_tristate.md. Trois états par (document, capacité) —
-- `[ ]` aucune trace, `[/]` une trace mais rien de conclu, `[X]` l'utilisateur a dit que
-- c'était réglé. Les DEUX premiers restent dérivés et ne coûtent rien ; cette table ne
-- porte que le troisième. Au plus quatre lignes par document, en pratique beaucoup moins.
--
-- ON DELETE CASCADE, explicitement. La migration 028 déclare ses deux clés étrangères
-- SANS cascade, et c'est ce qui a fait tomber /segment, /units/merge et /prep/undo :
-- avec foreign_keys=ON, la suppression lève l'erreur APRÈS avoir détruit des lignes,
-- sans rollback — perte silencieuse. Réparé par la 029. On ne recommence pas.
--
-- LA PÉREMPTION. Un `[X]` que le travail suivant dément est un mensonge silencieux :
-- mesuré le 31 août, environ une coche sur trois finirait par être démentie. Deux
-- signaux sont donc enregistrés AU MOMENT DE LA COCHE, et la coche périme si l'un des
-- deux bouge :
--
--   last_action_id  — le plus grand `action_id` de prep_action_history concernant CETTE
--                     capacité sur ce document, à l'instant de la coche. Une action
--                     ultérieure et non annulée de la même capacité périme. Scopé par
--                     capacité, jamais par document : `set_role` compte 11 actions sur
--                     la base de travail et ne concerne aucune des quatre capacités —
--                     sous une règle « toute action postérieure périme », renommer un
--                     rôle annulerait tout ce qui était validé sur le document.
--
--   derived_json    — l'état dérivé observable au même instant (unit_count,
--                     aligned_count, annotation_status, curated_at). Il rattrape ce que
--                     l'historique ignore : 36 documents sur 58 n'ont AUCUNE action
--                     enregistrée (prep_action_history est forward-only depuis le 7 mai
--                     2026). Angle mort en résorption — 83 % le 30 juin, 62 % le 27 août
--                     — donc ce second signal est transitoire par destination.
--
-- Aucun des deux ne suffit seul, et c'est voulu. L'historique est muet sur 62 % du
-- corpus ; le compte dérivé est aveugle à une resegmentation qui rend le même nombre
-- d'unités — cas observé, donc possible, et une occurrence suffit pour un signal dont
-- le seul métier est l'honnêteté.
--
-- `last_action_id` NULL veut dire quelque chose : aucun historique n'existait pour cette
-- capacité quand la coche a été posée. La coche repose alors sur le seul signal dérivé,
-- et l'écran doit le dire — « validé le 12/08, avant que l'historique existe » n'est pas
-- la même promesse que « validé le 12/08, aucune modification enregistrée depuis ». Une
-- coche qui tait sa propre incertitude est le défaut qu'on vient de corriger ailleurs :
-- l'index de recherche qui se disait « à jour » alors qu'il était illisible (FTS-01).
--
-- Pas de CHECK sur `step` : l'enum est validé dans la couche service, comme la 028 et la
-- 023. Ajouter une capacité reste ainsi un changement de service, sans reconstruction de
-- table.
--
-- Additive : table neuve, vide sur toute base existante, aucun rebuild.

CREATE TABLE IF NOT EXISTS doc_step_status (
    doc_id          INTEGER NOT NULL
                    REFERENCES documents(doc_id) ON DELETE CASCADE,
    step            TEXT    NOT NULL,          -- curation|segmentation|alignement|annotation
    validated_at    TEXT    NOT NULL,          -- ISO 8601 UTC
    last_action_id  INTEGER NULL,              -- NULL = aucun historique à la pose
    derived_json    TEXT    NOT NULL,          -- instantané de l'état dérivé, JSON
    PRIMARY KEY (doc_id, step)
);

-- La lecture qui compte est « toutes les coches de ces documents », servie à chaque
-- affichage de la page Actions. La PK couvre déjà (doc_id, step) donc doc_id seul est
-- indexé par son préfixe ; l'index inverse sert le décompte par capacité des cartes.
CREATE INDEX IF NOT EXISTS idx_doc_step_status_step
    ON doc_step_status (step);
