# Udvikling af Formationsstudio

Denne vejledning beskriver den fungerende prototype pr. 8. oktober 2026. Læs først [AGENTS.md](AGENTS.md), derefter [README.md](README.md) for betjening og [assets/README.md](assets/README.md) for figurernes billedformat. Appen er et selvstændigt studie af formationsfelter; soldaterne viser felternes tilstand.

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
                       assets/character.json
                       body/normal/pike-atlasser

terrain.mjs <── model.mjs og renderer.mjs
lighting.mjs <── main.mjs og renderer.mjs
```

[model.mjs](model.mjs) og [terrain.mjs](terrain.mjs) importerer ingen DOM, grafik eller spritefiler. `StudioModel` ejer styrke, nuværende layout, marchmål, retning og tid. `snapshot()` producerer verdensvendte feltpolygoner samt en deterministisk udvælgelse af dekorative soldater. Den ændrer ikke modellen. `visualBudget` og skjulte soldater må derfor aldrig ændre march, omformning, tab eller kollisionsresultat.

[main.mjs](main.mjs) ejer input, paneler, afspilning, filåbning, browsergemning og `view`. Når afspilningen kører, bruger den en akkumulator med modeltrin på `1/60` sekund. Rendering følger `requestAnimationFrame`. `StudioModel.step(dt)` begrænser et enkelt kald til 0,5 sekund og opdeler det i trin på højst 0,05 sekund. **+ ½ s** udfører 30 modeltrin og pauser. Langvarige afbrydelser bliver ikke indhentet som ubegrænset simulationstid.

[renderer.mjs](renderer.mjs) ejer terrænmesh, feltmarkeringer, spriteinstanser, projektion, kamera og shaders. Et snapshot tegnes sammen med separat visningstilstand. Terræn tegnes først, derefter feltmarkeringer, kropsinstanser og pikeinstanser. Kroppe og piker bruger hver sin fælles tegning med `drawArraysInstanced`; der er ingen 3D-skeletter i runtime. `renderer.stats` er simple tegneoplysninger og udgør ikke en ydelsesmåling.

[server.py](server.py) er en statisk Python-filserver på loopback. `/health` identificerer appen. På Windows reserverer serveren porten eksklusivt, så to processer ikke konkurrerer om samme adresse. `--open` åbner den eksisterende tjeneste, hvis `/health` identificerer den som Formationsstudio. En anden port kan vælges med `--port`.

## Model, geometri og koordinater

Verdenskoordinater måles i meter: `x,z` ligger på jorden, og `y` er højde. Model- og kameravinkler er radianer. `heading = 0` vender mod `-Z`; en positiv drejning går mod `+X`. Brugerfladen og solindstillinger viser grader. Undgå at overføre grader direkte til model eller kamera.

En fænnike består af lokale rektangulære delfelter. `desiredLayout(f)` beregner ønsket form ud fra styrke, filer, afstande, slagorden/kolonne og sammensætning. Rene pikenerformationer har ét felt. Blandede formationer har en pikekerne og to skyttefelter, som i kolonne følger bag kernen. `f.layout` er den aktuelle, gradvist ændrede form. `fieldsOf()` drejer og flytter den til verdenspolygoner.

`interpolatedLayout()` nærmer sig den ønskede form. `stepFormation()` kontrollerer forslag mod kortgrænse, terrænhindringer og andre formationers aktuelle delfelter. Hvis en fuld omformning blokeres, kan mindre ændringer af bredde, forskydning eller dybde stadig skabe plads. March og vending er også pladsbegrænset. Der findes ingen omvejssøgning; en blokeret formation venter.

`terrain.mjs` leverer `heightAt()`, hindringspolygoner og overlap via separerende akser for konvekse polygoner. Slaget foregår inden for `[-70,70]` i både x og z. Passagen har en fri bredde på 8 m. Ved terrænskifte flytter `setTerrain()` kun felter, der rammer de nye hindringer, og stopper deres ordre. Hvis der ikke findes plads, rulles hele terrænskiftet tilbage.

Tab har tre adskilte politikker: `holes` bevarer plads og viser deterministiske huller, `narrow` reducerer fronten, og `ranks` reducerer geledder. `footprintCount` bevarer den oprindelige kapacitet ved huller. Dekorative slots fordeles ved en stabil hash af slot og seed; animationens fase er også deterministisk. Ændring af tegnebudget må ikke skabe eller fjerne modelstyrke.

## Hvor en ændring hører hjemme

| Ændring | Primært sted | Følgearbejde |
| --- | --- | --- |
| Formationers sammensætning, feltbredde og geledder | `desiredLayout()` i `model.mjs` | Modelkontroller; paneler hvis nye parametre |
| March, vending, omformning, plads og tab | `StudioModel` i `model.mjs` | Modelkontroller og relevant passage/sammenstødsprøve |
| Nye terrænhøjder eller hindringer | `terrain.mjs` | `terrainNames`, panelnavne/knapper og modelkontroller |
| Nye soldattyper og animationer | `assets/character.json`, `loadAssets()` og `spriteInstances()` | Assetsformat, fodankre, retninger og rigtige spriteprøver |
| Kamera, dybde, projektion og feltmarkeringer | `renderer.mjs` | `screenToGround()` og kontrol af klik på terræn |
| Verdenssol, normalakser og validering af lys | `lighting.mjs` | Shaderparitet og lyskontroller |
| Skravering, farve eller filtrering | Spritefragmentshaderen i `renderer.mjs` | GPU-kontrol og nær-/oversigtsbillede |
| Indstillinger og dansk betjening | `main.mjs`, `index.html`, `studio.css` | Gem/åbn, standarder og browserkontrol |
| Scenegemning og migration | `sceneDocument()` / `openScene()` og modelens eksport/import | Rundtur og ældre filer |

Bevar felterne som simulationsgrundlag, når nye systemer tilføjes. Individuel soldaterkollision, kampautoritet eller ændring af styrke ud fra tegnede figurer er en særskilt designbeslutning.

## Scenefiler og migration

En downloadet fil har det ydre schema `walking-fortress-formation-study-v1`. Den indeholder `model`, `view` og `lossMode`. `model` har sit eget schema `walking-fortress-formations-v1` og indeholder terræn, tid, ID'er, valg og formationer. `view` indeholder `display`, `showTargets`, `showPikes`, `visualBudget`, `camera` og `lighting`. Kameraet gemmer `yaw`, `zoom`, `centerX` og `centerZ`; elevation følger figurens eksport.

Modelens eksport kloner formationerne, inklusive marchmål, aktuelle omformningslayout og kapacitet efter tab. Import validerer schema, terræn, entydige positive ID'er og højst 24 formationer. Den normaliserer input og genberegner næste ID. Et manglende eller ugyldigt layout erstattes med den ønskede form. Brugerfladen tillader aktuelt højst seks formationer at blive oprettet; filformatets grænse er højere.

`openScene()` normaliserer visningsfelter, indlæser kamera og sætter afspilningen på pause. Den aktuelle UI begrænser tegnebudget til 60–2400. Ved filåbning afvises filer over 2 MiB. Browserkopien findes i `localStorage` under `wf-formation-study`; kun **Gem studie** skriver denne kopi. Opstart forsøger at åbne den senest gemte kopi. Tjenesten har ingen database eller filskrivende API.

Lysstandarder kommer først fra `DEFAULT_LIGHTING`, derefter fra figurens `character.lighting`. Manglende felter i tidligere study-v1-filer får disse standarder. Manglende eller ukendt `style` bliver `hatch`, mens et udtrykkeligt valgt `solid` bevares. Solazimut kanoniseres til `[0,360)`, så eksempelvis `-45` bliver `315`. `cleanLighting()` fastholder `softness: 0` og UI-intervaller for solhøjde og tærskel.

Ved kompatible nye valgfri felter: tilføj standard, normalisering, UI, eksport/import og en kontrol med en gammel fil, hvor feltet mangler. Ved en inkompatibel ændring: opret en udtrykkelig migration før import; overskriv ikke betydningen af det eksisterende schema uden en migration. Bevar rundtur af en igangværende omformning.

`window.formationStudio` bliver tilgængelig efter assetindlæsning. Den giver browserkontroller adgang til `model`, `renderer`, `view`, seneste `snapshot`, `openScene()`, `sceneDocument()` og `pause()`. Det er et udviklingsindgangspunkt med direkte referencer, ikke et stabilt eksternt API. Kontroller, at det er klart, før en browsertest bruger det.

## Billeder, lys og skravering

Runtime læser kun [assets/character.json](assets/character.json) og atlasser fra samme mappe. Figuren har 16 retninger, gang og stilstand. Retning vælges ud fra kameraets yaw minus soldatens heading, justeret for første eksportazimut og vinkeltrin. Kameraet er ortografisk med fast elevation omkring 30,05°, som matcher billederne.

`body.pivot` er fodankeret i det beskårne kropsbilledes lokale pixelrum. Krop og pike bruger samme lokale rum og `pixelsPerUnit`. Piken kan have fire særskilte hjørner; dens maske mod ejerens krop og hånd er allerede indbygget i billedet. Anvend ikke tidligere editortransformer igen. Se [assets/README.md](assets/README.md) for detaljer.

Kroppens albedo indeholder basisfarve, kontur og folder, men ingen gammel formskygge. `normals.png` deler kropsatlassets størrelse og præcis samme rektangler. RGB er rå lineære data, kodet som `0.5 * normal + 0.5`; alfa er modellens overfladedækning. Normalteksturer uploades som RGBA8 uden browserfarvekonvertering. PNG-overførselstags og farveprofiler må ikke omfortolke normaler til farver. Nedskalering vægter efter dækning og normaliserer igen; kant-RGB er udvidet uden at ændre alfa.

Normalens akser er figurens Blender-referenceverden X,Y,Z. Shaderen bytter til studioets X,Z,Y og drejer efter soldatens heading. Den fælles sol fra `lightDirection()` er allerede i studioets verdensrum og bruges også af terrænet. Kameraet må ikke dreje solen. Lysstyrken beregnes som `0.5 + 0.5 * dot(normal, sol)`. Tærsklen anvendes på denne værdi. Kontur-/foldpixels bliver ikke lysere ved skygge, og pixels uden normaldækning modtager ingen formskygge. Piker har aktuelt ingen normalbaseret formskygge.

Skravering er procedural og kræver ingen ny Blender-eksport. Koordinaterne ligger i billboardets meter og er forankret ved fødderne. Brug ikke `gl_FragCoord`, som vil få mønstret til at glide ved kameraflytning. Normalerne og solen bestemmer skyggen; mønstret bestemmer, hvor blækket dækker den.

| Felt i `view.lighting` | Standard | Tilladt interval | Betydning |
| --- | --- | --- | --- |
| `style` | `hatch` | `hatch` / `solid` | Streger eller fyldte blækfelter |
| `hatchSpacing` | 0,12 m | 0,005–0,5 m | Afstand mellem de tætteste parallelle streger |
| `hatchWidth` | 0,018 m | 0,0005–0,055 m | Stregbredde |
| `hatchAngle` | 45° | 0–180° | Stregvinkel i billboardplanet |
| `crossStart` | 0,22 | 0,05–0,9 | Skyggedybde, hvor krydsstreger begynder |

Skyggedybde er `(threshold - brightness) / threshold`, klippet til `[0,1]`. Nær kanten bruges primærstreger ved fire gange afstanden. Ved dybde 0,16 tilføjes streger ved to gange afstanden, og ved 0,42 bruges den tætteste afstand. Perpendikulære krydsstreger begynder ved `crossStart`, og et tættere sæt kommer 0,25 længere inde. Streger deler et fælles nulpunkt, så tættere niveauer tilføjer streger mellem de eksisterende. UI viser centimeter og tillader afstandstrin på 0,1 cm og breddetrin på 0,05 cm.

WebGL-konteksten anmoder om antialiasing; 4× MSAA er verificeret på udviklingsmaskinen, men antal samples afhænger af browser og grafikdriver. MSAA glatter geometriske kanter. Streger har desuden analytisk arealfiltrering med `fwidth`, og skyggegrænsen har en smal pixelbaseret udjævning. Beregn derivativer før `discard` eller divergerende coveragegrene. Når flere streger falder inden for samme pixel, bliver deres samlede areal repræsenteret som delvis dækning. Tæt skravering kan derfor ligne en tone ved lav skærmopløsning. Bredde og afstand begrænses uafhængigt; shaderen begrænser hver stregfamilies dækningsandel til 90 %, men brede streger med lille afstand bliver visuelt meget mørke. Sænk bredden sammen med afstanden, hvis mellemrum skal bevares. Runtimefiguren er stadig ved en nominel 100 px målestok; antialiasing tilføjer ikke konturdetaljer ved kraftig indzoomning.

## Kontroller ved ændringer

Kør kommandoerne fra repositoryets rod. Model- og lyskontroller bruger kun Node.js' indbyggede testløber:

```powershell
node --test model.test.mjs lighting.test.mjs
```

| Ændring | Målrettede kontroller |
| --- | --- |
| Model eller terræn | `model.test.mjs`: tegnebudget-uafhængighed, feltgeometri, passage, sammenstød, tab, scenebevarelse, terrænskifte, pladsmangel, animationstilstand |
| Lyskonventioner og gemte parametre | `lighting.test.mjs`: akser, verdenssol, soldatdrejning, tærskel, normalisering og gammel/hatch/solid tilstand |
| Shader, UV'er eller normaltekstur | `node checks/lighting.test.cjs`: kendte pixelværdier; `node checks/lighting-assets.cjs`: rigtige figurer |
| Skravering og filtrering | `node checks/hatching.test.cjs`: stregdækning, krydsstreger, basisfarve, udjævning, lyse flader og panforankring |
| Skraveringens udtryk | `node checks/hatching-preview.cjs`: nærbillede og formationsoversigt; inspicér begge |
| UI, kamera og scenefiler | `node checks/browser.test.cjs`: betjening, grafik, tab, march, download, lys-/skraveringsværdier og genindlæsning |
| Genbygning af atlasser | `python build_assets.py --self-test`, derefter fuld kontrol af billedpar og rigtige assets i browser |

Browserkontroller kræver den lokale tjeneste, Playwright og Chrome. `STUDIO_URL` kan vælge en anden testadresse. De aktuelle scripts angiver udviklingsmaskinens Playwright- og Chrome-stier direkte; tilpas dem eller opret en fælles konfiguration ved brug på en anden maskine. Dette påvirker kun udviklingskontrollerne. Tests starter en separat browser uden brugerens igangværende studie. De producerer rapporter og PNG'er i `checks/`, og må ikke starte eller ændre den tidligere spilmotor.

Kontrollér relevante pixels og visuelt udtryk, når shaderen ændres; et kompileret shaderprogram er ikke tilstrækkeligt bevis. Gem/åbn-kontrollen skal vente på afsluttet asynkron filindlæsning. Gentag eller udvid kun kontroller ved nye ændringer, fejl eller ubesvarede spørgsmål. Der er ingen valideret måling af fuld hærskala.

## Genbygning og eksport er en separat værktøjskæde

De færdige runtimeassets er inkluderet. [build_assets.py](build_assets.py), [tools/export_relightable.py](tools/export_relightable.py) og [tools/verify_relightable.py](tools/verify_relightable.py) er udviklingsværktøjer med yderligere input fra arbejdsområdets søstermappe `sprite-studio/` og brugerens kildedata. De er ikke nødvendige for at starte en klonet app. Se deres `--help`, [README.md](README.md) og [assets/README.md](assets/README.md) før en ny eksport.

Eksportværktøjet køres i Blender 5.2 med en gemt `.blend` og et tidligere `sprites.json` som reference for poser og kameraramme. Brug en ny outputmappe. Kildematerialer kopieres, formskyggen slås fra i kopierne, og kildens `.blend` gemmes aldrig. En kort `--smoke`-eksport er egnet før en hel serie. Afbrudte eksporter kan genoptages med kontrolsummer for færdige par. Verifikationen skal dække alle forventede farve-/normalpar, rå normaldata og den uændrede kildefil.

Atlasbygning kobler krop og normaler gennem beskæring og placering. Den bevarer fodanker, målestok, animationstider samt pikehjørner og masker. Tidligere runtimeassets kopieres til `assets/versions/` ved erstatning. Gem buildrapport og dokumentér kilden; ret ikke atlasrektangler manuelt i kun ét af krops-/normalsporene.

## Kendte begrænsninger og næste systemer

- Formationerne har lokal pladsbegrænsning og ingen omvejssøgning eller global ordreprioritering. Opdateringsrækkefølgen er den aktuelle formationsrækkefølge.
- Kamp, morale, skydning, samlet hærstyring og historisk kalibrering er endnu ikke implementeret.
- Skyttefløje bruger pikenerens krop uden pike. Der er ingen særskilt skyttefigur eller skytteanimation.
- Piker og kroppe har billboarddybde; ejerens indbyggede maske er bevaret, men overlap med andre figurer og terræn er tilnærmet. En fysisk 3D-pike kan afprøves som separat visningsændring.
- Lyset giver formskygge på kroppen. Der findes ingen kastede skygger på jorden eller nabosoldater og ingen pikenormaler.
- Kameraelevation og billedretninger følger eksporten. Frit pitch kræver flere eller andre billeder og en ændret visningsmodel.
- Browsergemning er lokal for browser/origin; den udgør ikke deling eller backup. Downloadede JSON-filer kan flyttes mellem sessioner.
- Prototypen dokumenterer en mulig retning. Den indeholder ingen sammenligning af sprite- og 3D-ydelse eller løfte om fuld hærskala.
