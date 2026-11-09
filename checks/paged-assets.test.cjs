const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1000,height:800}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio);
    const report=await page.evaluate(async()=>{
      formationStudio.pause();const {Renderer}=await import('./renderer.mjs');
      const canvas=document.createElement('canvas');canvas.style.cssText='width:400px;height:400px;position:absolute;top:0;left:0';document.body.append(canvas);
      const renderer=new Renderer(canvas),gl=renderer.gl;renderer.setCamera({yaw:0,zoom:10,centerX:0,centerZ:0});
      const png=(rgba,size=1)=>{const c=document.createElement('canvas');c.width=c.height=size;const ctx=c.getContext('2d');ctx.fillStyle=`rgba(${rgba.slice(0,3).join(',')},${rgba[3]/255})`;ctx.fillRect(0,0,size,size);return c.toDataURL();};
      const pages=[
        {bodyAtlas:png([230,140,90,255]),normalAtlas:png([128,0,128,255]),pikeAtlas:png([60,180,70,255])},
        {bodyAtlas:png([90,140,230,255]),normalAtlas:png([128,255,128,255]),pikeAtlas:png([210,180,60,255])}
      ];
      const frames=[0,1].map(page=>({page,body:{rect:[0,0,1,1],pivot:[.5,1]},pike:{rect:[0,0,1,1]}}));
      const clip={kind:'idle',duration:1,directions:[frames]};
      const data={schema:'walking-fortress-formation-character-v2',id:'paged',pixelsPerUnit:.4,firstAzimuth:0,azimuthStep:360,elevation:30.05,
        normalSpace:'actor-blender-world',normalEncoding:'RGB8-linear-signed',clips:{idle:clip,walk:{...clip,kind:'walk'}},pages,...pages[0]};
      const urls=[];const urlFor=value=>{const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));urls.push(url);return url;};
      await renderer.loadAssets(urlFor(data));
      const original=renderer.assets,loaded=original.pages.flatMap(page=>[page.body,page.normal,page.pike].map(part=>part.texture));
      const snapshot={terrain:'flat',time:0,formations:[],soldiers:[0,.5].map((phase,index)=>({x:index ? 1.5 : -1.5,z:0,heading:0,moving:false,role:'pike',phase,animationSeed:.2}))};
      const lighting={style:'solid',enabled:true,azimuth:0,elevation:0,threshold:.5,strength:1,inkColor:'#000000'};
      function draw(azimuth,showPikes=false){
        renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes,lighting:{...lighting,azimuth}});
        return snapshot.soldiers.map(soldier=>{const foot=renderer.worldToScreen(soldier.x,soldier.z);const rgba=new Uint8Array(4);gl.readPixels(Math.round(foot.x*canvas.width/canvas.clientWidth),Math.round((canvas.clientHeight-foot.y+.5/data.pixelsPerUnit*canvas.clientHeight/10)*canvas.height/canvas.clientHeight),1,1,gl.RGBA,gl.UNSIGNED_BYTE,rgba);return [...rgba];});
      }
      const front=draw(0),back=draw(180),pikes=draw(0,true),stats={...renderer.stats};
      const batches=renderer.spriteInstances(snapshot,{showPikes:true}).batches.map(batch=>({page:original.pages.indexOf(batch.assets),body:batch.body.length/21,pikes:batch.pikes.length/21,paired:batch.assets.body.width===batch.assets.normal.width&&batch.assets.body.height===batch.assets.normal.height}));
      const deleted=[];const deleteTexture=gl.deleteTexture.bind(gl);gl.deleteTexture=texture=>{deleted.push(texture);deleteTexture(texture);};
      const invalid={...data,pages:[pages[0],{...pages[1],normalAtlas:png([128,255,128,255],2)}]};
      let mismatch=false;try{await renderer.loadAssets(urlFor(invalid));}catch(error){mismatch=error.message.includes('mål passer');}
      const failureCleanup=deleted.length===6,oldPreserved=renderer.assets===original&&loaded.every(texture=>gl.isTexture(texture));
      // Successful replacement frees every old page and still accepts legacy packs.
      const legacy={...data};delete legacy.pages;legacy.clips={idle:{...clip,directions:[[frames[0]]]},walk:{...clip,kind:'walk',directions:[[frames[0]]]}};
      await renderer.loadAssets(urlFor(legacy));
      const oldFreed=loaded.every(texture=>!gl.isTexture(texture)),legacyLoaded=!renderer.assets.pages;
      const glError=gl.getError();renderer.destroy();canvas.remove();urls.forEach(url=>URL.revokeObjectURL(url));
      return {front,back,pikes,stats,batches,mismatch,failureCleanup,oldPreserved,oldFreed,legacyLoaded,glError};
    });
    assert.deepEqual(report.front,[[230,140,90,255],[0,0,0,255]]);
    assert.deepEqual(report.back,[[0,0,0,255],[90,140,230,255]]);
    assert.deepEqual(report.pikes,[[60,180,70,255],[210,180,60,255]]);
    assert.equal(report.stats.sprites,2);assert.equal(report.stats.characters.paged,2);
    assert.deepEqual(report.batches,[{page:0,body:1,pikes:1,paired:true},{page:1,body:1,pikes:1,paired:true}]);
    for(const key of ['mismatch','failureCleanup','oldPreserved','oldFreed','legacyLoaded'])assert.equal(report[key],true,key);
    assert.equal(report.glError,0);assert.deepEqual(errors,[]);
    const result={result:'passed',...report};fs.writeFileSync(path.join(__dirname,'paged-assets-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
