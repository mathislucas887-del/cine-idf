import json,urllib.request,urllib.parse,time
D=json.load(open("data/cinemas_raw.json"))
ADDR={
"Pathé Aéroville":"30 rue des Buissons 95700 Roissy-en-France","Pathé Alésia":"73 avenue du Général Leclerc 75014 Paris",
"Pathé Aquaboulevard":"8 rue du Colonel Pierre Avia 75015 Paris","Pathé Beaugrenelle":"7 rue Linois 75015 Paris",
"Pathé Belle Épine":"Centre Commercial Belle Épine 94320 Thiais","Pathé BNP Paribas":"38 boulevard des Italiens 75009 Paris",
"Pathé Boulogne":"26 rue le Corbusier 92100 Boulogne-Billancourt","Pathé Île Seguin":"2 île Seguin 92100 Boulogne-Billancourt",
"Pathé Carré Sénart":"3 allée du Préambule 77127 Lieusaint","Pathé Conflans":"ZA les Boutries 78700 Conflans-Sainte-Honorine",
"Pathé Convention":"27 rue Alain Chartier 75015 Paris","Pathé Dammarie":"824 avenue du Lys 77190 Dammarie-les-Lys",
"Pathé La Villette":"30 avenue Corentin Cariou 75019 Paris","Pathé Les Fauvettes":"58 avenue des Gobelins 75013 Paris",
"Pathé Levallois":"28 rue d'Alsace 92300 Levallois-Perret","Pathé Massy":"21 place du Grand Ouest 91300 Massy",
"Pathé Montparnos":"16 rue d'Odessa 75014 Paris","Pathé Palace":"2 boulevard des Capucines 75009 Paris",
"Pathé Parnasse":"3 rue d'Odessa 75014 Paris","Pathé Quai d'Ivry":"5 rue François Mitterrand 94200 Ivry-sur-Seine",
"Pathé Saint-Denis":"8 rue du Mondial 98 93210 Saint-Denis","Pathé Wepler":"140 boulevard de Clichy 75018 Paris",
"La Géode":"26 avenue Corentin Cariou 75019 Paris","Gaumont Disney Village":"Esplanade François Truffaut 77700 Chessy",
"Les 7 Batignolles":"86 rue Mstislav Rostropovitch 75017 Paris",
"3 Cinés Robespierre":"19 avenue Robespierre 94400 Vitry-sur-Seine","4 Delta":"81 ter avenue du Bac 94210 Saint-Maur-des-Fossés",
"5 Caumartin":"101 rue Saint-Lazare 75009 Paris","7 Parnassiens":"98 boulevard du Montparnasse 75014 Paris",
"Balzac":"1 rue Balzac 75008 Paris","Chaplin Denfert":"24 place Denfert-Rochereau 75014 Paris","Chaplin Saint-Lambert":"6 rue Péclet 75015 Paris",
"Christine Cinéma Club":"4 rue Christine 75006 Paris","Ciné Massy":"Place de France 91300 Massy","Cinéma des Cinéastes":"7 avenue de Clichy 75017 Paris",
"Cinéma du Panthéon":"13 rue Victor Cousin 75005 Paris","Cinéma Landowski":"28 avenue André Morizet 92100 Boulogne-Billancourt",
"Cinéma Mac-Mahon":"5 avenue Mac-Mahon 75017 Paris","Écoles Cinéma Club":"23 rue des Écoles 75005 Paris","Elysées Lincoln":"14 rue Lincoln 75008 Paris",
"Épée de Bois":"100 rue Mouffetard 75005 Paris","Espace 1789":"2 rue Alexandre Bachelet 93400 Saint-Ouen-sur-Seine",
"Espace Saint-Michel":"7 place Saint-Michel 75005 Paris","Filmothèque du Quartier Latin":"9 rue Champollion 75005 Paris",
"La Pléiade":"12 avenue Cousin de Méricourt 94230 Cachan","Le Brady":"39 boulevard de Strasbourg 75010 Paris","Le Capitole":"3 rue Ledru-Rollin 92150 Suresnes",
"Le Grand Action":"5 rue des Écoles 75005 Paris","Le Jeu de Paume":"1 place de la Concorde 75008 Paris","Le Lido":"70 avenue de la République 94100 Saint-Maur-des-Fossés",
"Le Lucernaire":"53 rue Notre-Dame-des-Champs 75006 Paris","Le Saint-André des Arts":"30 rue Saint-André-des-Arts 75006 Paris",
"L'Écran de Saint-Denis":"14 passage de l'Aqueduc 93200 Saint-Denis","L'Entrepôt":"7 rue Francis de Pressensé 75014 Paris",
"Les 3 Luxembourg":"67 rue Monsieur-le-Prince 75006 Paris","Les 3 Pierrots":"6 rue du Mont Valérien 92210 Saint-Cloud",
"Les Capucins":"23 rue Marcel Clavier 77120 Coulommiers","Luminor Hôtel de Ville":"20 rue du Temple 75004 Paris",
"Max Linder Panorama":"24 boulevard Poissonnière 75009 Paris","Nouvel Odéon":"6 rue de l'École de Médecine 75006 Paris",
"Publicis Cinémas":"129 avenue des Champs-Élysées 75008 Paris","Studio des Ursulines":"10 rue des Ursulines 75005 Paris",
"L'Archipel":"17 boulevard de Strasbourg 75010 Paris","Majestic Bastille":"4 boulevard Richard-Lenoir 75011 Paris",
"Majestic Passy":"18 rue de Passy 75016 Paris","L'Escurial Panorama":"11 boulevard de Port-Royal 75013 Paris",
"Les Reflets Médicis":"3 rue Champollion 75005 Paris","L'Arlequin":"76 rue de Rennes 75006 Paris",
"Saint-Germain-des-Prés":"22 rue Guillaume Apollinaire 75006 Paris"}
# keep OSM point (exact building) when it is a cinema near the official address; else use BAN
BADPHOTO={"Pathé Boulogne","Pathé Convention","Pathé Les Fauvettes","Pathé Saint-Denis","Pathé Wepler","4 Delta","Cinéma Landowski","Le Jeu de Paume","L'Écran de Saint-Denis","L'Entrepôt","Les Capucins","Nouvel Odéon","Publicis Cinémas","L'Archipel"}
import math
def ban(a):
    r=json.load(urllib.request.urlopen("https://api-adresse.data.gouv.fr/search/?"+urllib.parse.urlencode({"q":a,"limit":1})))
    f=r["features"][0]; return f["geometry"]["coordinates"][1],f["geometry"]["coordinates"][0],f["properties"]["score"]
