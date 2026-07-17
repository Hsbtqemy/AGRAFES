Gros changement depuis le dernier point — les 6 finders sont tous rendus, et le gros poisson est sorti de la dimension sémantique (comme pressenti). Verdicts en cours de consolidation :

🔴 Le MAJEUR (vérif en vol, mais il est réel — je l'ai relu)
L'ancrage est classé par document, en ignorant la stratégie d'alignement réelle. position/value suppriment l'avertissement, alors que l'aligneur par défaut (length_bounded) ne lit jamais external_id — il ne se recale que sur parent_n.

Scénario concret : moyeu FR en docx_paragraphs (10 ¶ → external_id 1..10, pas de parent_n) + trad EN idem (12 ¶). Les deux sont classés {kind:'position', anchored:true} → aucun bandeau, aucune garde. L'utilisateur clique « Aligner » (défaut length_bounded) → derive_coarse_blocks voit le régime dérivé (pas de parent_n) → 1 ligne = 1 bloc → Gale-Church sur 10 vs 12 → ça dérive exactement comme Beigbeder, en silence.

Autrement dit : ma note §3 (« docx déjà couvert ») est fausse sous la stratégie par défaut. Seul parent_n protège vraiment l'aligneur de longueur ; position/value ne protègent que les stratégies external_id/position que l'utilisateur doit choisir explicitement. C'est un vrai défaut de conception, pas un bug de code — il touche la prémisse du filet.

✅/❌ Déjà tranchés
anchorRemedy(0) (mineur) → CONFIRMED ×2 : doc 100 % structure (0 ligne) reçoit le remède « blob/extraire » qui n'a aucun sens.
N+1 requêtes (nit) → CONFIRMED ×2 mais acceptable (indexé, aucun fix requis).
_anchorAckFamilyId slot unique (nit) → CONFIRMED ×2 : alterner 2 familles re-prévient ; sur-prévention bénigne.
KeyError _external_id_anchor (nit) → REFUTED ×2 : n toujours fourni par le SELECT, inatteignable.
⏳ Vérif encore en vol (3 mineurs + le majeur)
remède blob = référence morte (« extraire ses paragraphes » = R2.3 pas construit).
ack survit à un rechargement même-connexion (ré-import → garde sautée sur du contenu re-cassé).
bandeau garde survit à un changement de famille via le SELECT (attribué à la mauvaise entité).
Je te livre le rapport recoupé complet + les fixes proposés dès que les derniers réfutateurs rentrent (imminent). Le sujet à trancher avec toi sera surtout le majeur — il demande une décision de conception, pas juste un patch.