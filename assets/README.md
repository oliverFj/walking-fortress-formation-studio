# Figurer, animationer og lys

Formationsstudioet bruger nu de to gemte modeller `Musketeer.blend` og
`Pikeman.blend` fra `../assets/musketeer/v2models/`. De oprindelige Blender-filer
er uændrede. Stier til kilder er relative til formationsstudioets Git-rod;
normal start læser kun de færdige filer i denne assetsmappe.

`characters.json` har schema `walking-fortress-characters-v1`. Det knytter
rollen `pike` til `pikeman`, rollen `shot` til `musketeer` og bruger Pikeman
som standardfigur. Hver figur har sin egen mappe med `character.json`,
`body.png`, `normals.png`, kontrolbilleder og `build_report.json`.
Pikeman har desuden `pikes.png`; musketerens musket er en del af kroppen.

## Animationer

Begge figurer har 16 retninger med 22,5° afstand, første kameraretning 45°
og kameraelevation 30,05°. Der er tre stilstandsvarianter pr. figur.

| Figur | Stilstand | Langsom gang 0,5 m/s | Gang 1,5 m/s | Løb 3 m/s | Farve-/normalpar |
| --- | --- | --- | --- | --- | --- |
| Pikeman | 3 varianter | 1 variant | 3 varianter | 1 variant | 2.112 |
| Musketeer | 3 varianter | 2 varianter | 3 varianter | 2 varianter | 2.496 |

Stilstand har 24 billeder over 4 sekunder; gang og løb har 12 over
2 sekunder. De er samplet ved 6 billeder pr. sekund fra originalernes
24 billeder pr. sekund, uden at duplikere løkkens sidste billede.
Hastighedsgrupperne kommer fra actionnavnene og er ikke fysisk målt.

`character.json` bevarer schema `walking-fortress-formation-character-v2`.
`clips` er et objekt med frie navne. Hvert clip har `kind: idle|walk`,
`duration`, `frameCount` og `directions`; bevægelsesclips har også `gait`
(`walk` eller `run`) og `nominalSpeed`. `action` bevarer Blender-actionnavnet.
Runtime vælger den nærmeste hastighedsgruppe ud fra den faktiske bevægelse
i soldatens plads og en deterministisk variant. Under hjuldrejning kan
indersiden bruge langsom gang, mens ydersiden løber. En integreret fælles
formationscyklus holder soldaterne i takt gennem hastigheds- og variantskift,
med en fast individuel faseforskydning på op til ±4 procent af cyklussen.
Stilstand beholder ±10 procent individuel tempovariation. Dette ændrer kun visningen; formationens
felter ejer stadig positioner og bevægelse.

Pikemans stilstandsclips kommer fra kildens `Ilde1`, `Ilde2` og `Ilde3`
(stavefejlen er bevaret i `action`). De arvede `Idle1/2/3` er musketerposer
og indgår ikke i pikenerens eksport. Musketerens manglende gemte stregsetup
får Pikemans kontur- og foldstil i hukommelsen under eksporten.

## Billeder og målestok

Kildeserierne er `../assets/musketeer/sprite_exports/V2_Pikeman_20261012/`
og `V2_Musketeer_20261012/`. De indeholder alle 4.608 par i 256 × 256 pixel,
referencemanifest, renderkontrolsummer, `validation.json` og `READY`.
Alle par beholdes som input til senere genbygning.

Runtime bruger en nominel tilemålestok på 100 pixel. Hver figurs egen
ortografiske skala omsættes gennem `pixelsPerUnit`, så begge tegnes i
verdensmeter. Atlasbygningen udvider automatisk bredden efter antal billeder,
men hvert atlas er højst 4096 × 4096 pixel. De faktiske mål og arealer findes
for hver figur i dens `build_report.json` og `character.json`.
Pikenerens krops-, normal- og pikeatlas er alle 2048 × 4096 pixel.
Musketerens krops- og normalatlas er 4096 × 4096 pixel.

`body.rect` er `[x, y, bredde, højde]` i atlaspixels. `body.pivot` er
fodpunktet i det beskårne kropsbilledes lokale pixelrum. `pike.corners` er
strimlens fire hjørner i samme rum: øverst venstre, øverst højre,
nederst højre og nederst venstre. Begge dele forskydes med samme beskæring.
Skalering og eventuelle editortransformer må ikke anvendes igen.

