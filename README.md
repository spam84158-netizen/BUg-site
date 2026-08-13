# Zainz — Site famille

Site avec 4 options / 5 sous-menus, chaque sous-menu envoie un message préréglé
via ton propre numéro WhatsApp connecté — UNIQUEMENT vers des numéros présents
dans la liste blanche (`server/whitelist.js`).

## Avant de lancer

1. Ouvre `server/whitelist.js` et ajoute les numéros de ta famille (format : `2250506223313`, sans "+").
2. Vérifie `.env` : `OWNER_NUMBER` doit être ton numéro WhatsApp (celui qui va se connecter au site).
3. Modifie les textes des messages dans `server/messages.js` si besoin.

## Installation locale

```bash
npm install
npm start
```

Au premier lancement, un code de pairing à 6 chiffres s'affiche dans la console
(et via Socket.IO si tu branches une page admin dessus). Sur ton téléphone :
WhatsApp > Paramètres > Appareils connectés > Lier avec un numéro de téléphone,
puis entre le code.

Une fois connecté, la session est sauvegardée dans `auth_info/` — pas besoin
de re-scanner à chaque redémarrage.

## Déploiement sur Render

1. Crée un nouveau "Web Service" sur Render, connecté à ce repo.
2. Build command : `npm install`
3. Start command : `npm start`
4. Ajoute les variables d'environnement `OWNER_NUMBER` et `PORT` dans Render.
5. **Important** : `auth_info/` doit persister entre les redéploiements
   (utilise un disque persistant Render), sinon il faudra re-pairer à chaque déploiement.

## Sécurité

- Ne partage jamais le contenu de `auth_info/` (c'est la session WhatsApp connectée).
- `server/whitelist.js` est le seul garde-fou empêchant l'envoi vers un numéro
  non autorisé — ne le retire pas.
