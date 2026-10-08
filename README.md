# Walking Fortress · Formationsstudio

Et selvstændigt forsøgsrum til formationsfelter på et 3D-terræn med soldater som animerede 2D-sprites. Felterne bestemmer formationernes plads og bevægelse. Figurerne er visuel feedback og har ingen individuelle ordrer eller sammenstød.

## Dokumentation til videre arbejde

[DEVELOPMENT.md](DEVELOPMENT.md) beskriver arkitektur, dataflow, gemte studier, ændringssteder og udviklingskontroller. [AGENTS.md](AGENTS.md) indeholder arbejdsregler for kommende sessions. [Billeder og genbygning](assets/README.md) beskriver spriteformatet, normaldata, piker og Blender-kilder.

Denne mappe er sit eget Git-lager med `main` som første gren. Kode og færdige runtimebilleder følger med; en kopi af lageret kan starte studiet uden adgang til den oprindelige arbejdsmappe. Blender-kilder og Sprite Studios byggeværktøjer ligger uden for lageret og bruges kun ved genbygning. Genererede kontrolbilleder, kontrolrapporter, lokale studiefiler, logfiler og Python-cache ignoreres af Git. Der er ikke oprettet et fjernlager.

## Start

Dobbeltklik på **Start_Formationsstudio.cmd**. Studiet åbner på **http://127.0.0.1:8766**. Lad tjenestens vindue stå åbent; stop med Ctrl+C. Kræver Python 3.10 eller nyere og en browser med WebGL 2, eksempelvis Chrome eller Edge. Ingen installation af billedbiblioteker, Blender eller API-nøgle er nødvendig for at bruge studiet.

Hvis tjenesten allerede kører, kan adressen åbnes direkte. Sprite Studio bruger en anden port og kan køre samtidig.

## Det første forsøg

1. Vælg en fænnike i listen eller ved at klikke på dens felt. Klik på jorden for at give marchordre.
2. Justér styrke, filer i fronten og afstande. Vælg slagorden eller marchkolonne. Den ønskede form vises med stiplede kanter; den aktuelle form ændrer sig gradvist.
3. Shift + klik sætter frontens retning. Drejning kan også angives i grader. Holdt annullerer marchen.
4. Under **Terræn** kan du vælge fladt land, hældning, bakkekam og en 8 m bred passage. En for bred slagorden standser; omform til kolonne. Formationer venter også, når andre optager pladsen. Der er ingen automatisk omvejssøgning.
5. Under **Visning** kan du vælge soldater, felter eller begge. Antallet af tegnede soldater fordeles mellem fænnickerne og ændrer aldrig troppestyrken eller bevægelsen.
6. Fjern 10 eller 25 procent for at afprøve tab: behold huller, indsnævr fronten eller reducer geledderne.

Skyttefløje er særskilte felter på hver side af pikekernen. I kolonne følger de efter pikenererne. De bruger foreløbigt pikenerens krop uden pike; der er endnu ingen selvstændig skytteanimation.

**Højre træk** drejer kameraet; **midtertræk** eller **Alt + træk** flytter udsnittet; **musehjul** zoomer. **Home** viser overblikket. **Mellemrum** pauser eller afspiller. Knappen **+ ½ s** går frem i små skridt, mens forsøget er sat på pause.

## Gem forsøg

**Gem studie** downloader en JSON-fil og gemmer samtidig en kopi i denne browser. **Åbn** indlæser en fil og sætter forsøget på pause. Ved næste start åbnes browserens senest gemte studie. Gemningen bevarer den aktuelle omformning, mål, styrke, terræn, kameravinkel, visning og lys. **Ny prøve** starter et nyt standardforsøg; en tidligere downloadet fil kan stadig åbnes.

Ved terrænskifte flyttes kun formationer, hvis felter ligger i det nye terræns hindringer, til fri plads. Deres marchordrer stoppes, og en besked vises. Hvis ingen plads findes, afvises terrænskiftet uden at ændre scenen.

