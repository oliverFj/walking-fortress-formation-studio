# Udvikling af Formationsstudio

Denne vejledning beskriver den fungerende prototype pr. 12. oktober 2026. Læs først [AGENTS.md](AGENTS.md), derefter [README.md](README.md) for betjening og [assets/README.md](assets/README.md) for figurernes billedformat. Appen er et selvstændigt studie af formationsfelter; soldaterne viser felternes tilstand.

## Første arbejdsrunde

1. Start fra denne mappe med `python server.py --open` eller `Start_Formationsstudio.cmd`. Standardadressen er `http://127.0.0.1:8766`.
2. Kontrollér Git-status og læs den relevante del af denne vejledning før ændringer. Bevar kildefigurer og tidligere spriteeksporter.
3. Ændr det lag, som ejer adfærden. Giv nye modelregler en målrettet kontrol uden browser; kontrollér visuelle ændringer med rigtige figurer i browseren.
4. Genindlæs en prøvevisning, når kode ændres. Gem eventuelle forsøg i en eksisterende browserfane før genindlæsning. Forskellige faner på samme adresse deler browserens gemte studie.
5. Gem kode og håndskrevet dokumentation i Git. Kontrolrapporter, skærmbilleder og downloadede prøver er genererede arbejdsfiler og ignoreres af [.gitignore](.gitignore).

Der er ingen byggefase, bundler eller serverbaseret simulation. Runtime kræver Python 3.10+ og en WebGL 2-browser. De færdige assets i repositoryet gør, at normal drift hverken kræver Blender, Sprite Studio eller Python-billedbiblioteker.

## Arkitektur og dataflow

```text
main.mjs ── brugerinput ──> StudioModel
                              │
                         step(dt)
                              │
                         snapshot(...)
                              │
main.mjs ── view/camera/lys ──> Renderer ──> WebGL 2
                              │
                       assets/characters.json
                       pikeman/character.json + musketeer/character.json
                       hver figurs body/normal og evt. pike-atlasser

terrain.mjs <── model.mjs og renderer.mjs
lighting.mjs <── main.mjs og renderer.mjs
```

[model.mjs](model.mjs) og [terrain.mjs](terrain.mjs) importerer ingen DOM, grafik eller spritefiler. `StudioModel` ejer styrke, nuværende layout, marchmål, retning og tid. `snapshot()` producerer verdensvendte feltpolygoner samt en deterministisk udvælgelse af dekorative soldater. Den ændrer ikke modellen. `visualBudget` og skjulte soldater må derfor aldrig ændre march, omformning, tab eller kollisionsresultat.

[main.mjs](main.mjs) ejer input, paneler, afspilning, filåbning, browsergemning og `view`. Når afspilningen kører, bruger den en akkumulator med modeltrin på `1/60` sekund. Rendering følger `requestAnimationFrame`. `StudioModel.step(dt)` begrænser et enkelt kald til 0,5 sekund og opdeler det i trin på højst 0,05 sekund. **+ ½ s** udfører 30 modeltrin og pauser. Langvarige afbrydelser bliver ikke indhentet som ubegrænset simulationstid.

[renderer.mjs](renderer.mjs) ejer terrænmesh, feltmarkeringer, spriteinstanser, projektion, kamera og shaders. Et snapshot tegnes sammen med separat visningstilstand. Terræn tegnes først, derefter instancerede jordskygger, felt-/rutemarkeringer med hjørnegreb, kropsinstanser og pikeinstanser. Kroppe og piker bruger hver sin fælles tegning med `drawArraysInstanced`; der er ingen 3D-skeletter i runtime. `renderer.stats` er simple tegneoplysninger og udgør ikke en ydelsesmåling.

[server.py](server.py) er en Python-filserver på loopback med lokale biblioteks- og renderendpoints. `/health` identificerer appen. På Windows reserverer serveren porten eksklusivt, så to processer ikke konkurrerer om samme adresse. `--open` åbner den eksisterende tjeneste, hvis `/health` identificerer den som Formationsstudio. En anden port kan vælges med `--port`.

