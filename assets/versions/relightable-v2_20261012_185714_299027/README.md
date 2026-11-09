# Pikenerens billeder og lys

De selvstændige billeder er lavet fra brugerens gemte Blender-figur
`../assets/musketeer/Pikeman_animation.blend` og den valgte Stregstil. Kilden er
`../assets/musketeer/sprite_exports/Pikener_normals_20261008_151700`.
Stierne er her relative til formationsstudioets Git-rod. De peger ud af
lageret til den oprindelige arbejdsmappe; en normal start læser dem ikke.
Blender-filen og de tidligere spriteeksporter er ikke ændret.

- 16 retninger med 22,5° afstand, første kameraretning 45°.
- Gang: 12 billeder på 2 sekunder. Stilstand: 15 billeder på 2,5 sekunder.
- Ortografisk kamera med 30,05° elevation og 39,87723 pixel pr. verdensmeter.
- 432 par af farvebilleder og normalkort, rendret ved 256 pixel og nedskaleret
  til den samme 100-pixel målestok som den første version.
- `body.png`, `normals.png` og `pikes.png` er hver 1024 × 2048 pixel.
- Farvebilledet indeholder basisfarve, kontur og folder. Den gamle formskygge
  er fjernet, så studiet kan beregne skyggen med en fælles lysretning.
- Piken er fortsat et særskilt, smalt blækelement. Pikens 757 gemte masker
  mod ejerens krop og hånd er bevaret. De beskriver ikke terrænet eller
  andre soldaters dybde. Piken har ikke et selvstændigt normalkort.

## Normalkort

`character.json` har schema `walking-fortress-formation-character-v2`.
`normalAtlas` og `bodyAtlas` har identiske dimensioner, billedudsnit og
fodankre. Hvert `body.rect` bruges derfor også til normalkortet.

Normalkortets RGB gemmer `0.5 * overfladens enhedsnormal + 0.5` i figurens
oprindelige Blender-verdensakser: X mod højre, Y mod syd og Z op.
Det er lineære data uden sRGB-overførsel eller farveprofil. Studiet drejer
normalerne efter soldatens retning og sammenholder dem med landskabets sol.
Kameraets retning ændrer kun det valgte billedudsnit.

Alfa er dækningen af modellens overflade. Konturstreger kan findes i
farvebilledet, selv hvor normalkortet er gennemsigtigt; de bevares og har
ikke brug for en normal. Ved nedskalering filtreres normalvektorer vægtet
med dækning og normaliseres igen. RGB udvides fire pixel ind i den
transparente kant uden at ændre alfa, så billedfiltrering ikke giver en
forkert normal ved konturen.

`lighting` indeholder den gemte blækfarve, styrke og tærskel samt en
startretning for solen. Tærsklen anvendes på `0.5 + 0.5 * normal · lys`.
En tærskel på 0,5 skiller således overflader, der vender mod og væk fra
lyset. Skyggen har en hård grænse (`softness: 0`).

## Placering og pike

`body.rect` er `[x, y, bredde, højde]` i atlaspixels. `body.pivot` er fodpunktet målt i det beskårne kropsbilledes lokale
pixelkoordinater. `pike.corners` er strimlens fire hjørner i de samme
koordinater, i rækkefølgen øverst venstre, øverst højre, nederst højre,
nederst venstre. Begge dele forskydes med den samme beskæring, så pikens
placering følger fodankeret præcist. Alle atlasrektangler har øverst
venstre som origin.

## Kontrol og genbygning

`preview.png` viser fire retninger uden formskygge. `normal_preview.png`
viser de tilsvarende normaldata. `lighting_preview.png` viser de samme
fire billeder med lys fra to modsatte sider. Dette sidste billede er en
statisk kontrol af masken; studiet beregner lyset under visningen.

`build_report.json` registrerer kildekontrolsummer, billedstørrelser,
masker og kontrol af alle 432 par. Normaler og farvebilleder bruger
præcis de samme beskæringer. Målestok, fodanker, animationstider og
pikekoordinater er bevaret fra den tidligere version.

Den tidligere komplette karakter er bevaret i
`versions/ink-baked-v1_20261008_115558`. Den mappe indeholder sin egen
`character.json`, kropsatlas, pikeatlas og dokumentation.

Atlasserne kan bruges uden Sprite Studio eller Blender. Genbygning sker
med `python ./build_assets.py --source <mappe med sprites.json>` fra
formationsstudioets Git-rod.
Udviklingsværktøjet bruger Pillow, NumPy og Sprite Studios kanoniske
`pikeGeometry`. Det færdige studie bruger kun de pakkede runtimefiler.
`--self-test` kontrollerer normalfiltrering ved transparente kanter,
fælles atlasudsnit og skalering af pike og masker.

## Skravering i studiet

Skyggestreger er beregnet under visningen i [renderer.mjs](../renderer.mjs).
Normalkortet bestemmer skyggeområdet; parallelle og krydsende streger
bestemmer blækdækningen inde i området. De er forankret ved figurens
fodpunkt i billedplanet. Der skal ikke laves en ny eksport for at ændre
stregafstand, bredde, vinkel, tæthed eller blækfarve.