## Hvad studiet afklarer

Denne version kan undersøge formationers læsbarhed, march, vending, omformning og sprites på højdeforskelle. Den er et første forsøg med en selvstændig feltmodel. Kamp, morale, skydning, hærstyring og historisk kalibrering er senere studier.

Soldater og piker bruger de færdige Blender-eksporter: 16 kameraretninger, gang og stilstand, fælles målestok og fodanker. Kameraets elevation er fast ca. 30 grader for at passe til billederne. Terrænet er en enkel arbejdsvisning.

Under **Lys** kan du justere solretning, solhøjde, skyggestyrke, skyggens udbredelse og blækfarve. Solen er fast i landskabet: både terræn og soldater bruger samme retning, uafhængigt af kameraet. Når en soldat vender sig, beregnes skyggen på de nye verdensvendte overflader. Lysindstillingerne gemmes med studiet; tidligere studiefiler får de manglende standardindstillinger.

**Streger & krydsskravering** er nu standarden. I kanten af skyggen tegnes få parallelle streger; længere inde kommer flere streger og til sidst krydsstreger. Basisfarven forbliver synlig mellem dem. Stregafstanden kan sænkes til 0,5 cm i trin på 0,1 cm, og stregbredden til 0,05 cm. Bredde og vinkel kan justeres, og **Krydsstreger fra skyggedybde** bestemmer, hvor tidligt krydsstregerne begynder. Lavere værdi giver flere krydsstreger. Afstanden angiver de tætteste streger; nær kanten bruges to eller fire gange afstanden. Udgangspunktet er 12 cm, 1,8 cm bredde, 45° og krydsstreger fra 22 %. **Flade blækfelter** giver den tidligere fyldte skygge. **Gendan figurens skyggestil** gendanner figurens styrke/tærskel/blækfarve og den nye stregstandard.

Skraveringen er et mønster i billedplanet, forankret ved figurens fødder. Det glider derfor ikke hen over figuren, når kameraet flyttes. Normalkortet bestemmer, hvor skyggen falder og hvor tæt skraveringen bliver. Der kræves ingen ny Blender-eksport for at ændre stregerne.

Visningen anmoder om browserens antialiasing; på udviklingsmaskinen er 4× MSAA bekræftet. De beregnede streger og deres skyggekanter har også separat kantudjævning. På afstand filtreres stregerne til deres dækkede areal for at mindske flimren. Figurer på få skærmpixels kan derfor ikke vise hvert enkelt kryds. Runtimebilledernes 100 px sætter stadig grænsen for konturernes detalje ved kraftig indzoomning.

Kroppen bruger et farvebillede uden formskygge og et matchende normalkort for hver animationspose og kameraretning. Det giver lysafhængige skyggestreger med en ensartet blækfarve. Konturer og foldstreger er bevaret. Den nye kildeserie ligger i `assets/musketeer/sprite_exports/Pikener_normals_20261008_151700/` i arbejdsområdet og indeholder 432 par i 256 px; runtimeatlasserne har 100 px som nominel målestok. Originalen i Blender er uændret.

Dette beregner formskygge på kroppen. Kastede skygger på jorden eller andre figurer er et særskilt trin. Pikerne er fortsat tegnede elementer med de gemte kropsmasker.

Piken er et særskilt, smalt spriteelement. Maskerne mod ejerens krop og hånd er indbygget. Overlap med andre soldater og terræn følger spritens billedplan og er en tilnærmelse. En fysisk pike i 3D er en oplagt efterfølgende prøve, især ved tætte rækker og vandrette piker.

Rendererens terræn er 3D; figurerne tegnes samlet som instanser af små billedflader. Det undgår animerede 3D-skeletter og store figurmodeller. Der er endnu ingen sammenlignende ydelsesmåling med 3D-figurer eller validering af fuld hærskala.