Piken er et separat smalt blækelement med 3.671 gemte, ordnede maskeringer
mod ejerens krop og hånd. De beskriver ikke terrænet eller andre soldaters
dybde. Piken har intet selvstændigt normalkort. En figur uden separat pike
har `pikeAtlas: null`, `pikeAtlasSize: null` og ingen `frame.pike`.

## Normalkort og fælles lys

Farvebilledet indeholder basisfarve, kontur og folder, men ingen formskygge.
`normalAtlas` og `bodyAtlas` har identiske dimensioner, billedudsnit og
fodankre. Hvert `body.rect` bruges også til normalkortet.

Normal-RGB gemmer `0.5 * enhedsnormal + 0.5` i figurens oprindelige
Blender-verdensakser: X mod højre, Y mod syd og Z op. Det er lineære data
uden sRGB-overførsel eller farveprofil. Runtime bytter til studioets
X,Z,Y og drejer efter soldatens retning. Kameraet ændrer kun billedvalget;
landskabets sol forbliver fast i verden.

Alfa er modellens overfladedækning. Konturstreger kan findes i farvebilledet,
hvor normalkortet er transparent; de bevares uden formskygge. Nedskalering
filtrerer normalvektorer vægtet med dækning og normaliserer igen. RGB udvides
fire pixel ind i den transparente kant uden at ændre alfa, så filtrering
ikke giver en forkert normal ved konturen.

Hver figurs `lighting` bevarer dens gemte blækfarve, styrke, tærskel og sol.
Studiet bruger ét fælles lys, med Pikemans standarder: styrke 0,55,
tærskel 0,45, azimut 315° og elevation 55°. Tærsklen anvendes på
`0.5 + 0.5 * normal · lys`; `softness` er 0. Musketerens musket har sine
egne normalpixels i det samme kropsatlas og modtager dette lys.

Skravering beregnes under visningen, forankret ved figurens fødder i
billedplanet. Normalerne bestemmer skyggeområdet; parallelle og krydsende
streger bestemmer blækdækningen. Der kræves ingen ny Blender-eksport for
at ændre streger, solretning eller blækfarve.

## Kontrol og genbygning

`preview.png` viser en bevægelsesvariant i fire retninger uden formskygge.
`normal_preview.png` viser de samme normaldata. `lighting_preview.png`
viser disse billeder med lys fra to modsatte sider. Det sidste er en
statisk maskekontrol; studiet beregner selv lys og skravering ved visning.

`build_report.json` registrerer kilder, kontrolsummer, clips, atlasmål,
masker og kontrol af samtlige pakkede billedpar. Krop og normaler bruger
præcis de samme beskæringer og atlasplaceringer. De fulde kildeserier
kontrolleres med `tools/verify_relightable.py`: parantal, billedmål,
poseindramning, normalernes vektorlængder, rå normaldata og uændret kildefil.

Normal start kræver Python og WebGL2. Genbygning kræver Blender 5.2,
Pillow, NumPy, Node.js og søstermapperne `sprite-studio/blender`,
`sprite-studio/vendor`, `sprite-studio/web/pike.mjs` samt
`tools/blender/pikeman_preview_geometry.mjs`. De er udviklingsværktøjer
og indgår ikke i runtime. `--node` vælger en anden Node-sti end denne
udviklingsmaskines standard.

Kør fra formationsstudioets Git-rod, og angiv Blender og Node:

```powershell
$blenderExe = '<sti til Blender 5.2/blender.exe>'
$nodeExe = '<sti til node.exe>'
$workspace = (Resolve-Path '..').Path
$series = Get-Date -Format 'yyyyMMdd_HHmmss'
$musketeerExport = Join-Path $workspace ('assets/musketeer/sprite_exports/V2_Musketeer_' + $series)
$pikemanExport = Join-Path $workspace ('assets/musketeer/sprite_exports/V2_Pikeman_' + $series)

& $blenderExe --background --factory-startup --disable-autoexec (Join-Path $workspace 'assets/musketeer/v2models/Musketeer.blend') --python './tools/export_v2_models.py' -- --output $musketeerExport
& $blenderExe --background --factory-startup --disable-autoexec (Join-Path $workspace 'assets/musketeer/v2models/Pikeman.blend') --python './tools/export_v2_models.py' -- --output $pikemanExport
python ./tools/verify_relightable.py $musketeerExport
python ./tools/verify_relightable.py $pikemanExport
python ./build_assets.py --self-test
python ./build_assets.py --source $musketeerExport --node $nodeExe --size 100 --out ./assets/musketeer --character-id musketeer --label Musketer --registry ./assets/characters.json --role shot
python ./build_assets.py --source $pikemanExport --node $nodeExe --size 100 --out ./assets/pikeman --character-id pikeman --label Pikener --registry ./assets/characters.json --role pike
```

