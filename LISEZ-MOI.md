# 🗺️ Carte du Monde — Explorateur & éditeur de royaumes

Un petit site pour explorer ta map Minecraft, délimiter les royaumes et nommer les lieux.

> 🌍 **Mettre le site en ligne avec édition partagée** (Supabase + GitHub Pages) : voir **`DEPLOIEMENT.md`**.

## ▶️ Démarrer

**Double-clique sur `Lancer-la-carte.bat`.**
Ça ouvre la carte dans ton navigateur (`http://localhost:8777`).
👉 Laisse la fenêtre noire ouverte tant que tu utilises la carte ; ferme-la pour arrêter.

> Pourquoi un serveur ? Le navigateur refuse de charger les tuiles/données en `file://`.
> Le `.bat` lance un mini serveur local (rien n'est envoyé sur Internet).

## 🧭 Explorer
- **Déplacer** : cliquer-glisser. **Zoomer** : molette ou boutons `+ / −`.
- En bas à gauche : coordonnées Minecraft approximatives (X, Z) sous le curseur.
- Coche/décoche **zones**, **noms**, **lieux** dans la barre de gauche.
- Clique un royaume ou un lieu dans la liste pour y voler.

## ✏️ Éditer (créer tes royaumes)
1. Clique **✏️ Mode éditeur** (en haut à droite).
2. **➕ Royaume** : clique sur la carte pour poser les coins de la frontière, puis **✔️ Terminer** (min. 3 points). Donne un nom + une couleur.
3. **📍 Lieu** : clique **📍 Lieu** puis un point sur la carte. Donne-lui un nom.
4. Pour **modifier/supprimer** : en mode éditeur, clique une zone ou un lieu → le panneau d'édition s'ouvre.
5. `Échap` annule un tracé, `Entrée` termine une zone.

Tout est **sauvegardé automatiquement** dans le navigateur.

## 💾 Sauvegarder / partager
- **⬇️ Exporter** : télécharge un fichier `carte-royaumes.json` (ta sauvegarde).
- **⬆️ Importer** : recharge un `.json` exporté (utile pour changer de PC ou de navigateur).

> Pour rendre des royaumes visibles **par défaut** pour tout le monde, remplace le contenu de
> `data/kingdoms.json` par ton export.

## ⚙️ Régler les coordonnées Minecraft (optionnel)
Le PNG ayant été recadré, les coords X/Z sont approximatives. Tu peux les caler dans
`js/app.js` → `CONFIG.world` (`originX`, `originZ`, `blocksPerPixelX`, `blocksPerPixelZ`).

## 📁 Contenu
```
site/
├─ Lancer-la-carte.bat   ← double-clic pour démarrer
├─ index.html            ← la page
├─ css/ js/              ← styles + logique
├─ vendor/               ← Leaflet (local, hors-ligne)
├─ tiles/                ← les tuiles de la carte (zoom)
├─ data/kingdoms.json    ← royaumes/lieux par défaut
└─ map_meta.json         ← dimensions de la carte
```
