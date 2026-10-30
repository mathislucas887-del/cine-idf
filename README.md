# Ciné IDF – Pathé & partenaires CinéPass en Île-de-France

Carte, annuaire avec photos et séances en direct des 69 cinémas CinéPass d'Île-de-France
(25 Pathé/Gaumont, dont La Géode et Les 7 Batignolles, et 44 cinémas partenaires).

## Lancer
```
python3 server.py          # Python 3, aucune dépendance
```
Ouvrez ensuite **http://localhost:8765**.
`server.py` sert l'application et relaie les appels vers l'API publique de pathe.fr, ce qui évite le blocage CORS. Les réponses sont gardées en cache 10 min.
Si vous ouvrez `index.html` directement, sans serveur, la carte et l'annuaire fonctionnent, mais pas les séances.

## Fonctions
- **Carte** (Leaflet/OpenStreetMap) : jaune = Pathé, bleu = partenaire. Un clic sur un marqueur affiche la photo, l'adresse et un lien vers la fiche.
- **Cinémas** : la liste en cartes avec photos, une recherche et un filtre Pathé/partenaires.
- **Séances** : choix d'un ou plusieurs cinémas Pathé et d'une date (sur 8 jours), puis filtre par film et par VF/VOST. Un clic sur un horaire ouvre la réservation Pathé.

## Sources
- Liste CinéPass : PDF officiel https://media.pathe.fr/files/conditions/ReseauCinePassCineCartes.pdf et https://www.pathe.fr/cinepass
- Pathé (slugs, GPS, photos, films, horaires) : API publique `https://www.pathe.fr/api/...`
- Géocodage des partenaires : OpenStreetMap Nominatim et Base Adresse Nationale
- Photos des partenaires : Wikimedia Commons et Wikipédia (auteur et lien source affichés sous chaque photo)

## Limites
- Séances en direct uniquement pour les cinémas Pathé. Les partenaires ne sont pas dans l'API Pathé, donc leur fiche renvoie vers Allociné.
- 14 partenaires n'ont pas de photo libre : un emplacement « Photo indisponible » s'affiche à la place.
- L'API Pathé n'est pas documentée et peut changer.
- Données statiques dans `data/cinemas.json`, recopiées dans `data/cinemas.js`. Les scripts `build_data.py` et `fix.py` servent à les régénérer.

## Accès depuis un téléphone
L'interface est adaptée au mobile : barre d'onglets en bas, fiches en panneau glissant, grands boutons et dates qui défilent.

1. Copiez le dossier `cine-idf` (ou `cine-idf.zip`) sur votre ordinateur. Il faut Python 3 : déjà présent sur Mac et Linux, à installer depuis python.org sous Windows.
2. Dans un terminal, placez-vous dans le dossier puis lancez `python3 server.py`. Sous Windows, la commande est `py server.py`.
3. Le terminal affiche deux adresses :
   - `http://localhost:8765` pour ouvrir l'appli sur l'ordinateur ;
   - `http://192.168.x.x:8765` pour le téléphone.
4. Sur le téléphone, connecté au **même Wi-Fi**, ouvrez la seconde adresse dans Safari ou Chrome.
5. Facultatif : utilisez « Ajouter à l'écran d'accueil » pour l'ouvrir comme une application.

Si le téléphone ne parvient pas à se connecter, autorisez Python dans le pare-feu de l'ordinateur, sur le port 8765.

L'ordinateur doit rester allumé avec `server.py` lancé : c'est lui qui récupère les séances sur pathe.fr.

## Accès depuis n'importe où (lien public)
Pendant que `server.py` tourne sur votre ordinateur, ouvrez un second terminal :
1. Installez cloudflared (gratuit, sans compte) :
   - Mac : `brew install cloudflared`
   - Windows : `winget install Cloudflare.cloudflared`
2. Lancez `cloudflared tunnel --url http://localhost:8765`.
3. Le terminal affiche une adresse du type `https://xxxx.trycloudflare.com`. Ouvrez-la sur votre téléphone, en 4G comme en Wi-Fi.

Le lien fonctionne tant que l'ordinateur et les deux terminaux restent ouverts. Il change à chaque relance.

## 📲 Télécharger l'application

### Android (APK)
1. Sur votre téléphone, ouvrez **https://cine-idf.onrender.com/download/cine-idf.apk** (ou bouton 📲 du site → « Télécharger l'APK »).
2. Ouvrez le fichier `cine-idf.apk` téléchargé.
3. Si Android affiche « Pour votre sécurité, l'installation d'applis inconnues est bloquée » : **Paramètres** → autorisez **« Installer des applis inconnues »** pour Chrome (ou votre navigateur / gestionnaire de fichiers), puis revenez.
4. Touchez **Installer**, puis **Ouvrir**. L'icône Ciné IDF noir et or apparaît sur l'écran d'accueil.
   - Play Protect peut avertir « appli inconnue » (elle n'est pas sur le Play Store) : touchez « Installer quand même ».

Alternative sans APK : dans Chrome, menu **⋮ → Installer l'application** (PWA).

### iPhone / iPad (sans App Store)
1. Ouvrez **https://cine-idf.onrender.com** dans **Safari**.
2. Touchez **Partager** (carré avec flèche ⬆︎).
3. Choisissez **« Sur l'écran d'accueil »**, puis **Ajouter**.
4. Lancez Ciné IDF depuis l'icône : plein écran, favoris/billets disponibles hors ligne.

### Publier sur les stores (comptes développeur requis)
- **Google Play** (compte 25 $ une fois) : reconstruire un AAB signé (`android/build.sh` produit l'APK ; pour un AAB : `npx @bubblewrap/cli init --manifest https://cine-idf.onrender.com/manifest.webmanifest` puis `bubblewrap build`), publier `/.well-known/assetlinks.json` avec l'empreinte SHA-256 de la clé, puis importer l'AAB dans la Play Console.
- **App Store / TestFlight** (Apple Developer 99 $/an + un Mac avec Xcode) : `cd mobile && npm install && npx cap sync ios && npx cap open ios`, choisir l'équipe de signature, **Product → Archive → Distribute → App Store Connect**, puis inviter les testeurs dans TestFlight. Apple peut refuser une app qui n'est qu'un site web : prévoir d'ajouter des fonctions natives (notifications, widgets).

### Construire l'APK soi-même
`android/build.sh` (JDK 17 + Android SDK build-tools 34, sans Gradle). Clé de signature locale hors dépôt : la conserver pour publier des mises à jour.
