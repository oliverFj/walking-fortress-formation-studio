# Walking Fortress · Formationsstudio

Et selvstændigt forsøgsrum til formationsfelter på et 3D-terræn med soldater som animerede 2D-sprites. Felterne bestemmer formationernes plads og bevægelse. Figurerne er visuel feedback og har ingen individuelle ordrer eller sammenstød.

## Dokumentation til videre arbejde

[DEVELOPMENT.md](DEVELOPMENT.md) beskriver arkitektur, dataflow, gemte studier, ændringssteder og udviklingskontroller. [AGENTS.md](AGENTS.md) indeholder arbejdsregler for kommende sessions. [Billeder og genbygning](assets/README.md) beskriver spriteformatet, normaldata, piker og Blender-kilder.

Denne mappe er sit eget Git-lager med `main` som første gren. Kode og færdige runtimebilleder følger med; en kopi af lageret kan starte studiet uden adgang til den oprindelige arbejdsmappe. Blender-kilder og Sprite Studios byggeværktøjer ligger uden for lageret og bruges kun ved genbygning. Genererede kontrolbilleder, kontrolrapporter, lokale studiefiler, logfiler og Python-cache ignoreres af Git. Der er ikke oprettet et fjernlager.

## Start

Dobbeltklik på **Start_Formationsstudio.cmd**. Studiet åbner på **http://127.0.0.1:8766**. Lad tjenestens vindue stå åbent; stop med Ctrl+C. Kræver Python 3.10 eller nyere og en browser med WebGL 2, eksempelvis Chrome eller Edge. Ingen installation af billedbiblioteker, Blender eller API-nøgle er nødvendig for at bruge studiet.

Hvis tjenesten allerede kører, kan adressen åbnes direkte. Sprite Studio bruger en anden port og kan køre samtidig.

## Figurer og animationer

Åbn **Animationsbibliotek** i den nye fane. Vælg en korrekt opsat `.blend`-fil, eller indsæt dens sti, og tryk **Find animationer**. Programmet finder riggen, figurens meshes og de animationer, der er knyttet til den. Animationerne vises før rendering; gamle eller uønskede actions kan fravælges. Andre poser end gang og stilstand kan også ligge i biblioteket og afspilles i forhåndsvisningen.

**Render & tilføj til bibliotek** fremstiller alle valgte animationer i 16 retninger, med fælles målestok og fodanker, farvebilleder, konturer og matchende normalkort. Udgangspunktet er 6 billeder pr. sekund fra kildens fulde animationsinterval, 256 px rå billeder og 100 px til visningen. Store serier fordeles over flere billedark. Fremdrift og afbrydelse findes i samme fane.

Piken er det særskilte element fra Sprite Studio: den følger det valgte pikeobjekt og kan justeres med greb, endepunkter, skaftmål, spidsmål og konturer. Under bibliotekets forhåndsvisning kan **Mørkhed**, **Dækevne** og **Bredde** ændres direkte for pikerne. Dækevne 100 % bevarer den nuværende gennemsigtighed; højere værdier gør de bløde kanter mere dækkende. **Gem pikeudseende** gemmer valget på figurversionen og opdaterer den, hvis den er i brug i formationerne. Det kræver ingen ny Blender-rendering. Musketerens 3D-musket indgår i figurens billeder og normalkort. Den følger våbnets knogle i Blender.

Hver færdig rendering bliver en ny version i biblioteket; originale `.blend`-filer og tidligere renderinger bevares. Ret animationerne i Blender, gem filen og render igen for at få en ny version. Vælg en version som **Pikener** eller **Musketer** for at bruge den i formationerne. Den aktive figur skal have både en stilstands- og en ganganimation. Formationernes scene og lysindstillinger bevares ved figurskifte.

Biblioteket og færdige sprites er lokale. Nye renderinger kræver en tilgængelig Blender-installation samt de lokale billedværktøjer; almindelig brug af Formationsstudio kræver fortsat kun Python og en WebGL 2-browser. Tjenesten downloader ingen programmer ved start.

## Det første forsøg

