# Intégration RFXCOM RFXtrx

Reliez un **RFXtrx433**, **RFXtrx433E** ou **RFXtrx433XL** de RFXCOM à
Gladys : sondes météo Oregon Scientific, compteurs d'énergie OWL, détecteurs
d'ouverture, de mouvement et de fumée, télécommandes et interrupteurs muraux
(Chacon DiO, X10, Blyss…), et les récepteurs pilotés par le RFXtrx (prises et
modules Chacon DiO, lampes, volets Somfy RTS).

> Intégration non officielle, sans lien avec RFXCOM.

## 1. Rendre le RFXtrx accessible en TCP

L'intégration tourne dans un conteneur isolé qui **ne peut pas ouvrir de port
USB**. Le RFXtrx reste branché sur une machine de votre réseau (la machine de
Gladys, un Raspberry Pi…), et **ser2net** rend son port série accessible sur
le réseau. Les octets sont exactement ceux du port série, à **38400 bauds**.

Trouvez le nom stable du RFXtrx (il ne change pas quand on rebranche d'autres
clés USB) :

```bash
ls -l /dev/serial/by-id/
# usb-RFXCOM_RFXtrx433XL_XXXXXXXX-if00-port0 -> ../../ttyUSB0
```

### Avec ser2net 4 (Debian 11+, Ubuntu 22.04+, Raspberry Pi OS)

```bash
sudo apt install ser2net
```

`/etc/ser2net.yaml` :

```yaml
connection: &rfxtrx
  accepter: tcp,4001
  enable: on
  options:
    kickolduser: true
  connector: serialdev,/dev/serial/by-id/usb-RFXCOM_RFXtrx433XL_XXXXXXXX-if00-port0,38400n81,local
```

Remplacez le chemin `/dev/serial/by-id/...` par le vôtre, puis :

```bash
sudo systemctl restart ser2net
```

### Avec ser2net 3 (distributions plus anciennes)

`/etc/ser2net.conf` :

```
4001:raw:0:/dev/serial/by-id/usb-RFXCOM_RFXtrx433XL_XXXXXXXX-if00-port0:38400 8DATABITS NONE 1STOPBIT
```

### Avec socat (pour un test rapide)

```bash
socat TCP-LISTEN:4001,reuseaddr,fork FILE:/dev/serial/by-id/usb-RFXCOM_RFXtrx433XL_XXXXXXXX-if00-port0,b38400,raw,echo=0
```

> La passerelle n'a **pas de mot de passe** : qui joint le port pilote vos
> appareils radio. Gardez-la sur votre réseau local, ne l'ouvrez jamais sur
> Internet. Un seul programme à la fois peut parler au RFXtrx : arrêtez
> Domoticz, Home Assistant ou RFXmngr s'ils l'utilisent (`kickolduser` donne la
> main à la dernière connexion).

## 2. Configurer l'intégration

| Champ                 | Quoi mettre                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Hôte de la passerelle | L'IP de la machine de ser2net. Pour la machine de Gladys elle-même, son **IP sur le réseau local** : `localhost` désigne le conteneur.     |
| Port TCP              | `4001` dans les exemples ci-dessus.                                                                                                        |
| Protocoles reçus      | Rien de coché : le RFXtrx garde ses réglages (faits avec RFXmngr). Sinon, les protocoles cochés sont envoyés au RFXtrx à chaque connexion. |
| Signal minimum        | 0 propose tout. 3 ou 4 écarte des nouveaux appareils les émetteurs lointains (les sondes des voisins).                                     |
| Actionneurs           | Les récepteurs pilotés par le RFXtrx — voir la partie 4.                                                                                   |

Le statut de connexion affiche le modèle de récepteur, le firmware et les
protocoles reçus. Le bouton **Tester la connexion** interroge à nouveau le
RFXtrx et donne son temps de réponse.

Les protocoles cochés ne sont **pas enregistrés** dans la mémoire du RFXtrx
(elle supporte un nombre limité d'écritures) : l'intégration les renvoie à
chaque connexion. N'activez que ce que vous utilisez, le récepteur entend
mieux : AC pour Chacon DiO, Oregon pour les sondes et OWL, Visonic pour les
détecteurs Visonic, X10, ARC pour les télécommandes à molettes, Blyss…

## 3. Ce qui est entendu : onglet Découverte

Rien à déclarer : dès que le RFXtrx entend un émetteur, il apparaît dans
l'onglet **Découverte**. Créez ceux qui sont à vous ; les valeurs et les
déclencheurs de scène ne vont qu'aux appareils créés. La liste est conservée
dans `/data` à travers les redémarrages.

- **Sondes Oregon Scientific et compatibles** (THGR122, THGN132, THGR810,
  BTHR968, PCR800, WGR800, UVN800…) : température, humidité, pression, pluie
  (cumul et intensité), vent (direction, vitesse, rafales), UV.
- **Compteurs OWL** : puissance et index d'énergie (kWh) du CM119/CM160 et du
  CM180, courant par phase et énergie du CM180i, courants du CM113.
- **Détecteurs Security1** : ouverture (X10, Visonic PowerCode), mouvement
  (X10, Visonic, Meiantech) et fumée (KD101, SA30, RM174RF), avec
  l'autoprotection. Les détecteurs de mouvement et de fumée n'envoient jamais
  « c'est fini » : leur état revient à 0 après 90 secondes.
- **Télécommandes, interrupteurs muraux et porte-clés** (Chacon DiO /
  KlikAanKlikUit, HomeEasy, X10, ARC, Blyss, LightwaveRF, X10 security,
  Visonic CodeSecure) : une fonctionnalité **bouton** par bouton entendu
  (`1`, `2`… ; `group` pour les ordres de groupe ; `all` en X10 ; `K4` en
  Blyss ; `alarm` sur un porte-clés). Sa valeur est l'ordre reçu (marche,
  arrêt, armer, désarmer, panique…).