`audio.mjs` indlæser og dekoder lokale WAV-filer efter et aktivt klik på lydknappen: ti støvleklip og seks felttrommeslag fra manifests i `assets/audio/`. Originalens fodkontakter ved frame 6 og 30 af 48 giver to nedslag ved cyklusfase 0,125 og 0,625. Alle fænniker får fælles `cadenceProgress = model.time * 0.7` og `cadenceRate = 0.7` fra modellen; lyd og trommer følger denne klokke uafhængigt af formationshastighed og valgte fænnike. Ældre lydprøver uden disse felter bruger den tidligere hastighedsbaserede takt. Manifesternes `contact` markerer første landing/primært trommeanslag inde i klippet. En kort forhåndsplanlægning blander op til 48 repræsentative optagede trin i en stereobuffer med ±4 procent cyklusvariation; afspilningstempo ændrer ikke tonehøjde, men hvert støvletrin får selvstændig pitchvariation på ±2,25 halvtoner, styrke, klangfarve og panorering. Tidsplaceringerne spredes uden en samtidig central klump; kontaktankret korrigeres ved resampling. 32 tilfældigt valgte variationer pr. formation undgår den tidligere korte løkke på fire gruppetrin. Gang/løb vælger de tilsvarende optagelser; fuld formationsstyrke styrer fylde, uafhængigt af tegnebudget og spritevisning. `mixMarchStamp()` indeholder ingen syntetiske støvler eller basoscillatorer. `drum-signals.mjs` bevarer version 0.1's `order-move`- og `army-stop`-accenter/pitch med anslag på [0,2,3,4] og [0,1,3] fælles kvartslag (0,125 cyklus pr. trin). Modellen ejer signalernes absolutte `startProgress`/`endProgress`; slutningen inkluderer en 0,65 s lydhale. `orderClocks` planlægger signalerne også for stationære tropper, med egne kamerablandede ordrekanaler gennem trommeskyderen. Ordreanslag bruger den præcise fælles takt, mens almindelig marchlyd beholder regimentets lille forskydning. Kun det relevante regiments almindelige trommer dæmpes under signalet.

Kameramixet porter principperne fra det tidligere projekts `game/audio.ts`: projektér kildepositionen på kameraets højre/op-akser, dæmp efter afstand i billedet og uden for udsnittet, panorér og sænk lavpasfilterets grænse ved mindre detalje. Studioets ortografiske zoom er synlig højde i meter og har derfor omvendt retning af det gamle projekts zoom. Filter, gain, pan og en kort 0,55 s rumhale glattes løbende. Felttrommerne bruger `game/drums.ts`' 16 accenter og tonevariation, med fire underdelinger pr. fodslag. Hver aktiv formation har sit eget trommeur i `drumClocks`, egen lydkilde og hele det fælles trommemønster. `regimentAudioOffset(id)` giver en stabil forsinkelse på 0–45 ms, skaleret med afspilningshastigheden; samme forskydning gælder formationens støvletrin og trommer. Valg af fænnike påvirker ikke lydkilderne. Trommeoptagelserne roteres efter formations-ID, så samtidige regimenter ikke altid bruger samme klip. Begge kategorier bruger gain `activeCount ** -0.2`; dette dæmper summen moderat, mens flere formationer stadig giver større lydfylde. Stop, pause og mute rydder alle berørte kilder og ure; kontaktindekser forhindrer dobbelte slag. Master- og trommeskyderens normaliserede værdier ligger fortsat i 0–1, men anvendes med 2× gain; 50 % svarer dermed til det tidligere 100 %. Mixets støvleniveau er 0,75 og trommeniveau er 3,2 relativt til de tidligere kildeniveauer, så trommeskyderen kan bringe rytmen frem. Trommer har særskilt lydstyrke og samme korte gain-envelope som legacy (hale fades fra 0,18 til 0,72 s; stop ved 0,76 s), så de lange optagelser ikke udvisker rytmen. Den gamle projektdel læses kun som reference; runtime har ingen afhængighed af den.

Faktisk accepteret feltbevægelse aktiverer lyd. Pause, holdt, skjult fane og nul lydstyrke stopper kilder og fremtidige slag; scenehop afspiller ikke ophobet rytme. Lydvalg er sessionsindstillinger uden ændringer i formationsmodellen. Kontroller med `node --test audio.test.mjs` samt `node checks/audio.test.cjs` og `node checks/drum-orders.test.cjs`. Kilder og CC0-oplysninger ligger i lydmanifesternes metadata. Støvleudskæring kan genskabes med `tools/extract_boots.py`.

## Model, geometri og koordinater

Verdenskoordinater måles i meter: `x,z` ligger på jorden, og `y` er højde. Model- og kameravinkler er radianer. `heading = 0` vender mod `-Z`; en positiv drejning går mod `+X`. Brugerfladen og solindstillinger viser grader. Undgå at overføre grader direkte til model eller kamera.

En fænnike består af lokale rektangulære delfelter. `desiredLayout(f)` beregner ønsket form ud fra styrke, filer, afstande, slagorden/kolonne og sammensætning. Rene pikenerformationer har ét felt. Blandede formationer har en pikekerne og to skyttefelter, som i kolonne følger bag kernen. `f.layout` er den aktuelle, gradvist ændrede form. `fieldsOf()` drejer og flytter den til verdenspolygoner.

