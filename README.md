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