Chaque capteur a la **pile** (en %, de 10 à 100 ; les sondes Oregon ne
connaissent que « bonne » 100 % et « faible » 10 %) et le **signal** (0 à 5).
Une sonde silencieuse depuis une heure est marquée injoignable.

Les sondes Oregon tirent une nouvelle adresse à chaque changement de piles :
la sonde réapparaît comme un nouvel appareil dans Découverte.

### Déclencheur de scène

**Une télécommande RFXCOM est actionnée** : filtrez sur la télécommande, le
bouton et l'ordre. Variables : bouton, ordre, niveau (%), protocole, adresse.
Un même appui répété par la télécommande ne déclenche qu'une fois.

## 4. Ce qui est piloté : les actionneurs

Un récepteur (prise, module d'éclairage, moteur de volet) ne se découvre pas
par les ondes : il faut le déclarer. Le plus simple est le bouton **Appairer
un actionneur** :

1. mettez le récepteur en mode apprentissage : bouton maintenu sur une prise
   Chacon DiO (ou mise sous tension), **PROG maintenu sur la télécommande
   d'origine d'un volet Somfy RTS jusqu'à ce qu'il bouge un peu** ;
2. indiquez un nom, le type, le protocole, et laissez l'adresse vide : une
   adresse libre est choisie ;
3. lancez l'action : le RFXtrx envoie la trame d'appairage (« marche », ou
   « program » en Somfy RTS) et le récepteur est ajouté au champ
   **Actionneurs**. Créez-le depuis l'onglet **Découverte**.

| Type      | Ce qu'il fait                                                             |
| --------- | ------------------------------------------------------------------------- |
| `switch`  | Marche / arrêt.                                                           |
| `light`   | Marche / arrêt, affiché comme une lampe.                                  |
| `dimmer`  | Marche / arrêt et luminosité (AC / Chacon DiO, HomeEasy EU, LightwaveRF). |
| `shutter` | Ouvrir / stop / fermer (Somfy RTS, protocoles RFY et RFYEXT).             |

Vous pouvez aussi remplir le champ à la main, entrées séparées par `;` :

```
Volet salon = shutter RFY 10203/1; Lampe bureau = dimmer AC 1A2B3C4/2; Entrée = switch X10 A3
```

| Protocoles                                                 | Adresse                                           |
| ---------------------------------------------------------- | ------------------------------------------------- |
| AC, HOMEEASY_EU, ANSLUT                                    | `identifiant/unité`, ex. `1A2B3C4/1` (0 = groupe) |
| RFY, RFYEXT (Somfy RTS)                                    | `identifiant/unité`, ex. `10203/1`                |
| LIGHTWAVERF, CONRAD, EMW100, BBSB, EURODOMEST, IT, KANGTAI | `identifiant/unité`, ex. `F09AC8/1`               |
| BLYSS                                                      | `identifiant/groupe/unité`, ex. `F09A/A/1`        |
| X10, ARC, CHACON, ELRO, WAVEMAN…                           | `maison+unité`, ex. `A3`, réglée sur le récepteur |

**Piloter un récepteur déjà appairé à votre télécommande** : déclarez
l'actionneur avec l'adresse de cette télécommande (affichée dans les
paramètres de son appareil : l'adresse `39AC7A1` et le bouton `1` donnent
`39AC7A1/1`), en décochant « Envoyer la trame d'appairage ». Quand vous
utilisez la télécommande, l'état de l'actionneur suit dans Gladys.

**Somfy RTS** : le RFXtrx433E ou 433XL joue une télécommande virtuelle dont il
garde le code tournant ; il faut l'appairer une fois par volet (étape 1
ci-dessus). Stop est le bouton « my » : il arrête un volet en mouvement et
envoie un volet immobile à sa position favorite. Le RFXtrx433 d'origine (sans
E) n'émet pas en RFY.

Les ordres radio ne sont jamais confirmés par le récepteur : Gladys affiche ce
qui a été envoyé.

## En cas de problème

- **« a refusé la connexion »** : ser2net ne tourne pas, ou pas sur ce port
  (`systemctl status ser2net`).
- **« la passerelle répond, mais pas le RFXtrx »** : le port de ser2net est
  ouvert mais le RFXtrx ne répond pas — débranché, mauvais chemin de
  périphérique, mauvaise vitesse (il faut 38400), ou un autre programme
  l'utilise.
- **« a fermé la connexion »** : un autre programme a pris la main sur ser2net
  (`kickolduser`).
- **Une télécommande ou une sonde n'apparaît pas** : son protocole est-il reçu
  (statut de connexion) ? Le signal minimum est-il trop haut ?
- **Trop d'appareils dans Découverte** : montez le signal minimum, ne cochez
  que les protocoles utiles.
- **Un volet Somfy ne bouge pas** : il doit être appairé une fois, PROG
  maintenu sur sa télécommande au moment de l'appairage.

Pas encore pris en charge : les autres moteurs de volets (Blinds1), les
carillons, les thermostats, Lighting4 (PT2262), les compteurs Linky / TIC
Cartelectronic et les modèles 868 MHz. Dites-nous ce qui vous manque sur le
[forum Gladys](https://community.gladysassistant.com/).