1. Vælg en fænnike i listen eller ved at klikke på dens felt. Klik på jorden for at sætte et rutepunkt; Shift + klik tilføjer flere. Hvert punkt viser den ønskede opstilling med fire hjørnegreb. Træk et greb for at dreje opstillingen.
2. Justér styrke, filer i fronten og afstande. Vælg slagorden eller marchkolonne. Den ønskede form vises med stiplede kanter; den aktuelle form ændrer sig gradvist.
3. Vælg **Drejeanker**: automatisk inderste fronthjørne, centrum, venstre front eller højre front. **Drej** giver en ren vending. **Holdt** annullerer march, vending og rutepunkter.
4. Under **Terræn** kan du vælge fladt land, hældning, bakkekam og en 8 m bred passage. En for bred slagorden standser; omform til kolonne. Formationer venter også, når andre optager pladsen. Der er ingen automatisk omvejssøgning.
5. Under **Visning** kan du vælge soldater, felter eller begge. Antallet af tegnede soldater fordeles mellem fænnickerne og ændrer aldrig troppestyrken eller bevægelsen.
6. Fjern 10 eller 25 procent for at afprøve tab: behold huller, indsnævr fronten eller reducer geledderne.

Skyttefløje er særskilte felter på hver side af pikekernen. I kolonne følger de efter pikenererne. De viser nu den nye **Musketeer** med musket, mens pikekernen bruger **Pikeman** med pike. Hver soldat får en stabil animationsvariant. Alle fænniker følger én fælles marchtakt. En ny marchordre spiller først en kort afmarchordre på tromme. Tropperne venter på dens afslutning og det næste fælles fodnedslag, før de bevæger sig; tempoet er det samme ved langsom gang, almindelig gang og løb. Soldaterne beholder en fast individuel forskydning på op til ±4 procent af animationscyklussen. Stilstandsanimationer beholder individuel tempovariation. Den faktiske bevægelse i soldatens plads vælger mellem langsom gang, almindelig gang og løb. Under en vending går indersiden langsommere, mens ydersiden kan løbe. Det ændrer kun billederne og giver ingen enkeltfigur egne bevægelsesordrer.

**Højreklik uden træk** afmarkerer fænniken. **Højre træk** drejer kameraet; **midtertræk** eller **Alt + træk** flytter udsnittet; **musehjul** zoomer. **Home** viser overblikket. **Mellemrum** pauser eller afspiller. Knappen **+ ½ s** går frem i små skridt, mens forsøget er sat på pause.

**Lyd: til** ved afspilningsknapperne giver optagede støvletrin på grus og felttrommer fra det tidligere Walking Fortress. Ti isolerede trin giver gang- og løbevariation; mange trin blandes i stereo efter formationens fulde styrke, med selvstændige forskelle i tidspunkt, tonehøjde, styrke og klangfarve. Fælles nedslag følger frame 6 og 30 i originalens 48-frame-cyklus, med lidt spredning som soldaternes animationer. Hver marcherende fænnike har egne støvletrin og felttrommer. Begge lydspor følger den fælles takt med en fast, lille forskydning på op til 45 ms pr. fænnike; flere regimenter giver mere lydfylde. Trommemønsteret afhænger ikke af, hvilken fænnike der er valgt. Afmarch og ankomst har egne trommeordrer fra version 0.1, lagt på den fælles takt. På det sidste stykke mod rutens endelige mål spiller en stopordre; meget korte ture kan gå lidt langsommere, så ordren bliver færdig før stilstand. Under ordren viger kun regimentets almindelige marchtrommer, mens de øvrige regimenter fortsætter. Kameraets zoom og udsnit styrer lydstyrke, panorering og hvor tydelige detaljerne er; fjerne tropper dæmpes og får lidt mere rumhale. Lyden stopper ved pause, holdt eller skjult fane. Justér samlet lydstyrke og **Trommer** under **Visning → Marchlyd**. Begge skydere er hævet: 50 % svarer til det tidligere 100 %, og resten giver ekstra lydstyrke. Lyden er slukket ved start; de medfølgende lydfiler kræver ingen netforbindelse.

## Marchmetoden