Normaldata må ikke indeholde den færdige skyggemaske eller skravering.
Konturer og foldstreger bliver i `body.png`. Det gør det muligt at ændre
solretningen, uden at den gamle formskygge følger med rundt på figuren.

## Genbygningens afhængigheder

Den normale start fra en Git-kopi kræver hverken kildefilerne eller disse
værktøjer. Genbygning kræver det oprindelige søstermappelayout:

```text
Walking Fortress 0.2/
  formation-studio/                  dette Git-lager
  assets/musketeer/                  Blender-model og rå spriteeksporter
  sprite-studio/blender/             eksport- og stregstilmoduler
  sprite-studio/vendor/              eksisterende Python-billedbiblioteker
  sprite-studio/web/pike.mjs         kanonisk geometri og masker
  tools/blender/pikeman_preview_geometry.mjs
```

- `tools/export_relightable.py` køres inde i Blender 5.2 og importerer
  `render_sprites`, `ink_render` og `studio_blender` fra `../sprite-studio/blender`.
- `tools/verify_relightable.py` køres med udviklingsmaskinens Python 3.13
  og Pillow. Det skriver `validation.json` i eksportmappen. Det kontrollerer
  432 billedpar, poseindramning, normale enhedsvektorer og SHA256 for
  modellens gemte fil. `--partial` bruges kun til en ufuldstændig prøve.
- `build_assets.py` køres med Python, Pillow, NumPy og Node.js. Det kalder
  `../tools/blender/pikeman_preview_geometry.mjs`, som importerer
  `../sprite-studio/web/pike.mjs`. Bibliotekerne findes her i søstermappens
  `vendor`; de kan også leveres af et Python-miljø med de samme API'er.
- `--node` skal angives, hvis Node ligger et andet sted end den indbyggede
  standardsti til denne udviklingsmaskines eksisterende Node-runtime.

Alle scripts regner placeringen af søstermapperne fra scriptfilens sti,
ikke fra terminalens aktuelle mappe. På en anden computer skal dette
layout være til stede, eller udviklingsværktøjerne skal tilpasses.

## Eksportforløb

Kør fra Git-roden `formation-studio`. Eksemplet genbruger den oprindelige
referenceseries animationer, kameravinkler, målestok og pikeplacering.
Angiv de lokale stier til Blender og Node først:

```powershell
$blenderExe = '<sti til Blender 5.2/blender.exe>'
$nodeExe = '<sti til node.exe>'
$workspace = (Resolve-Path '..').Path
$blendFile = Join-Path $workspace 'assets/musketeer/Pikeman_animation.blend'
$reference = Join-Path $workspace 'assets/musketeer/sprite_exports/musketeer_art_20261006_190621_855013/sprites.json'
$exportFolder = Join-Path $workspace ('assets/musketeer/sprite_exports/Pikener_normals_' + (Get-Date -Format 'yyyyMMdd_HHmmss'))

& $blenderExe --background $blendFile --python './tools/export_relightable.py' -- --manifest $reference --output $exportFolder --pixels 256
python ./tools/verify_relightable.py $exportFolder
python ./build_assets.py --source $exportFolder --node $nodeExe --size 100 --out ./assets
```

Tilføj `--smoke` til Blender-kommandoen for en prøve med fire retninger,
og brug `--partial` til kontrollen af prøven. Brug en ny mappe til den
fulde eksport. En afbrudt fuld eksport kan genoptages med nøjagtigt samme
reference, billedstørrelse, model og eksportmappe; skriptet kontrollerer
hvert pars kontrolsummer og genbruger færdige par.

Eksporten deaktiverer formskyggen på kopier af materialerne og renderer
albedo og normaler med samme pose og kamera. Den gemmer aldrig ændringer
i inputmodellen. PNG-overførselstags fjernes fra normalkortene, så
kanalværdierne forbliver data. `READY` markerer en fuldført kildeserie.

Atlasbygningen beskærer body og normaler sammen, skalerer piker og
masker én gang, pakker dem i koblede atlasplaceringer og normaliserer
normalerne efter filtrering. Den opretter en kopi af eksisterende
runtimeassets under `assets/versions/`, før den skriver nye. Gennemgå
billederne og `build_report.json`, og kør udviklingskontrollerne i
[DEVELOPMENT.md](../DEVELOPMENT.md), før nye atlasser committes.

## Kildeseriens kontrolsummer

Den nuværende serie har kildefilens SHA256
`4f9e8dcefc6f79cf569edaff4cf5ec21c1790402f4f1f71c9032ca98c2d46ab9`
og manifestets SHA256
`42438ba7fff0a47310d563dbd442d30e4ea666d36588dc7cab6e38290e0c6237`.
De findes også i den committede `build_report.json`. Der er 432 par,
757 ordnede pikeoperationer og matchende tidligere fod-/pikekoordinater.
Kontrolbillederne i denne mappe følger med i Git; browserkontrollernes
skærmbilleder i `checks/` er lokale, genoprettelige resultater.