`--smoke` giver en kort renderprøve; dens kontrol køres med `--partial`.
Brug en ny mappe til den fulde serie. Afbrudte eksporter genoptages med
samme model, reference, indstillinger og mappe; færdige par genbruges efter
kontrolsummer. `tools/render_v2_parallel.py --help` beskriver parallel
rendering af allerede forberedte referencer. `tools/export_relightable.py`
er den fælles renderdel og understøtter også de tidligere referenceeksporter.

`build_assets.py --self-test` dækker normalfiltrering ved transparente kanter,
fælles atlasudsnit, skalering af pike/masker og navngivne varianter uden
pike. Se [DEVELOPMENT.md](../DEVELOPMENT.md) for de målrettede browserkontroller.

## Tidligere runtime

Den foregående relightable karakter med 432 par er bevaret som kopi i
`versions/relightable-v2_20261012_185714_299027/`. Den første version med
bagt blækskygge ligger i `versions/ink-baked-v1_20261008_115558/`.
De oprindelige rootfiler `character.json`, `body.png`, `normals.png` og
`pikes.png` er også bevaret som reference og kan stadig indlæses direkte.

Ved erstatning kopierer builderen en eksisterende figurpakke til
`versions/` under figurens mappe, før den skriver nye filer. Ved første
skift til et figurregister tages også en kopi af den tidligere enkeltfigur
under denne assetsmappes `versions/`. Kilde-Blenderfiler og rå spritepar
ændres ikke af atlasbygningen.


## Marchlyd

`audio/boots/` indeholder ti individuelle gang-/løbetrin skåret fra Nox_Sounds
[Footsteps Boots Gritty Ground Gravel](https://freesound.org/people/Nox_Sound/sounds/530589/)
(CC0). Originalen ændres ikke; `tools/extract_boots.py` bevarer grushalerne og
laver korte fades ved kanterne. Kontaktankre og originale tidsudsnit findes
i `audio/boots/manifest.json`.

`audio/drums/` har seks uændrede runtimeoptagelser af cabled_mess' Frame drum
fra det tidligere Walking Fortress. `audio/drums/manifest.json` bevarer
hvert Freesound-link, CC0-licens, kildehash og anslagsanker. Runtime læser
kun disse kopier. De to manifests indeholder `samples` med relativt `file`,
`contact` i sekunder fra filstart og kildeoplysninger. Web Audio dekoder
filerne til samme samplefrekvens, før de blandes eller afspilles.

## Figurbibliotek og flere billedark

`library/index.json` registrerer figurer og deres færdige resultatversioner. Nye versioner skrives i nye undermapper; eksisterende runtimefigurer vises som bibliotekets udgangspunkt. Biblioteket bevarer også kildehenvisning, valgte animationer og renderindstillinger. Ingen original `.blend`-fil ændres.

Bibliotekets større figurpakker bruger det samme character-v2-format med valgfri `pages`. Hvert element har `bodyAtlas`, `normalAtlas`, `pikeAtlas` og deres mål. `frame.page` vælger elementet for både krop, normaler og eventuel pike. Alle ark er højst 4096 × 4096, og albedo/normal placeres sammen som før. Manifests uden `pages` bruger de tidligere topniveauatlasser. Flere ark bevarer billedkvaliteten ved flere animationer.

Kun versioner valgt til formationernes roller ligger i `characters.json`; øvrige figurer og enkeltstående animationer kan blive i biblioteket uden at optage grafikteksturer i formationsfanen. Aktivering kræver gang og stilstand. Bibliotekets forhåndsvisning kan vise alle animationstyper.

Pikens efterfølgende visningsvalg gemmes pr. figur/version i `library/appearance.json` og sendes til aktive figurer som registry-entryens `pikeAppearance`. Mørkhed, dækevne og breddefaktor ændrer kun pikestrimlen i visningen; body-/normalpar, animationsframes og originale pikeatlasser bevares.
