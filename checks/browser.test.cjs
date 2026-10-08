const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const failed=[];page.on('requestfailed',request=>failed.push(request.url()));
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio, {timeout:20000});
    await page.evaluate(()=>formationStudio.pause());
    await page.screenshot({path:path.join(__dirname,'overview.png')});
    const initial=await page.evaluate(()=>({scene:formationStudio.model.exportScene(),snapshot:formationStudio.snapshot,stats:formationStudio.renderer.stats,gl:formationStudio.renderer.gl.getError()}));
    assert.equal(initial.snapshot.strength,636);
    assert.equal(initial.snapshot.soldiers.length,600);
    assert.equal(initial.gl,0);

    assert.ok(await page.evaluate(()=>!!formationStudio.renderer.assets.normal));
    assert.equal(await page.evaluate(()=>formationStudio.view.lighting.azimuth),315);
    assert.equal(await page.evaluate(()=>formationStudio.view.lighting.elevation),55);
    await page.click('[data-tab="light"]');

    await page.evaluate(()=>{
      const legacy=formationStudio.sceneDocument();delete legacy.view.lighting;formationStudio.openScene(legacy);
    });
    assert.equal(await page.evaluate(()=>formationStudio.view.lighting.azimuth),315);
    await page.evaluate(()=>{
      const legacy=formationStudio.sceneDocument();legacy.view.lighting={...legacy.view.lighting,azimuth:-45};formationStudio.openScene(legacy);
    });
    assert.equal(await page.evaluate(()=>formationStudio.view.lighting.azimuth),315);

    assert.equal(await page.locator('#light-style').inputValue(),'hatch');
    const lightingScene=await page.evaluate(()=>JSON.stringify(formationStudio.model.exportScene()));
    for(const [key,value] of [['azimuth','195'],['elevation','31'],['strength','0.7'],['threshold','0.61']]) {
      await page.locator('#light-'+key).fill(value);await page.locator('#light-'+key).dispatchEvent('input');
    }
    await page.selectOption('#light-style','solid');assert.ok(await page.locator('#hatch-controls').isHidden());
    await page.selectOption('#light-style','hatch');assert.ok(await page.locator('#hatch-controls').isVisible());
    for(const [key,value] of [['hatchSpacing','0.005'],['hatchWidth','0.0005'],['hatchAngle','62'],['crossStart','0.48']]){await page.locator('#light-'+key).fill(value);await page.locator('#light-'+key).dispatchEvent('input');}
    assert.equal(await page.locator('#light-hatchSpacing').inputValue(),'0.005');
    assert.equal(await page.locator('#light-hatchSpacing-label').textContent(),'0,5 cm');
    assert.equal(await page.locator('#light-hatchWidth-label').textContent(),'0,05 cm');
    await page.locator('#light-ink').fill('#182416');await page.locator('#light-ink').dispatchEvent('input');
    await page.locator('#light-enabled').uncheck();
    const customLight=await page.evaluate(()=>({...formationStudio.view.lighting}));
    assert.deepEqual(customLight,{enabled:false,azimuth:195,elevation:31,strength:.7,threshold:.61,softness:0,inkColor:'#182416',style:'hatch',hatchSpacing:.005,hatchWidth:.0005,hatchAngle:62,crossStart:.48});
    assert.equal(await page.evaluate(()=>JSON.stringify(formationStudio.model.exportScene())),lightingScene);
    await page.screenshot({path:path.join(__dirname,'lighting-controls.png')});

    const before=JSON.stringify(initial.scene);
    await page.click('[data-tab="view"]');
    await page.selectOption('#display-mode','fields');
    assert.equal(await page.evaluate(()=>formationStudio.snapshot.soldiers.length),0);
    assert.equal(await page.evaluate(()=>JSON.stringify(formationStudio.model.exportScene())),before);
    await page.selectOption('#display-mode','both');
    await page.locator('#visual-budget').fill('60');
    await page.locator('#visual-budget').dispatchEvent('input');
    assert.equal(await page.evaluate(()=>formationStudio.snapshot.soldiers.length),60);
    assert.equal(await page.evaluate(()=>formationStudio.snapshot.strength),636);
    await page.locator('#camera-yaw').fill('135');await page.locator('#camera-yaw').dispatchEvent('input');
    assert.ok(Math.abs((await page.evaluate(()=>formationStudio.renderer.camera.yaw))-3*Math.PI/4)<0.0001);
    await page.click('#home-camera');
    await page.click('[data-tab="formation"]');
    await page.locator('#strength').fill('170');await page.locator('#strength').dispatchEvent('change');
    assert.equal(await page.evaluate(()=>formationStudio.model.formations[0].strength),170);
    await page.click('#loss-10');
    assert.equal(await page.evaluate(()=>formationStudio.model.formations[0].strength),153);
    assert.equal(await page.locator('#strength').inputValue(),'153');
    assert.ok(await page.locator('#strength').evaluate(input=>input.checkValidity()));
    assert.ok(await page.locator('#turn-rate').evaluate(input=>input.checkValidity()));
    await page.selectOption('#shape','column');
    const widthBefore=await page.evaluate(()=>formationStudio.model.formations[0].layout[0].width);
    await page.click('#step-time');
    assert.ok(await page.evaluate(w=>formationStudio.model.formations[0].layout[0].width<w,widthBefore));
    await page.click('#add-formation');
    assert.equal(await page.evaluate(()=>formationStudio.model.formations.length),4);
    await page.locator('#unit-name').fill('Prøvefænnike');await page.locator('#unit-name').dispatchEvent('change');
    const viewport=await page.locator('#battlefield').boundingBox();
    await page.mouse.click(viewport.x+viewport.width*0.5,viewport.y+viewport.height*0.8);
    assert.equal(await page.evaluate(()=>formationStudio.model.formations.find(f=>f.id===formationStudio.model.selectedId).status),'Marcherer');
    const downloadPromise=page.waitForEvent('download');await page.click('#save-scene');
    const download=await downloadPromise;const saved=path.join(__dirname,'saved-study.json');await download.saveAs(saved);
    const exported=JSON.parse(fs.readFileSync(saved,'utf8'));assert.equal(exported.schema,'walking-fortress-formation-study-v1');
    assert.equal(exported.model.formations.length,4);
    await page.click('#reset-scene');assert.equal(await page.evaluate(()=>formationStudio.model.formations.length),3);
    await page.locator('#scene-file').setInputFiles(saved);
    await page.waitForFunction(()=>document.getElementById('save-state').textContent==='Studie åbnet');
    assert.equal(await page.evaluate(()=>formationStudio.model.formations.length),4);
    assert.ok(await page.evaluate(()=>formationStudio.model.formations.some(f=>f.name==='Prøvefænnike')));
    const restored=await page.evaluate(()=>formationStudio.sceneDocument());assert.deepEqual(restored.model,exported.model);assert.deepEqual(restored.view.lighting,exported.view.lighting);
    await page.click('[data-tab="terrain"]');await page.click('[data-terrain="ridge"]');
    assert.ok((await page.locator('[data-terrain="ridge"]').getAttribute('class')).includes('active'));
    await page.screenshot({path:path.join(__dirname,'ridge.png')});
    await page.click('[data-terrain="passage"]');
    assert.ok((await page.locator('[data-terrain="passage"]').getAttribute('class')).includes('active'));
    assert.equal(await page.evaluate(()=>formationStudio.model.terrain),'passage');
    await page.screenshot({path:path.join(__dirname,'passage.png')});
    await page.evaluate(()=>localStorage.removeItem('wf-formation-study'));
    await page.reload();await page.waitForFunction(()=>window.formationStudio);await page.evaluate(()=>formationStudio.pause());
    assert.equal(await page.evaluate(()=>formationStudio.view.lighting.softness),0);
    const gl=await page.evaluate(()=>formationStudio.renderer.gl.getError());assert.equal(gl,0);
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    const report={result:'passed',checks:['startup and GPU shaders','real sprites and pikes','field/sprite independence','display density independence','camera orbit','controls and casualties','gradual reform','addition and march order','download and exact scene restore','ridge and passage terrain','world light controls independent of simulation','lighting and hatch settings survive scene save and restore'],errors,failed};
    fs.writeFileSync(path.join(__dirname,'browser-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
