const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const base=process.env.STUDIO_URL||'http://127.0.0.1:8766';
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage(),errors=[];
  const changes={darkness:.6,opacity:1.8,widthScale:2.2};let original,selected,restore=false;
  page.on('pageerror',error=>errors.push(error.message));
  let renderRequests=0;page.on('request',request=>{if(request.url().endsWith('/api/library/render'))renderRequests++;});
  try {
    await page.goto(base+'/library.html');
    await page.waitForFunction(()=>window.__animationLibrary?.renderer?.stats.sprites===1);
    await page.locator('#pike-appearance').waitFor({state:'visible'});
    selected=await page.locator('.catalog-version.active').evaluate(button=>({characterId:button.dataset.character,versionId:button.dataset.version}));
    original=await page.evaluate(()=>({...__animationLibrary.renderer.assets.data.pikeAppearance}));
    assert.equal(await page.locator('#preview-pike-opacity').getAttribute('max'),'200');
    assert.equal(await page.locator('#preview-pike-width').getAttribute('max'),'300');
    assert.equal(await page.locator('#save-pike-appearance').isDisabled(),true);
    await page.click('#preview-play');await page.selectOption('#preview-direction','7');
    await page.locator('#preview-frame').fill('5');await page.locator('#preview-frame').dispatchEvent('input');
    const frameLabel=await page.locator('#frame-label').textContent();
    await page.evaluate(()=>{window.pikeReference={assets:__animationLibrary.renderer.assets,clip:__animationLibrary.renderer.assets.data.clips.previewWalk};});
    for(const [id,value] of [['darkness',60],['opacity',180],['width',220]]) {
      await page.locator('#preview-pike-'+id).fill(String(value));await page.locator('#preview-pike-'+id).dispatchEvent('input');
    }
    assert.deepEqual(await page.evaluate(()=>__animationLibrary.renderer.assets.data.pikeAppearance),changes);
    assert.equal(await page.locator('#frame-label').textContent(),frameLabel);assert.equal(await page.locator('#preview-direction').inputValue(),'7');
    assert.equal(await page.evaluate(()=>pikeReference.assets===__animationLibrary.renderer.assets&&pikeReference.clip===__animationLibrary.renderer.assets.data.clips.previewWalk),true);
    await page.evaluate(()=>__animationLibrary.refresh());
    assert.deepEqual(await page.evaluate(()=>__animationLibrary.renderer.assets.data.pikeAppearance),changes,'Refreshing catalog must preserve the unsaved preview');
    assert.equal(await page.locator('#save-pike-appearance').isEnabled(),true);
    // Observe the real cross-tab update while retaining the user's formation scene.
    const studio=await context.newPage();studio.on('pageerror',error=>errors.push(error.message));
    await studio.goto(base);await studio.waitForFunction(()=>window.formationStudio);await studio.evaluate(()=>formationStudio.pause());
    const scene=await studio.evaluate(()=>JSON.stringify(formationStudio.model.exportScene()));
    await studio.evaluate(()=>{window.pikeLibraryReloads=0;const load=formationStudio.renderer.loadAssets.bind(formationStudio.renderer);formationStudio.renderer.loadAssets=async(...args)=>{const result=await load(...args);pikeLibraryReloads++;return result;};});
    const savedResponse=page.waitForResponse(response=>response.url().endsWith('/api/library/appearance')&&response.request().method()==='POST');
    restore=true;await page.click('#save-pike-appearance');const saved=await (await savedResponse).json();
    assert.equal(saved.saved,true);assert.deepEqual(saved.pikeAppearance,changes);assert.equal(saved.active,true);
    await page.waitForFunction(()=>document.querySelector('#save-pike-appearance').disabled&&document.querySelector('#pike-appearance-note').textContent.startsWith('Gemt.'));
    await studio.waitForFunction(()=>window.pikeLibraryReloads>0,{timeout:20000});
    assert.equal(await studio.evaluate(()=>JSON.stringify(formationStudio.model.exportScene())),scene);
    await studio.close();
    await page.reload();await page.waitForFunction(()=>window.__animationLibrary?.renderer?.stats.sprites===1);
    assert.deepEqual(await page.evaluate(()=>__animationLibrary.renderer.assets.data.pikeAppearance),changes);
    for(const [id,value] of [['darkness','60'],['opacity','180'],['width','220']])assert.equal(await page.locator('#preview-pike-'+id).inputValue(),value);
    const latest=await (await context.request.get(base+'/api/library')).json();
    const catalog=latest.library||latest,version=catalog.characters.find(character=>character.id===selected.characterId).versions.find(version=>version.id===selected.versionId);
    assert.deepEqual(version.pikeAppearance,changes);
    await page.screenshot({path:path.join(__dirname,'library-pike.png'),fullPage:true});
    // Returning to a version restores its saved appearance; guns have no separate pike sliders.
    const noPike=page.locator('.catalog-version[data-character="musketeer"]').first();
    await noPike.click();await page.waitForFunction(()=>document.querySelector('#preview-loading').hidden);
    assert.equal(await page.locator('#pike-appearance').isHidden(),true);
    await page.locator(`.catalog-version[data-character="${selected.characterId}"][data-version="${selected.versionId}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#preview-loading').hidden&&!document.querySelector('#pike-appearance').hidden);
    assert.deepEqual(await page.evaluate(()=>__animationLibrary.renderer.assets.data.pikeAppearance),changes);
    assert.equal(renderRequests,0);assert.equal(await page.evaluate(()=>__animationLibrary.renderer.gl.getError()),0);assert.deepEqual(errors,[]);
    const result={result:'passed',liveAppearance:true,noAnimationReset:true,unsavedRefreshPreserved:true,realSaveReopen:true,activeFormationReloadedScenePreserved:true,noPikeControlsHidden:true,noSourceRender:true,pikeAppearance:changes};
    fs.writeFileSync(path.join(__dirname,'library-pike-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {
    if(restore&&original&&selected){const response=await context.request.post(base+'/api/library/appearance',{data:{...selected,pikeAppearance:original}});assert.equal(response.ok(),true,'Restore the original pike appearance');}
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exit(1);});
