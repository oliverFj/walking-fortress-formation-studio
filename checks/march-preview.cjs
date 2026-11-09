const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio);
    await page.evaluate(async()=>{
      formationStudio.pause();
      const {StudioModel}=await import('./model.mjs');
      const model=new StudioModel();model.formations=[];model.nextId=1;
      model.addFormation({name:'Hjuldrejning · inderflanke til yderflanke',x:0,z:0,strength:144,frontFiles:18,speed:1.5,composition:'mixed',turnAnchor:'right'});
      const scene=formationStudio.sceneDocument();scene.model=model.exportScene();scene.view.visualBudget=600;
      scene.view.camera={yaw:Math.PI/4,zoom:28,centerX:0,centerZ:0};formationStudio.openScene(scene);
    });
    await page.locator('#target-heading').fill('90');await page.click('#turn-unit');
    for(let i=0;i<3;i++)await page.click('#step-time');
    const result=await page.evaluate(async()=>{
      const {soldierAnimation}=await import('./animation.mjs');
      const snapshot=formationStudio.snapshot,renderer=formationStudio.renderer;
      const groups={},roles={},phases=[];
      for(const soldier of snapshot.soldiers) {
        const character=renderer.assets.characters.get(renderer.assets.roles[soldier.role]);
        const animation=soldierAnimation(character.data,soldier,snapshot.time);
        const gait=soldier.moving?String(animation.clip.nominalSpeed):'idle';groups[gait]=(groups[gait]||0)+1;
        roles[soldier.role]=(roles[soldier.role]||0)+1;
        if(soldier.moving)phases.push(((animation.phase-soldier.movementPhase+1.5)%1)-.5);
      }
      return {groups,roles,phaseOffsets:phases,minSpeed:Math.min(...snapshot.soldiers.map(s=>s.speed)),maxSpeed:Math.max(...snapshot.soldiers.map(s=>s.speed)),anchor:snapshot.formations[0].anchor,status:snapshot.formations[0].status,glError:renderer.gl.getError()};
    });
    assert.equal(result.status,'Vender');assert.equal(result.glError,0);assert.ok(result.anchor);
    for(const group of ['0.5','1.5','3'])assert.ok(result.groups[group]>0);
    assert.ok(result.roles.pike>0&&result.roles.shot>0);assert.ok(result.maxSpeed<=3+1e-8);
    assert.ok(result.phaseOffsets.every(offset=>Math.abs(offset)<=.04+1e-10));assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(__dirname,'march-wheel.png')});
    const report={result:'passed',...result,errors};
    fs.writeFileSync(path.join(__dirname,'march-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({...report,phaseOffsets:undefined}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});