`interpolatedLayout()` nærmer sig den ønskede form. `stepFormation()` kontrollerer forslag mod kortgrænse, terrænhindringer og andre formationers aktuelle delfelter. Hvis en fuld omformning blokeres, kan mindre ændringer af bredde, forskydning eller dybde stadig skabe plads. March og vending er også pladsbegrænset. Der findes ingen omvejssøgning; en blokeret formation venter.

`march.mjs` leverer ankergeometrien. `turnAnchor` normaliseres til `auto`, `center`, `left` eller `right`; `auto` vælger det inderste fronthjørne efter drejeretningen. En marchordre venter på en færdig omformning og udføres som hjuldrejning om et fast verdensanker, derefter lige march. Nære mål bruger centrum, når et flankesving kræver en større bue end afstanden til målet. En udtrykkelig slutretning drejer til sidst om centrum, så destinationen bevares. `setWaypoint(id, {x,z,heading?}, append)` erstatter eller udvider køen med højst 64 rutepunkter. `rotateWaypoint(id, waypointId, heading)` ændrer punktets slutretning. Snapshot indeholder ønskede felter og fire ydre hjørner pr. punkt; `worldToScreen()` og `waypointHandles()` giver controlleren grebenes skærmkoordinater. Køen fortsætter først efter både position og slutretning er nået. `turn(id, heading)` giver en ren ankerdrejning, og `halt(id)` stopper den aktuelle ordre; begge rydder køen. Drejningens vinkelhastighed begrænses af det fjerneste feltpunkt, så yderbanen højst kræver 3 m/s. Den angivne `turnRate` er derfor et maksimum.

Ved march og hjuldrejning udledes soldaternes fart og retning af felternes faktisk accepterede translation og rotation. Gradvis layoutændring bidrager også til animationen, men omfordeling til et nyt antal filer bruger stadig den eksisterende dekorative slotmodel og kan flytte pladser straks; det er ikke individuel geledvis omformning. Snapshots giver ingen individuelle bevægelsesordrer. Hastigheden vælger animationsgruppe, mens en fælles klokke for hele studiet bevarer takt og fase gennem hastigheds- og variantskift. `MARCH_CYCLES_PER_SECOND = 0.7` bevarer den tidligere standardmarchs tempo (84 fodnedslag/minut). Klokken fortsætter også under stilstand, men pause stopper modeltiden. `marchStartTime` planlægger start på næste kontaktfase efter afmarchordrens afslutning ved nye marchordrer, og `marchActive` giver adgang til bevægelse fra dette tidspunkt. Det gælder også omformning, vending og genstart efter blokering. En kontinuerlig rute behøver ikke en ny afmarchordre ved hvert punkt. Stopordren udløses kun ved rutens endelige mål ud fra resterende march-/drejetid. Et for kort sidste stykke tilpasses, så ordren kan afsluttes før stilstand. Modellen styrer tidsforløbet også med lyden slukket; lydafspilning kan ikke ændre simulationen. Venteposen har ingen målt soldatbevægelse og afgiver ingen marchlyd. Det gælder også ved reduceret tegnebudget.

