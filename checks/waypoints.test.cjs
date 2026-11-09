const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
  const errors=[],failed=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('requestfailed',request=>failed.push(request.url()));
  const checks=[];
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio && typeof formationStudio.renderer.waypointHandles==='function' && typeof formationStudio.model.setWaypoint==='function',null,{timeout:20000});
    const formationId=await page.evaluate(()=>{
      const studio=formationStudio;studio.pause();
      const first=studio.model.formations[0];
      for(const f of [...studio.model.formations])if(f.id!==first.id)studio.model.removeFormation(f.id);
      studio.model.halt(first.id);studio.model.selectedId=first.id;
      studio.renderer.setCamera({yaw:0,zoom:80,centerX:0,centerZ:5});
      return first.id;
    });
    const canvas=page.locator('#battlefield');
    const box=await canvas.boundingBox();
    async function screen(x,z){
      const local=await page.evaluate(({x,z})=>formationStudio.renderer.worldToScreen(x,z),{x,z});
      assert.ok(local && Number.isFinite(local.x) && Number.isFinite(local.y),'ground point projects to the canvas');
      assert.ok(local.x>0 && local.x<box.width && local.y>0 && local.y<box.height,'test ground point is visible');
      return {x:box.x+local.x,y:box.y+local.y};
    }
    async function groundClick(x,z,append=false){
      const p=await screen(x,z);
      if(append)await page.keyboard.down('Shift');
      try {await page.mouse.click(p.x,p.y);} finally {if(append)await page.keyboard.up('Shift');}
    }
    async function points(){
      return await page.evaluate(id=>formationStudio.model.formations.find(f=>f.id===id).waypoints,formationId);
    }
    async function expectCount(count){
      await page.waitForFunction(({id,count})=>formationStudio.model.formations.find(f=>f.id===id)?.waypoints?.length===count,{id:formationId,count});
      await page.waitForFunction(({id,count})=>formationStudio.snapshot.formations.find(f=>f.id===id)?.waypoints?.length===count,{id:formationId,count});
    }
    async function handles(){
      return await page.evaluate(()=>formationStudio.renderer.waypointHandles(formationStudio.snapshot,formationStudio.model.selectedId));
    }
    // Actual pointer input exercises ground projection, selection and append semantics.
    await groundClick(-15,8);await expectCount(1);
    let route=await points();assert.ok(Math.abs(route[0].x+15)<.01 && Math.abs(route[0].z-8)<.01);
    let preview=await page.evaluate(id=>formationStudio.snapshot.formations.find(f=>f.id===id).waypoints,formationId);
    assert.ok(preview[0].fields.length>0,'the desired formation appears at its waypoint');
    assert.equal(preview[0].corners.length,4);assert.equal((await handles()).length,4);
    checks.push('left click places one desired formation with four corner grips');

    await groundClick(-2,-8,true);await expectCount(2);
    await groundClick(17,-11,true);await expectCount(3);
    route=await points();assert.equal((await handles()).length,12);
    preview=await page.evaluate(id=>formationStudio.snapshot.formations.find(f=>f.id===id).waypoints,formationId);
    assert.ok(preview.every(p=>p.fields.length>0 && p.corners.length===4));
    checks.push('shift clicks append visible desired formations and four grips each');

    const unchanged=route.map(p=>({...p}));
    const dragged=route[2],grip=(await handles()).find(h=>h.waypointId===dragged.id && h.cornerIndex===0);
    assert.ok(grip,'a queued waypoint has a draggable corner');
    const center=await screen(dragged.x,dragged.z);
    const start={x:box.x+grip.screen.x,y:box.y+grip.screen.y};
    // Rotate the projected grip about its waypoint, leaving the route point fixed.
    const end={x:center.x+(start.y-center.y)*1.35,y:center.y-(start.x-center.x)*.74};
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();
    await page.waitForFunction(({id,pointId,heading})=>Math.abs(formationStudio.model.formations.find(f=>f.id===id).waypoints.find(p=>p.id===pointId).heading-heading)>.1,{id:formationId,pointId:dragged.id,heading:dragged.heading});
    route=await points();assert.equal(route.length,3);
    for(let i=0;i<route.length;i++){
      assert.equal(route[i].id,unchanged[i].id);
      assert.ok(Math.abs(route[i].x-unchanged[i].x)<1e-8 && Math.abs(route[i].z-unchanged[i].z)<1e-8,'rotating a grip preserves its route position');
      if(i!==2)assert.equal(route[i].heading,unchanged[i].heading,'other waypoint headings remain unchanged');
    }
    assert.equal((await handles()).length,12);
    await page.screenshot({path:path.join(__dirname,'waypoints.png')});
    checks.push('corner drag rotates only its waypoint without moving it');

    await groundClick(-9,0);await expectCount(1);route=await points();
    assert.ok(Math.abs(route[0].x+9)<.01 && Math.abs(route[0].z)<.01);
    assert.equal((await handles()).length,4);
    checks.push('a new unmodified left click replaces the route');

    await groundClick(8,-14,true);await expectCount(2);
    const clear=await screen(26,16);
    const yawBefore=await page.evaluate(()=>formationStudio.renderer.camera.yaw);
    await page.mouse.move(clear.x,clear.y);await page.mouse.down({button:'right'});
    await page.mouse.move(clear.x+80,clear.y+8,{steps:8});await page.mouse.up({button:'right'});
    assert.ok(Math.abs(await page.evaluate(()=>formationStudio.renderer.camera.yaw)-yawBefore)>.2);
    assert.equal(await page.evaluate(()=>formationStudio.model.selectedId),formationId);
    checks.push('right drag orbits the camera and keeps formation selection');

    const afterOrbit=await page.evaluate(()=>formationStudio.renderer.camera.yaw);
    await page.mouse.click(clear.x,clear.y,{button:'right'});
    await page.waitForFunction(()=>formationStudio.model.selectedId===null);
    assert.equal(await page.evaluate(()=>formationStudio.renderer.camera.yaw),afterOrbit);
    assert.ok(await page.locator('#unit-name').isDisabled());
    assert.ok(await page.locator('#turn-unit').isDisabled());
    assert.equal((await handles()).length,0);
    const beforeNoSelection=await page.evaluate(()=>formationStudio.model.exportScene());
    await groundClick(28,-20);
    assert.deepEqual(await page.evaluate(()=>formationStudio.model.exportScene()),beforeNoSelection);
    checks.push('right click clears selection; unselected ground click gives no order');

    const downloadPromise=page.waitForEvent('download');await page.click('#save-scene');
    const download=await downloadPromise,saved=path.join(__dirname,'saved-waypoints-study.json');
    await download.saveAs(saved);
    const exported=JSON.parse(fs.readFileSync(saved,'utf8'));
    assert.equal(exported.model.selectedId,null);
    assert.equal(exported.model.formations[0].waypoints.length,2);
    await page.click('#reset-scene');await page.evaluate(()=>formationStudio.pause());
    await page.locator('#scene-file').setInputFiles(saved);
    await page.waitForFunction(()=>document.getElementById('save-state').textContent==='Studie åbnet');
    const restored=await page.evaluate(()=>formationStudio.model.exportScene());
    // Import deliberately recomputes the next ID after deleted formations.
    assert.deepEqual(restored,{...exported.model,nextId:Math.max(1,...exported.model.formations.map(f=>f.id+1))});
    assert.equal(await page.evaluate(()=>formationStudio.model.selectedId),null);
    assert.ok(await page.locator('#unit-name').isDisabled());
    checks.push('save/open round trip preserves queued destinations and cleared selection');

    await page.evaluate(()=>{
      const studio=formationStudio,f=studio.model.formations[0];
      studio.view.display='soldiers';studio.view.showTargets=false;
      studio.renderer.setCamera({yaw:Math.PI/4,zoom:18,centerX:f.x,centerZ:f.z});
      localStorage.removeItem('wf-formation-study');
    });
    await page.waitForFunction(()=>formationStudio.renderer.stats.sprites===216 && formationStudio.renderer.stats.groundShadows===216);
    assert.equal(await page.evaluate(()=>formationStudio.renderer.stats.groundShadows),216);
    await page.screenshot({path:path.join(__dirname,'shadow-overview.png')});
    assert.equal(await page.evaluate(()=>formationStudio.renderer.gl.getError()),0);
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    const report={result:'passed',checks,errors,failed};
    fs.writeFileSync(path.join(__dirname,'waypoints-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