for e in D:
    a=ADDR[e["name"]]; e["fullAddress"]=a
    import re; m=re.search(r"(\d{5}) (.+)$",a); e["zip"],e["city"]=m.group(1),m.group(2); e["address"]=a[:m.start()].strip()
    la,lo,sc=ban(a)
    keep=False
    if "lat" in e and e.get("geoclass","").endswith("cinema"):
        d=math.hypot((e["lat"]-la)*111,(e["lng"]-lo)*73)
        keep=d<0.6
    if not keep: e["lat"],e["lng"]=la,lo
    e["geoSource"]="OpenStreetMap (Nominatim)" if keep else "Base Adresse Nationale"
    if e["name"]=="Pathé Dammarie": e["lat"],e["lng"],e["geoSource"]=48.5174876,2.625611,"API Pathé"
    if e["name"]=="Ciné Massy": pass
    if e["name"] in BADPHOTO: e["photo"]=None
    for k in ("query","osmName","geoclass"): e.pop(k,None)
    e["cinepass"]=True
    e["group"]="Les Cinémas Pathé" if e["type"]=="pathe" else "Cinéma indépendant partenaire"
    e["website"]=("https://www.pathe.fr/cinemas/"+e["patheSlug"]) if e.get("patheSlug") else None
    print(e["name"],round(e["lat"],5),round(e["lng"],5),e["geoSource"],sc,bool(e["photo"]))
json.dump(D,open("data/cinemas.json","w"),ensure_ascii=False,indent=1)
