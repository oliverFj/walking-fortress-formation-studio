# Pikenerens billeder

Disse selvstændige billeder er lavet fra den gemte Blender-eksport
`Pikener_stregstil_20261008_103032/100px`. Kilden er brugerens figur
`assets/musketeer/Pikeman_animation.blend` med den valgte Stregstil.
De oprindelige billeder og Blender-filen er ikke ændret.

- 16 retninger med 22,5° afstand, første kameraretning 45°.
- Gang: 12 billeder på 2 sekunder. Stilstand: 15 billeder på 2,5 sekunder.
- Ortografisk kamera med 30,05° elevation og 39,87723 pixel pr. verdensmeter.
- Krop og pike er separate, gennemsigtige atlasser på 1024 × 2048 pixel.
- Kroppene er beskåret med en lille gennemsigtig kant. Pikerne er drejet
  ind i smalle strimler for at undgå store, tomme billedflader.
- Pikens 757 gemte masker er indarbejdet i rækkefølge. De skjuler de dele,
  som figurens egen krop eller hånd dækker. De beskriver ikke terrænet
  eller andre soldaters dybde.

`character.json` beskriver hvert atlasudsnit. `body.pivot` er fodpunktet
målt i det beskårne kropsbilledes lokale pixelkoordinater. `pike.corners`
er strimlens fire hjørner i de samme koordinater, i rækkefølgen øverst
venstre, øverst højre, nederst højre, nederst venstre. Pikens billedudsnit
kan derfor placeres ved det samme fodpunkt uden at blive klippet ved
kroppens billedkant. Alle atlasrektangler bruger øverst venstre som origin.

`preview.png` viser fire retninger samlet med den færdige pike.
`build_report.json` indeholder kildefilernes kontrolsummer og billedstørrelser.

Billederne er klar til brug uden Sprite Studio eller Blender. Hvis de skal
bygges om, bruges `formation-studio/build_assets.py` fra projektroden.
Dette udviklingsværktøj bruger Sprite Studios Pillow og `pikeGeometry`
ved bygningen; det færdige studie har ingen afhængighed af dem.