## Filer og adskillelse

- `model.mjs`: styrke, feltgeometri, march, gradvis omformning, tab, pladsbegrænsning og scenefiler. Kan køre uden browser eller grafiske assets.
- `terrain.mjs`: højder, passagehindringer og geometriske overlap.
- `renderer.mjs`: WebGL 2, terræn, formationsfelter, sprites, piker, kamera og normalbaseret blækskygge.
- `lighting.mjs`: fælles solretning, koordinater og maskeberegning. Lys påvirker kun visningen.
- `main.mjs`, `index.html`, `studio.css`: den danske brugerflade og betjening.
- `assets/`: selvstændige krops- og pikeatlasser samt animationernes metadata. Se `assets/README.md`.
- `server.py`: lokal filserver, kun på loopback. Der køres ingen gammel spilmotor.

Mappen kan flyttes samlet. Runtime importerer ingen kode eller billeder fra Sprite Studio eller den tidligere iteration. `build_assets.py` er alene et værktøj til at genbygge atlasser fra den kendte spriteeksport i denne arbejdsmappe; det er ikke nødvendigt ved normal start.

## Kontrol

Model- og lyskontroller: `node --test model.test.mjs lighting.test.mjs`. Ni modeltests kontrollerer uafhængighed af tegnetæthed, feltgeometri, passage, sammenstød, tab, scenegemning, terrænskifte, pladsmangel og animationstilstand. Otte lyskontroller dækker koordinater, normalrotation, verdensfast sol, hårde skyggeniveauer, indstillingsvalidering og gemte skraveringsindstillinger.

Browserkontrollen i `checks/browser.test.cjs` bruger Playwright og den installerede Chrome. Den kontrollerer opstart, grafik, visning, kamera, formationer, tab, marchordre, filgemning, lys- og skraveringsindstillinger og genindlæsning. Den er til udvikling og kræves ikke for brug. Resultat og skærmbilleder gemmes i `checks/`.


GPU-kontrollen `checks/lighting.test.cjs` kontrollerer konkrete pixelværdier, modsat front, kamerarotation, konturer, piker og terrænets fælles sol. `checks/lighting-assets.cjs` kontrollerer og viser de rigtige figurer. `checks/hatching.test.cjs` kontrollerer stregtæthed, krydsstreger, synlig basisfarve, kantudjævning, lyse overflader, konturer og forankring under kameraflytning. `checks/hatching-preview.cjs` laver en sammenligning med de rigtige figurer og en formationsoversigt. Browserkontrollerne kører med tjenesten startet og bruger udviklingsmaskinens eksisterende Playwright/Chrome.

## Genbygning af lysbilleder

`tools/export_relightable.py` køres i Blender 5.2 med en gemt model og en tidligere normal Sprite Studio-eksport som reference for animationer, kameravinkler og placering. Det opretter nye filer og ændrer ikke den gemte model eller tidligere eksporter. Skriptets argumenter er `--manifest <reference-sprites.json> --output <ny-mappe> --pixels 256`; `--smoke` laver en prøve med fire retninger. Den valgte model åbnes med Blenders normale baggrundsargument `--background <model.blend> --python <script> -- <argumenter>`.

Eksporten kan genoptages i samme mappe ved afbrud. Hvert billedpar er kontrolleret med en kontrolsum. Normalkortene bruger rå lineære kanalværdier; PNG-farvetags fjernes, så de ikke kan fortolkes som billedfarver. `tools/verify_relightable.py <ny-mappe>` kontrollerer billedparrene og kildefilen. Se værktøjets `--help` for den aktuelle argumentliste.

`build_assets.py --source <ny-mappe>` bygger de selvstændige atlasser. Det bruger identiske udsnit for krop og normalkort, normaliserer normalerne efter nedskalering og bevarer de tidligere runtimeassets under `assets/versions/`. Normal drift af studiet kræver kun de færdige atlasser og filserveren.