Grundlaget er det canadiske forsvars [kapitel 3, §§ 32 og 56–60](https://www.canada.ca/en/services/defence/caf/military-identity-system/drill-manual/chapter-3.html) og [kapitel 14, afsnit 4, §§ 15–16](https://www.canada.ca/en/services/defence/caf/military-identity-system/drill-manual/chapter-14.html). Implementeringen er en samlet feltvending inspireret af hjuldrejningens geometri. Bands' geledvise drejning på samme sted kræver en senere model.

`terrain.mjs` leverer `heightAt()`, hindringspolygoner og overlap via separerende akser for konvekse polygoner. Slaget foregår inden for `[-70,70]` i både x og z. Passagen har en fri bredde på 8 m. Ved terrænskifte flytter `setTerrain()` kun felter, der rammer de nye hindringer, og stopper deres ordre. Hvis der ikke findes plads, rulles hele terrænskiftet tilbage.

Tab har tre adskilte politikker: `holes` bevarer plads og viser deterministiske huller, `narrow` reducerer fronten, og `ranks` reducerer geledder. `footprintCount` bevarer den oprindelige kapacitet ved huller. Dekorative slots fordeles ved en stabil hash af slot og seed; animationens fase er også deterministisk. Ændring af tegnebudget må ikke skabe eller fjerne modelstyrke.

## Hvor en ændring hører hjemme

| Ændring | Primært sted | Følgearbejde |
| --- | --- | --- |
| Formationers sammensætning, feltbredde og geledder | `desiredLayout()` i `model.mjs` | Modelkontroller; paneler hvis nye parametre |
| March, vending, omformning, plads og tab | `StudioModel` i `model.mjs` og ankergeometri i `march.mjs` | `model.test.mjs`, `march.test.mjs` og `checks/shared-cadence.test.cjs` |
| Nye terrænhøjder eller hindringer | `terrain.mjs` | `terrainNames`, panelnavne/knapper og modelkontroller |
| Nye soldattyper og animationer | `assets/characters.json`, figurens `character.json`, `loadAssets()` og `spriteInstances()` | Assetsformat, fodankre, retninger, variation og rigtige spriteprøver |
| Kamera, dybde, projektion og feltmarkeringer | `renderer.mjs` | `screenToGround()` og kontrol af klik på terræn |
| Verdenssol, normalakser og validering af lys | `lighting.mjs` | Shaderparitet og lyskontroller |
| Skravering, farve eller filtrering | Spritefragmentshaderen i `renderer.mjs` | GPU-kontrol og nær-/oversigtsbillede |
| Indstillinger og dansk betjening | `main.mjs`, `index.html`, `studio.css` | Gem/åbn, standarder og browserkontrol |
| Scenegemning og migration | `sceneDocument()` / `openScene()` og modelens eksport/import | Rundtur og ældre filer |

Bevar felterne som simulationsgrundlag, når nye systemer tilføjes. Individuel soldaterkollision, kampautoritet eller ændring af styrke ud fra tegnede figurer er en særskilt designbeslutning.

## Scenefiler og migration

En downloadet fil har det ydre schema `walking-fortress-formation-study-v1`. Den indeholder `model`, `view` og `lossMode`. `model` har sit eget schema `walking-fortress-formations-v1` og indeholder terræn, tid, ID'er, valg og formationer. `view` indeholder `display`, `showTargets`, `showPikes`, `visualBudget`, `camera` og `lighting`. Kameraet gemmer `yaw`, `zoom`, `centerX` og `centerZ`; elevation følger figurens eksport.

Modelens eksport kloner formationerne, inklusive rutepunkter med stabile ID'er og eksplicitte slutretninger, marchmål, aktuel manøvrefase og anker, fælles animationstakt, `marchActive`, `marchStartTime` og trommeordre med signal-ID, omformningslayout og kapacitet efter tab. Ældre filer uden drejeanker bruger `auto`. Import validerer schema, terræn, entydige positive ID'er og højst 24 formationer. Den normaliserer input og genberegner næste formations-ID. Rutepunkter valideres for endelige mål, entydige positive ID'er og højst 64 pr. formation; ældre filer uden kø bevarer deres enkelte marchmål. `selectedId: null` bevarer afmarkering. Ældre uafhængige marchfaser erstattes af fase fra den gemte modeltid; fænniker uden startmetadata tilslutter sig på næste fælles nedslag. Et manglende eller ugyldigt layout erstattes med den ønskede form. Brugerfladen tillader aktuelt højst seks formationer at blive oprettet; filformatets grænse er højere.

`openScene()` normaliserer visningsfelter, indlæser kamera og sætter afspilningen på pause. Den aktuelle UI begrænser tegnebudget til 60–2400. Ved filåbning afvises filer over 2 MiB. Browserkopien findes i `localStorage` under `wf-formation-study`; kun **Gem studie** skriver denne kopi. Opstart forsøger at åbne den senest gemte kopi. Scenegemning har ingen serverdatabase; figurbibliotekets lokale API skriver kun renderjob, versionsmetadata og den aktive figurliste.

Skyggestandarder kommer fra `DEFAULT_LIGHTING`; kun solretning og -højde hentes fra figurens `character.lighting`. Manglende felter i tidligere study-v1-filer får disse standarder. Manglende eller ukendt `style` bliver `hatch`, mens et udtrykkeligt valgt `solid` bevares. Solazimut kanoniseres til `[0,360)`, så eksempelvis `-45` bliver `315`. `cleanLighting()` fastholder `softness: 0` og UI-intervaller for solhøjde og tærskel.

Ved kompatible nye valgfri felter: tilføj standard, normalisering, UI, eksport/import og en kontrol med en gammel fil, hvor feltet mangler. Ved en inkompatibel ændring: opret en udtrykkelig migration før import; overskriv ikke betydningen af det eksisterende schema uden en migration. Bevar rundtur af en igangværende omformning.

`window.formationStudio` bliver tilgængelig efter assetindlæsning. Den giver browserkontroller adgang til `model`, `renderer`, `view`, seneste `snapshot`, `openScene()`, `sceneDocument()` og `pause()`. Det er et udviklingsindgangspunkt med direkte referencer, ikke et stabilt eksternt API. Kontroller, at det er klart, før en browsertest bruger det.

## Billeder, lys og skravering

Runtime læser [assets/characters.json](assets/characters.json), som knytter `pike` til `pikeman` og `shot` til `musketeer`. Hver figur har sin egen `character.json` og egne atlasser. Begge figurer har 16 retninger og flere gang-, løbe- og stilstandsvarianter. Direkte indlæsning af den tidligere `assets/character.json` er fortsat understøttet. Retning vælges ud fra kameraets yaw minus soldatens heading, justeret for første eksportazimut og vinkeltrin. Kameraet er ortografisk med fast elevation omkring 30,05°, som matcher billederne.

Animationsnavne er frie. Hvert clip har `kind: idle|walk`, `duration`, `frameCount` og `directions`; `gait` beskriver gang/løb og `nominalSpeed` angiver hastighedsgruppen i meter pr. sekund. De tre værdier 0,5, 1,5 og 3 kommer fra actionnavnene og er ikke fysisk målt eller kalibreret. Rendererens variantvalg er deterministisk for soldatens `animationSeed`, så en kameradrejnings- eller tegnebudgetændring ikke giver tilfældige omvalg. Marcherende soldater bruger fælles cyklusfrekvens og en fast individuel faseforskydning på ±4 procent; forskellig cliplængde normaliseres til samme takt. Stilstand beholder individuel tempovariation. Den nærmeste hastighedsgruppe vælges ud fra den faktiske hastighed i soldatens plads; den fælles integrerede cyklus bestemmer marchfasen, så ydersidens løb stadig følger takten. Animationsvalg og fase ændrer kun visningen; formationens felter ejer stadig position, styrke og bevægelse.

`body.pivot` er fodankeret i det beskårne kropsbilledes lokale pixelrum. Krop og pike bruger samme lokale rum og `pixelsPerUnit`. Piken kan have fire særskilte hjørner; dens maske mod ejerens krop og hånd er allerede indbygget i billedet. Musketerens musket er en del af kropsbilledet og får også normalbaseret lys; dens metadata har ingen særskilt pikeatlas. Anvend ikke tidligere editortransformer igen. Se [assets/README.md](assets/README.md) for detaljer.

Kroppens albedo indeholder basisfarve, kontur og folder, men ingen gammel formskygge. `normals.png` deler kropsatlassets størrelse og præcis samme rektangler. RGB er rå lineære data, kodet som `0.5 * normal + 0.5`; alfa er modellens overfladedækning. Normalteksturer uploades som RGBA8 uden browserfarvekonvertering. PNG-overførselstags og farveprofiler må ikke omfortolke normaler til farver. Nedskalering vægter efter dækning og normaliserer igen; kant-RGB er udvidet uden at ændre alfa.

Normalens akser er figurens Blender-referenceverden X,Y,Z. Shaderen bytter til studioets X,Z,Y og drejer efter soldatens heading. Den fælles sol fra `lightDirection()` er allerede i studioets verdensrum og bruges også af terrænet. Kameraet må ikke dreje solen. Lysstyrken beregnes som `0.5 + 0.5 * dot(normal, sol)`. Tærsklen anvendes på denne værdi. Kontur-/foldpixels bliver ikke lysere ved skygge, og pixels uden normaldækning modtager ingen formskygge. Piker har aktuelt ingen normalbaseret formskygge.

Standarderne er 82 % styrke, 37 % udbredelse og sort blæk. Skravering er procedural og kræver ingen ny Blender-eksport. Koordinaterne ligger i billboardets meter og er forankret ved fødderne. Brug ikke `gl_FragCoord`, som vil få mønstret til at glide ved kameraflytning. Normalerne og solen bestemmer skyggen; mønstret bestemmer, hvor blækket dækker den.

| Felt i `view.lighting` | Standard | Tilladt interval | Betydning |
| --- | --- | --- | --- |
| `style` | `hatch` | `hatch` / `solid` | Streger eller fyldte blækfelter |
| `hatchSpacing` | 0,021 m | 0,005–0,5 m | Afstand mellem de tætteste parallelle streger |
| `hatchWidth` | 0,0125 m | 0,0005–0,055 m | Stregbredde |
| `hatchAngle` | 45° | 0–180° | Stregvinkel i billboardplanet |
| `crossStart` | 0,05 | 0,05–0,9 | Skyggedybde, hvor krydsstreger begynder |

Skyggedybde er `(threshold - brightness) / threshold`, klippet til `[0,1]`. Nær kanten bruges primærstreger ved fire gange afstanden. Ved dybde 0,16 tilføjes streger ved to gange afstanden, og ved 0,42 bruges den tætteste afstand. Perpendikulære krydsstreger begynder ved `crossStart`, og et tættere sæt kommer 0,25 længere inde. Streger deler et fælles nulpunkt, så tættere niveauer tilføjer streger mellem de eksisterende. UI viser centimeter og tillader afstandstrin på 0,1 cm og breddetrin på 0,05 cm. Instancerede jordellipser deler samme analytiske hatchfunktion og uniforms som kroppen. De følger terrænhøjden under soldatens fødder og drejer med dens heading. `stats.groundShadows` tæller tegnede skygger; skjulte soldater eller deaktiveret lys giver ingen jordskygger.

WebGL-konteksten anmoder om antialiasing; 4× MSAA er verificeret på udviklingsmaskinen, men antal samples afhænger af browser og grafikdriver. MSAA glatter geometriske kanter. Streger har desuden analytisk arealfiltrering med `fwidth`, og skyggegrænsen har en smal pixelbaseret udjævning. Beregn derivativer før `discard` eller divergerende coveragegrene. Når flere streger falder inden for samme pixel, bliver deres samlede areal repræsenteret som delvis dækning. Tæt skravering kan derfor ligne en tone ved lav skærmopløsning. Bredde og afstand begrænses uafhængigt; shaderen begrænser hver stregfamilies dækningsandel til 90 %, men brede streger med lille afstand bliver visuelt meget mørke. Sænk bredden sammen med afstanden, hvis mellemrum skal bevares. Runtimefiguren er stadig ved en nominel 100 px målestok; antialiasing tilføjer ikke konturdetaljer ved kraftig indzoomning.

Spritefragmentet har desuden atlas-afgrænset minificeringsfiltrering. UV-derivativer bestemmer skærmpixelens kildeareal; op til 8 samples pr. skærmakse vægter RGB med alfa og normaldata med deres egen dækning. Samples klippes til den aktuelle frames rektangel, så naboposer ikke bløder ind. På afstand sænkes dækningsgrænsen fra 0,18 til 0,001, så subpixelkonturer og piker bevarer delvis dækning. Quadens rasterområde udvides samtidig med en halv skærmpixel pr. side med ekstrapolerede UV-koordinater. Det giver filteret plads til delvis dækning uden at flytte eller gøre selve stregen bredere, også når en pike er smallere end en skærmpixel. Ved nærvisning bevares den oprindelige bilineære sampling. Filteret ændrer kun visningen og kræver ingen atlas- eller Blender-genbygning. `checks/zoom-filter.test.cjs` kontrollerer subpixelpan ved 4×/8× nedskalering, piker, naboframes og rigtige formationsoversigter.

## Kontroller ved ændringer

Kør kommandoerne fra repositoryets rod. Model- og lyskontroller bruger kun Node.js' indbyggede testløber:

```powershell
node --test model.test.mjs march.test.mjs animation.test.mjs lighting.test.mjs
```

| Ændring | Målrettede kontroller |
| --- | --- |
| Model eller terræn | `model.test.mjs`: tegnebudget-uafhængighed, feltgeometri, passage, sammenstød, tab, scenebevarelse, terrænskifte, pladsmangel, animationstilstand |
| Lyskonventioner og gemte parametre | `lighting.test.mjs`: akser, verdenssol, soldatdrejning, tærskel, normalisering og gammel/hatch/solid tilstand |
| Shader, UV'er eller normaltekstur | `node checks/lighting.test.cjs`: kendte pixelværdier; `node checks/lighting-assets.cjs`: rigtige figurer |
| Skravering og filtrering | `node checks/hatching.test.cjs`: stregdækning, krydsstreger, basisfarve, udjævning, lyse flader og panforankring |
| Skraveringens udtryk | `node checks/hatching-preview.cjs`: nærbillede og formationsoversigt; inspicér begge |
| UI, kamera og scenefiler | `node checks/waypoints.test.cjs`: ruter, drejegreb, højreklik/træk og gem/åbn; `node checks/browser.test.cjs`: betjening, grafik, tab, march, download, lys-/skraveringsværdier og genindlæsning |
| Genbygning af atlasser | `python build_assets.py --self-test`, derefter fuld kontrol af billedpar og rigtige assets i browser |
| Figurer, animationsvarianter og ganghastigheder | `node --test animation.test.mjs` og `node checks/characters.test.cjs`: begge roller, alle stilstandsvarianter, hastighedsgrupper og 16 vinkler |

Browserkontroller kræver den lokale tjeneste, Playwright og Chrome. `STUDIO_URL` kan vælge en anden testadresse. De aktuelle scripts angiver udviklingsmaskinens Playwright- og Chrome-stier direkte; tilpas dem eller opret en fælles konfiguration ved brug på en anden maskine. Dette påvirker kun udviklingskontrollerne. Tests starter en separat browser uden brugerens igangværende studie. De producerer rapporter og PNG'er i `checks/`, og må ikke starte eller ændre den tidligere spilmotor.

Kontrollér relevante pixels og visuelt udtryk, når shaderen ændres; et kompileret shaderprogram er ikke tilstrækkeligt bevis. Gem/åbn-kontrollen skal vente på afsluttet asynkron filindlæsning. Gentag eller udvid kun kontroller ved nye ændringer, fejl eller ubesvarede spørgsmål. Der er ingen valideret måling af fuld hærskala.

## Genbygning og eksport er en separat værktøjskæde

De færdige runtimeassets er inkluderet. [build_assets.py](build_assets.py), [tools/export_v2_models.py](tools/export_v2_models.py), [tools/export_relightable.py](tools/export_relightable.py) og [tools/verify_relightable.py](tools/verify_relightable.py) er udviklingsværktøjer med yderligere input fra arbejdsområdets søstermappe `sprite-studio/` og brugerens kildedata. De er ikke nødvendige for at starte en klonet app. Se deres `--help`, [README.md](README.md) og [assets/README.md](assets/README.md) før en ny eksport.

`tools/export_v2_models.py` køres i Blender 5.2 med `Musketeer.blend` eller `Pikeman.blend` fra `../assets/musketeer/v2models/` og læser deres egne actionvarianter. Det skriver en rå reference og den færdige parrede eksport i en ny mappe. Pikeman bruger `Ilde1/2/3` som sine tre pike-stilstandsposer; de arvede `Idle1/2/3` med musketerposer udelades. Kildens originale actionnavne bevares som provenance, mens eksportens navne er ensartede. Musketerens manglende gemte stregsetup får samme stregstil som Pikeman under eksporten.

`tools/export_relightable.py` er den fælles renderdel og kan også køres med en tidligere `sprites.json` som reference for poser og kameraramme. Brug en ny outputmappe. Kildematerialer kopieres, formskyggen slås fra i kopierne, og kildens `.blend` gemmes aldrig. En kort `--smoke`-eksport er egnet før en hel serie. Afbrudte eksporter kan genoptages med kontrolsummer for færdige par. Verifikationen skal dække alle forventede farve-/normalpar, rå normaldata og den uændrede kildefil.

[tools/render_v2_parallel.py](tools/render_v2_parallel.py) kan fordele en forberedt v2-serie mellem flere Blender-processer. Det bruger de eksisterende referencer og samler arbejdernes kontrolsummer før `READY`. Se scriptets `--help` for lokale Blender-stier og antal arbejdere. Det er kun et eksportværktøj; normal start kræver fortsat ingen Blender.

Atlasbygning kobler krop og normaler gennem beskæring og placering. Den bevarer fodanker, målestok, animationstider, `kind`, `gait` og `nominalSpeed` samt pikehjørner og masker. Antallet af billeder og clips læses fra kilden. `--registry` registrerer en vellykket pakke med `--character-id`, `--label` og `--role pike|shot`. Tidligere runtimeassets kopieres til `versions/` under figurens mappe ved erstatning; skiftet fra enkeltfigur bevarer også en kopi under `assets/versions/`. Gem buildrapport og dokumentér kilden; ret ikke atlasrektangler manuelt i kun ét af krops-/normalsporene.

## Kendte begrænsninger og næste systemer

- Hjuldrejningen drejer hele formationen samlet. Kolonnens geledder følger endnu ikke efter hinanden gennem samme drejepunkt.
- Formationerne har lokal pladsbegrænsning og ingen omvejssøgning eller global ordreprioritering. Opdateringsrækkefølgen er den aktuelle formationsrækkefølge.
- Kamp, morale, skydning, samlet hærstyring og historisk kalibrering er endnu ikke implementeret.
- Skyttefløje viser musketerens gang/løb og stilstand. Skydning og genladning er endnu ikke knyttet til en kampmodel.
- Piker og kroppe har billboarddybde; ejerens indbyggede maske er bevaret, men overlap med andre figurer og terræn er tilnærmet. En fysisk 3D-pike kan afprøves som separat visningsændring.
- Lyset giver formskygge på kroppen og en stiliseret oval kontaktflade på jorden. Jordskyggen beregner ikke figurens silhuet; der findes ingen skygger på nabosoldater eller pikenormaler.
- Kameraelevation og billedretninger følger eksporten. Frit pitch kræver flere eller andre billeder og en ændret visningsmodel.
- Browsergemning er lokal for browser/origin; den udgør ikke deling eller backup. Downloadede JSON-filer kan flyttes mellem sessioner.
- Prototypen dokumenterer en mulig retning. Den indeholder ingen sammenligning af sprite- og 3D-ydelse eller løfte om fuld hærskala.

## Automatisk animationsbibliotek

`library.html`, `library.mjs` og `library.css` er den selvstændige biblioteksfane. `library_api.py` ejer lokale requests, native `.blend`-filvalg og aktivering i `assets/characters.json`. `library_jobs.py` ejer inspektion, baggrundsprocesser, afbrydelse og immutable resultatversioner. Blender-arbejderen og nødvendige eksporthjælpere ligger i `tools/`; kildemodellen åbnes med `--disable-autoexec` og gemmes aldrig. Normal serverstart importerer ingen billedbiblioteker eller Blender-moduler.

API: `GET /api/library`, `GET /api/library/jobs`, `GET /api/library/jobs/<id>`, samt JSON-POST til `/api/library/pick`, `/inspect`, `/render`, `/activate`, `/appearance` og `/jobs/<id>/cancel`. Serveren validerer lokal Host/Origin og begrænser JSON til 1 MiB. Filvalg er valgfrit; en indsat lokal sti giver samme forløb. Backend ejer outputstier, versionsnumre og manifests. Bibliotekets passive figurer indgår ikke i runtime-registret.

Automatisk actiontilknytning bruger rig-/slotassociation; den må ikke vælge første action-slot uden evidens. Navne bruges kun til forslag om animationstype, ganghastighed og fravalg af kendte arvede poser. Brugeren kan ændre eller fravælge forslagene. NLA-blanding er adskilt fra actionrendering. Alle valgte clips får fælles indramning over animationernes samples og kameraretninger. Root motion fjernes fra billedposen; modellen ejer fortsat al bevægelse i landskabet.

`library_packer.py` fordeler store eksporter over flere atlaspar på højst 4096 × 4096. `character.pages` beskriver teksturerne, og `frame.page` vælger atlasgruppen; krop og normaler bruger stadig præcis samme beskæring og placering. Ældre manifests uden pages er uændrede. Rendererens batches følger figur og atlasgruppe, og optællinger summeres på tværs af grupper. Piker bevarer deres lokale fodanker og ejerens maskering.

Aktivering ændrer kun den aktive figurliste efter et fuldført eksportresultat og kræver både idle og walk. Biblioteksfanen meddeler ændringen til Formationsstudio via `BroadcastChannel`/storage; `main.mjs` indlæser teksturerne transaktionelt uden at ændre scenen, kameraet eller lysvalget. En mislykket indlæsning beholder de tidligere teksturer.

Målrettede kontroller findes i `library_api_test.py`, `library_jobs_test.py` og `test_library_packer.py` og `checks/library.test.cjs`/`checks/paged-assets.test.cjs`. API-kontrollen dækker lokal adgang, JSON, versionaktivering og bevarede kilder. En kort rigtig Blender-serie dækker opdagelse, farve-/normalpar, pike og publicering; browserkontrollen dækker bibliotekets forløb og forhåndsvisning. Ved ændringer i rendererens atlasindlæsning køres også de eksisterende lyskontroller.

Pikeudseende normaliseres i `pike-appearance.mjs`: darkness 0–1, opacity 0–2, widthScale 0.5–3; standarderne 0/1/1 bevarer den gamle visning. Bibliotekets tre skydere viser ændringen straks. POST `/api/library/appearance` gemmer pr. figur/version i `assets/library/appearance.json` og opdaterer den aktive registry-entrys `pikeAppearance`. Aktivering genbruger dette valg. Kildepakken ændres ikke. Rendererens pike-tegning får separat farve-/alfastyring; kroppens uniforms gendannes ved hver frame. Bredden strækker pikestrimlen på tværs af dens længdeakse uden at flytte længdeaksen eller fodankeret. Dette er en visningsjustering af den eksisterende sprite og dens indbyggede maske. `checks/library-pike.test.cjs` dækker livekontrol, gemning/genåbning og aktive figurer; den fokuserede GPU-kontrol dækker pikepixels og uændret krop.