Formationens rutepunkter udføres i rækkefølge. Den ankommer og færdiggør punktets ønskede retning, før den går videre. Et almindeligt klik erstatter ruten. En marchordre færdiggør først en eventuel omformning, drejer formationen om det valgte anker og marcherer derefter lige mod målet. Ankeret står fast i landskabet under vendingen og vises med en ring, når formationsfelterne er synlige. **Automatisk** vælger det inderste fronthjørne. Ved helt nære marchmål bruges centrum for at undgå en stor svingbue. Den ønskede drejehastighed begrænses, så det yderste punkt højst bevæger sig 3 m/s; derfor tager en stor formation længere tid om at vende. Alle fænniker bevarer den fælles takt med soldaternes små individuelle forskydninger, også når deres gang- eller løbevariant skifter.

Metoden er inspireret af reglerne for hjuldrejning, hvor indersiden tager kortere skridt og ydersiden holder opstillingen, i det canadiske forsvars [eksercerreglement, kapitel 3, §§ 32 og 56–60](https://www.canada.ca/en/services/defence/caf/military-identity-system/drill-manual/chapter-3.html). [Kapitel 14, afsnit 4, §§ 15–16](https://www.canada.ca/en/services/defence/caf/military-identity-system/drill-manual/chapter-14.html) beskriver bands, hvor geledderne drejer efter hinanden på samme sted. Studiet drejer foreløbig hele formationen samlet; geledvis kolonnesving er endnu ikke implementeret. Dette er en geometrisk første model, ikke en historisk kalibrering.

## Gem forsøg

**Gem studie** downloader en JSON-fil og gemmer samtidig en kopi i denne browser. **Åbn** indlæser en fil og sætter forsøget på pause. Ved næste start åbnes browserens senest gemte studie. Gemningen bevarer den aktuelle omformning, marchmanøvre, drejeanker, fælles animationstakt og ventetid til næste nedslag, mål, rutepunkter og deres retninger, styrke, terræn, kameravinkel, visning og lys. Afmarkering og planlagte trommeordrer bevares også. **Ny prøve** starter et nyt standardforsøg; en tidligere downloadet fil kan stadig åbnes.

Ved terrænskifte flyttes kun formationer, hvis felter ligger i det nye terræns hindringer, til fri plads. Deres marchordrer stoppes, og en besked vises. Hvis ingen plads findes, afvises terrænskiftet uden at ændre scenen.

## Hvad studiet afklarer

Denne version kan undersøge formationers læsbarhed, march, vending, omformning og sprites på højdeforskelle. Den er et første forsøg med en selvstændig feltmodel. Kamp, morale, skydning, hærstyring og historisk kalibrering er senere studier.

Soldater og piker bruger de færdige Blender-eksporter: 16 kameraretninger, flere varianter af gang, løb og stilstand, fælles målestok og fodanker. Kameraets elevation er fast ca. 30 grader for at passe til billederne. Terrænet er en enkel arbejdsvisning.

Under **Lys** kan du justere solretning, solhøjde, skyggestyrke, skyggens udbredelse og blækfarve. Solen er fast i landskabet: både terræn og soldater bruger samme retning, uafhængigt af kameraet. Når en soldat vender sig, beregnes skyggen på de nye verdensvendte overflader. Lysindstillingerne gemmes med studiet; tidligere studiefiler får de manglende standardindstillinger.

**Streger & krydsskravering** er nu standarden. I kanten af skyggen tegnes få parallelle streger; længere inde kommer flere streger og til sidst krydsstreger. Basisfarven forbliver synlig mellem dem. Stregafstanden kan sænkes til 0,5 cm i trin på 0,1 cm, og stregbredden til 0,05 cm. Bredde og vinkel kan justeres, og **Krydsstreger fra skyggedybde** bestemmer, hvor tidligt krydsstregerne begynder. Lavere værdi giver flere krydsstreger. Afstanden angiver de tætteste streger; nær kanten bruges to eller fire gange afstanden. Udgangspunktet er 82 % skyggestyrke, 37 % udbredelse, sort blæk, 2,1 cm stregafstand, 1,25 cm bredde, 45° og krydsstreger fra 5 %. **Flade blækfelter** giver den tidligere fyldte skygge. **Gendan figurens skyggestil** gendanner disse standarder og figurens solretning/-højde.

Skraveringen er et mønster i billedplanet, forankret ved figurens fødder. Det glider derfor ikke hen over figuren, når kameraet flyttes. Normalkortet bestemmer, hvor skyggen falder og hvor tæt skraveringen bliver. Der kræves ingen ny Blender-eksport for at ændre stregerne.

Visningen anmoder om browserens antialiasing; på udviklingsmaskinen er 4× MSAA bekræftet. De beregnede streger og deres skyggekanter har også separat kantudjævning. På afstand filtreres stregerne til deres dækkede areal for at mindske flimren. Kroppenes konturer og piker filtreres også efter zoomniveauet, så tynde detaljer får stabil delvis dækning frem for at blinke ind og ud. Hver animationsframe filtreres separat, så nabobilleder i billedarket ikke blandes ind. Figurer på få skærmpixels kan derfor ikke vise hvert enkelt kryds. Runtimebilledernes 100 px sætter stadig grænsen for konturernes detalje ved kraftig indzoomning.

Kroppen bruger et farvebillede uden formskygge og et matchende normalkort for hver animationspose og kameraretning. Det giver lysafhængige skyggestreger med en ensartet blækfarve. Konturer og foldstreger er bevaret. De to modeller er `Musketeer.blend` og `Pikeman.blend` i arbejdsområdets `assets/musketeer/v2models/`. Kildeserierne ligger i `assets/musketeer/sprite_exports/V2_Musketeer_20261012/` og `V2_Pikeman_20261012/`; runtimeatlasserne har 100 px som nominel målestok. Originalerne i Blender er uændrede.

Kroppens formskygge suppleres af en enkel oval jordskygge under hver tegnet soldat. Den følger terrænet og bruger samme blæk og skraveringsindstillinger. Ovalen er en stiliseret kontaktflade; den beregner ikke figurens silhuet eller skygger på andre figurer. Pikerne er fortsat tegnede elementer med de gemte kropsmasker.

Piken er et særskilt, smalt spriteelement. Maskerne mod ejerens krop og hånd er indbygget. Overlap med andre soldater og terræn følger spritens billedplan og er en tilnærmelse. En fysisk pike i 3D er en oplagt efterfølgende prøve, især ved tætte rækker og vandrette piker.

Rendererens terræn er 3D; figurerne tegnes samlet som instanser af små billedflader. Det undgår animerede 3D-skeletter og store figurmodeller. Der er endnu ingen sammenlignende ydelsesmåling med 3D-figurer eller validering af fuld hærskala.

## Filer og adskillelse

- `model.mjs`: styrke, feltgeometri, march, gradvis omformning, tab, pladsbegrænsning og scenefiler. Kan køre uden browser eller grafiske assets.
- `march.mjs`: drejeankre og geometri for hjuldrejning.
- `terrain.mjs`: højder, passagehindringer og geometriske overlap.
- `renderer.mjs`: WebGL 2, terræn, formationsfelter, rutepunkter, drejegreb, sprites, piker, kamera og krops-/jordskygger.
- `audio.mjs`: optagede støvler, felttrommer, trommeordrer og kameraets lydmix.
- `drum-signals.mjs`: afmarch-/stopmønstre og varighed, delt mellem model og lyd.
- `lighting.mjs`: fælles solretning, koordinater og maskeberegning. Lys påvirker kun visningen.
- `main.mjs`, `index.html`, `studio.css`: den danske brugerflade og betjening.
- `assets/characters.json`: vælger Pikeman til pikekernen og Musketeer til skyttefelterne. Hver figur har egne atlasser og animationsmetadata i `assets/pikeman/` og `assets/musketeer/`. Se `assets/README.md`.
- `server.py`, `library_api.py`, `library_jobs.py`: lokal filserver, figurbibliotek og renderkø, kun på loopback. Der køres ingen gammel spilmotor.

Mappen kan flyttes samlet. Runtime importerer ingen kode eller billeder fra Sprite Studio eller den tidligere iteration. Figurbibliotekets renderhjælpere ligger også i denne mappe. `build_assets.py` er alene et værktøj til at genbygge atlasser fra en parret spriteeksport; det er ikke nødvendigt ved normal start. De tidligere billeder og metadata er bevaret som reference.

## Kontrol

Model-, animations- og lyskontroller: `node --test model.test.mjs march.test.mjs animation.test.mjs lighting.test.mjs`. Modelkontrollerne dækker uafhængighed af tegnetæthed, feltgeometri, passage, sammenstød, tab, scenegemning, terrænskifte, pladsmangel og animationstilstand. Animationskontrollerne dækker stabile varianter, ganghastighed og tidligere enkeltfigurdata. Lyskontrollerne dækker koordinater, normalrotation, verdensfast sol, hårde skyggeniveauer, indstillingsvalidering og gemte skraveringsindstillinger.

`checks/drum-orders.test.cjs` kontrollerer afmarch, ankomst, taktfaste signaler, aflysning, pause og de hævede lydskydere. `checks/shared-cadence.test.cjs` kontrollerer forskudte ordrer ved forskellige hastigheder, fælles animationstakt samt egne, let forskudte støvle- og trommespor pr. fænnike. `checks/waypoints.test.cjs` kontrollerer klik, Shift-ruter, hjørnedrejning, kamera/afmarkering, gemning og jordskygger. Browserkontrollen i `checks/browser.test.cjs` bruger Playwright og den installerede Chrome. Den kontrollerer opstart, grafik, visning, kamera, formationer, tab, marchordre, filgemning, lys- og skraveringsindstillinger og genindlæsning. Den er til udvikling og kræves ikke for brug. Resultat og skærmbilleder gemmes i `checks/`.

`checks/characters.test.cjs` kontrollerer de to figurer med rigtige atlasser: pike og musket, alle tre stilstandsvarianter, hastighedsgrupperne og alle 16 kameraretninger.


GPU-kontrollen `checks/lighting.test.cjs` kontrollerer konkrete pixelværdier, modsat front, kamerarotation, konturer, piker og terrænets fælles sol. `checks/lighting-assets.cjs` kontrollerer og viser de rigtige figurer. `checks/hatching.test.cjs` kontrollerer stregtæthed, krydsstreger, synlig basisfarve, kantudjævning, lyse overflader, konturer og forankring under kameraflytning. `checks/hatching-preview.cjs` laver en sammenligning med de rigtige figurer og en formationsoversigt. Browserkontrollerne kører med tjenesten startet og bruger udviklingsmaskinens eksisterende Playwright/Chrome.

## Genbygning af lysbilleder

De nye modeller eksporteres med `tools/export_v2_models.py`: `Blender --background --factory-startup --disable-autoexec <model.blend> --python tools/export_v2_models.py -- --output <ny-mappe>`. `--smoke` giver en kort prøve. Værktøjet læser de nye modellers animationer direkte, bevarer ganghastigheder og laver parrede farve-/normalbilleder. Se [assets/README.md](assets/README.md) for begge modeller og den efterfølgende atlasbygning.

`tools/export_relightable.py` køres i Blender 5.2 med en gemt model og en tidligere normal Sprite Studio-eksport som reference for animationer, kameravinkler og placering. Det opretter nye filer og ændrer ikke den gemte model eller tidligere eksporter. Skriptets argumenter er `--manifest <reference-sprites.json> --output <ny-mappe> --pixels 256`; `--smoke` laver en prøve med fire retninger. Den valgte model åbnes med Blenders normale baggrundsargument `--background <model.blend> --python <script> -- <argumenter>`.

Eksporten kan genoptages i samme mappe ved afbrud. Hvert billedpar er kontrolleret med en kontrolsum. Normalkortene bruger rå lineære kanalværdier; PNG-farvetags fjernes, så de ikke kan fortolkes som billedfarver. `tools/verify_relightable.py <ny-mappe>` kontrollerer billedparrene og kildefilen. Se værktøjets `--help` for den aktuelle argumentliste.

`build_assets.py --source <ny-mappe> --out assets/<figur> --character-id <figur> --registry assets/characters.json --role <pike|shot>` bygger og registrerer en figur. Det bruger identiske udsnit for krop og normalkort, normaliserer normalerne efter nedskalering og bevarer de tidligere runtimeassets under `versions/` før erstatning. Normal drift af studiet kræver kun de færdige atlasser og filserveren.
