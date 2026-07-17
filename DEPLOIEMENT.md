# 🚀 Déploiement — Carte du Monde en ligne (édition partagée)

Objectif : la carte accessible par un lien, tout le monde la voit, et les personnes
qui ont le **code d'édition** peuvent ajouter/modifier royaumes & lieux **en temps réel**.

- **Site** → GitHub Pages (gratuit)
- **Données + temps réel** → Supabase (gratuit)

---

## Étape 1 — Créer la table dans Supabase ✅ (à faire une fois)

1. Ouvre ton projet Supabase → menu de gauche **SQL Editor** → **New query**.
2. Ouvre le fichier `db/schema.sql` de ce dossier, **copie tout**, colle dans l'éditeur.
3. Clique **Run**. Tu dois voir « Success ». (Ça crée la table `features` + les règles + le temps réel.)

> Tes clés sont déjà dans `js/config.js` (URL + clé publique). Rien à changer là.

## Étape 2 — Définir le code d'édition 🔑

1. Ouvre `tools/hash.html` dans ton navigateur (double-clic).
2. Tape le mot de passe que tu partageras à tes amis → **copie le hash**.
3. Colle-le dans `js/config.js` → `editPasswordHash: "..."`.

> Sans hash, l'édition serait ouverte à tous. **Mets-en un avant la mise en ligne.**

## Étape 3 — Tester en local

1. Double-clic sur `Lancer-la-carte.bat`.
2. En bas à gauche tu dois voir **🟢 En ligne — édition partagée**.
3. Clique **Mode éditeur** → il demande le code → ajoute un royaume.
4. Recharge : le royaume est toujours là (il est dans la base, plus seulement le navigateur).

## Étape 4 — Mettre le site en ligne (GitHub Pages)

1. Crée un dépôt sur github.com (ex. `carte-monde`), **public**.
2. Dans ce dossier `site/`, ouvre un terminal et lance :
   ```bash
   git init
   git add .
   git commit -m "Carte du Monde"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/carte-monde.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Source : Deploy from a branch → Branch : main / (root) → Save**.
4. Attends ~1 min. Ton lien : `https://TON-PSEUDO.github.io/carte-monde/`

C'est en ligne ! Partage le lien (lecture pour tous) + le code d'édition (à tes amis).

---

## Mettre à jour plus tard
- **La carte (nouvelles images)** : régénère les tuiles, puis `git add . && git commit -m "maj" && git push`.
- **Royaumes/lieux** : ils vivent dans Supabase, pas besoin de re-push — tout le monde les voit en direct.

## Sécurité — rappel
Le code d'édition protège le **bouton d'édition** dans le site. C'est bien pour un usage
entre amis. Quelqu'un de très technique pourrait écrire directement via l'API : si un jour
tu veux une vraie protection serveur, on remplace la règle d'écriture par une **Edge Function**
qui vérifie le mot de passe (voir la note en bas de `db/schema.sql`).
