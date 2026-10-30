import json,time,urllib.request,urllib.parse
UA={"User-Agent":"cine-idf/1.0 (personal app; contact mathislucas887@gmail.com)"}
def get(u):
    return json.load(urllib.request.urlopen(urllib.request.Request(u,headers=UA),timeout=30))
# (name, type, nominatim query, pathe slug, wikipedia title)
C=[
("Pathé Aéroville","pathe","Pathé Aéroville, Tremblay-en-France","cinema-pathe-aeroville",None),
("Pathé Alésia","pathe","Pathé Alésia, 73 avenue du Général Leclerc, Paris","cinema-pathe-alesia",None),
("Pathé Aquaboulevard","pathe","Pathé Aquaboulevard, rue du Colonel Pierre Avia, Paris","cinema-pathe-aquaboulevard",None),
("Pathé Beaugrenelle","pathe","Pathé Beaugrenelle, 7 rue Linois, Paris","cinema-pathe-beaugrenelle","Pathé Beaugrenelle"),
("Pathé Belle Épine","pathe","Pathé Belle Épine, Thiais","cinema-pathe-belle-epine",None),
("Pathé BNP Paribas","pathe","Pathé BNP Paribas, 32 rue Louis-le-Grand, Paris","cinema-pathe-bnp-paribas",None),
("Pathé Boulogne","pathe","Pathé Boulogne, 26 cours de l'Île Seguin, Boulogne-Billancourt","cinema-pathe-boulogne",None),
("Pathé Île Seguin","pathe","Seine Musicale, Boulogne-Billancourt","cinema-pathe-ile-seguin",None),
("Pathé Carré Sénart","pathe","Pathé Carré Sénart, Lieusaint","cinema-pathe-carre-senart",None),
("Pathé Conflans","pathe","Pathé Conflans, Conflans-Sainte-Honorine","cinema-pathe-conflans",None),
("Pathé Convention","pathe","Pathé Convention, 27 rue Alain Chartier, Paris","cinema-pathe-convention",None),
("Pathé Dammarie","pathe","824 avenue du Lys, Dammarie-les-Lys","cinema-pathe-dammarie",None),
("Pathé La Villette","pathe","Pathé La Villette, 30 avenue Corentin Cariou, Paris","cinema-pathe-la-villette",None),
("Pathé Les Fauvettes","pathe","Pathé Les Fauvettes, 58 avenue des Gobelins, Paris","cinema-pathe-les-fauvettes","Cinéma des Fauvettes"),
("Pathé Levallois","pathe","Pathé Levallois, Levallois-Perret","cinema-pathe-levallois",None),
("Pathé Massy","pathe","Pathé Massy, Massy","cinema-pathe-massy",None),
("Pathé Montparnos","pathe","Pathé Montparnos, 16 rue d'Odessa, Paris","cinema-pathe-montparnos",None),
("Pathé Palace","pathe","Pathé Palace, 2 boulevard des Capucines, Paris","cinema-pathe-palace","Gaumont Opéra"),
("Pathé Parnasse","pathe","Pathé Parnasse, 11 rue du Départ, Paris","cinema-pathe-parnasse",None),
("Pathé Quai d'Ivry","pathe","Pathé Quai d'Ivry, Ivry-sur-Seine","cinema-pathe-quai-d-ivry",None),
("Pathé Saint-Denis","pathe","Pathé Saint-Denis, Saint-Denis Stade de France","cinema-pathe-saint-denis",None),
("Pathé Wepler","pathe","Pathé Wepler, 140 boulevard de Clichy, Paris","cinema-pathe-wepler","Pathé Wepler"),
("La Géode","pathe","La Géode, 26 avenue Corentin Cariou, Paris","cinema-pathe-la-geode","La Géode"),
("Gaumont Disney Village","pathe","Gaumont Disney Village, Chessy","cinema-gaumont-disney-village",None),
("Les 7 Batignolles","pathe","Les 7 Batignolles, 25 allée Colette Heilbronner, Paris",None,None),
("3 Cinés Robespierre","partner","3 Cinés Robespierre, Vitry-sur-Seine",None,None),
("4 Delta","partner","Cinéma 4 Delta, Jouy-le-Moutier",None,None),
("5 Caumartin","partner","Cinq Caumartin, 101 rue Saint-Lazare, Paris",None,None),
("7 Parnassiens","partner","Les 7 Parnassiens, 98 boulevard du Montparnasse, Paris",None,"Les 7 Parnassiens"),
("Balzac","partner","Cinéma Le Balzac, 1 rue Balzac, Paris",None,"Le Balzac (cinéma)"),
("Chaplin Denfert","partner","Chaplin Denfert, 24 place Denfert-Rochereau, Paris",None,None),
("Chaplin Saint-Lambert","partner","Chaplin Saint-Lambert, 6 rue Péclet, Paris",None,None),
("Christine Cinéma Club","partner","Christine Cinéma Club, 4 rue Christine, Paris",None,None),
("Ciné Massy","partner","Ciné Massy, Massy",None,None),
("Cinéma des Cinéastes","partner","Cinéma des Cinéastes, 7 avenue de Clichy, Paris",None,"Cinéma des Cinéastes"),
("Cinéma du Panthéon","partner","Cinéma du Panthéon, 13 rue Victor Cousin, Paris",None,"Cinéma du Panthéon"),
("Cinéma Landowski","partner","Cinéma Landowski, Boulogne-Billancourt",None,None),
("Cinéma Mac-Mahon","partner","Cinéma Mac-Mahon, 5 avenue Mac-Mahon, Paris",None,"Mac-Mahon (cinéma)"),
("Écoles Cinéma Club","partner","Écoles Cinéma Club, 23 rue des Écoles, Paris",None,None),
("Elysées Lincoln","partner","Elysées Lincoln, 14 rue Lincoln, Paris",None,None),
("Épée de Bois","partner","Cinéma Épée de Bois, 100 rue Mouffetard, Paris",None,None),
("Espace 1789","partner","Espace 1789, Saint-Ouen-sur-Seine",None,None),
("Espace Saint-Michel","partner","Espace Saint-Michel, 7 place Saint-Michel, Paris",None,"Espace Saint-Michel"),
("Filmothèque du Quartier Latin","partner","Filmothèque du Quartier Latin, 9 rue Champollion, Paris",None,"Filmothèque du Quartier latin"),
("La Pléiade","partner","Cinéma La Pléiade, Cachan",None,None),
("Le Brady","partner","Le Brady, 39 boulevard de Strasbourg, Paris",None,"Le Brady"),
("Le Capitole","partner","Cinéma Le Capitole, Suresnes",None,None),
("Le Grand Action","partner","Le Grand Action, 5 rue des Écoles, Paris",None,"Grand Action"),
("Le Jeu de Paume","partner","Cinéma Jeu de Paume, Île-de-France",None,None),
("Le Lido","partner","Cinéma Le Lido, Île-de-France",None,None),
("Le Lucernaire","partner","Le Lucernaire, 53 rue Notre-Dame-des-Champs, Paris",None,"Lucernaire"),
("Le Saint-André des Arts","partner","Saint-André des Arts, 30 rue Saint-André-des-Arts, Paris",None,"Saint-André-des-Arts (cinéma)"),
("L'Écran de Saint-Denis","partner","L'Écran, place du Caquet, Saint-Denis",None,None),
("L'Entrepôt","partner","L'Entrepôt, 7 rue Francis de Pressensé, Paris",None,"L'Entrepôt (cinéma)"),
("Les 3 Luxembourg","partner","Les 3 Luxembourg, 67 rue Monsieur-le-Prince, Paris",None,None),
("Les 3 Pierrots","partner","Les 3 Pierrots, Saint-Cloud",None,None),
("Les Capucins","partner","Cinéma Les Capucins, Île-de-France",None,None),
("Luminor Hôtel de Ville","partner","Luminor Hôtel de Ville, 20 rue du Temple, Paris",None,"Luminor Hôtel de Ville"),
("Max Linder Panorama","partner","Max Linder Panorama, 24 boulevard Poissonnière, Paris",None,"Max Linder Panorama"),
("Nouvel Odéon","partner","Nouvel Odéon, 6 rue de l'École de Médecine, Paris",None,None),
("Publicis Cinémas","partner","Publicis Cinémas, 129 avenue des Champs-Élysées, Paris",None,"Publicis Cinémas"),
("Studio des Ursulines","partner","Studio des Ursulines, 10 rue des Ursulines, Paris",None,"Studio des Ursulines"),
("L'Archipel","partner","L'Archipel, 17 boulevard de Strasbourg, Paris",None,None),
("Majestic Bastille","partner","Majestic Bastille, 4 boulevard Richard-Lenoir, Paris",None,None),
("Majestic Passy","partner","Majestic Passy, 18 rue de Passy, Paris",None,None),
("L'Escurial Panorama","partner","Escurial, 11 boulevard de Port-Royal, Paris",None,"Escurial (cinéma)"),
("Les Reflets Médicis","partner","Reflet Médicis, 3 rue Champollion, Paris",None,"Reflet Médicis"),
("L'Arlequin","partner","Cinéma L'Arlequin, 76 rue de Rennes, Paris",None,"L'Arlequin (cinéma)"),
("Saint-Germain-des-Prés","partner","Cinéma Saint-Germain-des-Prés, 22 rue Guillaume Apollinaire, Paris",None,None),
]
VB="1.4,49.25,3.6,48.1"
out=[]
for name,typ,q,slug,wt in C:
    r=get("https://nominatim.openstreetmap.org/search?"+urllib.parse.urlencode({"q":q,"format":"json","limit":1,"addressdetails":1,"viewbox":VB,"bounded":1,"countrycodes":"fr"}))
    time.sleep(1.1)
    if not r:
        r=get("https://nominatim.openstreetmap.org/search?"+urllib.parse.urlencode({"q":q.split(",")[0]+" cinéma","format":"json","limit":1,"addressdetails":1,"viewbox":VB,"bounded":1}));time.sleep(1.1)
    e={"id":(slug or name).lower().replace(" ","-"),"name":name,"type":typ,"patheSlug":slug,"query":q}
    if r:
        a=r[0];ad=a.get("address",{})
        e.update(lat=float(a["lat"]),lng=float(a["lon"]),osmName=a.get("name"),
          address=" ".join(x for x in [ad.get("house_number",""),ad.get("road","")] if x).strip(),
          zip=ad.get("postcode",""),city=ad.get("city") or ad.get("town") or ad.get("village",""),geoclass=a["class"]+"/"+a["type"])
    photo=None
    if wt:
        try:
            p=get("https://fr.wikipedia.org/w/api.php?"+urllib.parse.urlencode({"action":"query","titles":wt,"prop":"pageimages","piprop":"original|name","format":"json","redirects":1}))
            for pg in p["query"]["pages"].values():
                if "original" in pg:
                    photo={"url":pg["original"]["source"].split("?")[0],"credit":"Wikimedia Commons","source":"https://commons.wikimedia.org/wiki/File:"+pg.get("pageimage","")}
        except Exception as ex: print("wp",ex)
    if not photo:
        try:
            s=get("https://commons.wikimedia.org/w/api.php?"+urllib.parse.urlencode({"action":"query","list":"search","srsearch":q.split(",")[0]+" cinéma","srnamespace":6,"srlimit":3,"format":"json"}))
            hits=[h["title"] for h in s["query"]["search"] if h["title"].lower().endswith((".jpg",".jpeg",".png"))]
            if hits:
                t=hits[0]
                ii=get("https://commons.wikimedia.org/w/api.php?"+urllib.parse.urlencode({"action":"query","titles":t,"prop":"imageinfo","iiprop":"url","iiurlwidth":800,"format":"json"}))
                for pg in ii["query"]["pages"].values():
                    inf=pg["imageinfo"][0]
                    photo={"url":inf.get("thumburl",inf["url"]),"credit":"Wikimedia Commons","source":inf["descriptionurl"],"title":t,"auto":True}
        except Exception as ex: print("cm",ex)
    e["photo"]=photo
    print(name,"|",e.get("osmName"),e.get("city"),e.get("geoclass"),"|",photo and photo.get("title",photo["url"][-50:]))
    out.append(e)
json.dump(out,open("data/cinemas_raw.json","w"),ensure_ascii=False,indent=1)
