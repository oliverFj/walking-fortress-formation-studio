const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1320,height:850}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.formationStudio);
    const report=await page.evaluate(async()=>{
      formationStudio.pause();const {Renderer}=await import('./renderer.mjs');
      const canvas=document.createElement('canvas');canvas.style.cssText='width:400px;height:400px;position:absolute;top:0;left:0';document.body.append(canvas);
      const renderer=new Renderer(canvas),gl=renderer.gl;renderer.setCamera({yaw:0,zoom:10,centerX:0,centerZ:0});
      function texture(color){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(color));gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return {texture:t,width:1,height:1};}
      const frame={body:{rect:[0,0,1,1],pivot:[.5,1]}};const clip={duration:1,directions:[[frame]]};
      renderer.assets={data:{pixelsPerUnit:.2,clips:{idle:clip,walk:clip},firstAzimuth:0,azimuthStep:360},body:texture([238,228,196,255]),normal:null,pike:null};
      const snapshot={terrain:'flat',time:0,formations:[],soldiers:[{x:0,z:0,heading:0,moving:false,role:'pike'}]};
      const lighting={enabled:true,azimuth:180,elevation:0,threshold:.52,strength:1,softness:0,inkColor:'#000000',style:'hatch',hatchSpacing:.3,hatchWidth:.05,hatchAngle:45,crossStart:.35};
      function normalForDepth(depth,alpha=255){const d=2*.52*(1-depth)-1;return [Math.round((Math.sqrt(1-d*d)*.5+.5)*255),Math.round((d*.5+.5)*255),128,alpha];}
      function draw(depth,extra={},alpha=255){if(renderer.assets.normal)gl.deleteTexture(renderer.assets.normal.texture);renderer.assets.normal=texture(normalForDepth(depth,alpha));renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes:false,lighting:{...lighting,...extra}});const image=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,image);return image;}
      function stats(image){let ink=0,base=0,aa=0,total=0;for(let y=240;y<370;y++)for(let x=120;x<280;x++){const value=image[(y*canvas.width+x)*4];if(value<15)ink++;else if(value===238)base++;else aa++;total++;}return {ink,base,aa,total};}
      const shallow=stats(draw(.09)),medium=stats(draw(.30)),deepImage=draw(.78),deep=stats(deepImage),solid=stats(draw(.78,{style:'solid'})),outside=stats(draw(-.2)),excluded=stats(draw(.78,{},0));
      draw(.78);renderer.setCamera({centerX:.15});const panImage=draw(.78);let changed=0,compared=0;
      for(let y=240;y<370;y++)for(let x=126;x<280;x++){const a=(y*canvas.width+x)*4,b=(y*canvas.width+x-6)*4;if(Math.abs(deepImage[a]-panImage[b])>2)changed++;compared++;}
      const result={shallow,medium,deep,solid,outside,excluded,pan:{changed,compared},antialias:gl.getContextAttributes().antialias,sampleBuffers:gl.getParameter(gl.SAMPLE_BUFFERS),samples:gl.getParameter(gl.SAMPLES),glError:gl.getError()};renderer.destroy();canvas.remove();return result;
    });
    assert.ok(report.shallow.ink>0,'Sparse edge strokes must exist');assert.ok(report.medium.ink>report.shallow.ink,'More strokes appear deeper');assert.ok(report.deep.ink>report.medium.ink,'Cross hatching deepens shadows');
    assert.ok(report.deep.base>report.deep.total*.3,'Paper must remain visible between deep strokes');assert.ok(report.deep.aa>0,'Stroke edges are analytically antialiased');
    assert.equal(report.solid.ink,report.solid.total);assert.equal(report.outside.ink,0);assert.equal(report.excluded.ink,0);assert.ok(report.pan.changed<report.pan.compared*.005,'The pattern must move with the sprite during camera panning');assert.equal(report.glError,0);assert.deepEqual(errors,[]);
    const result={result:'passed',checks:['sparse edge strokes','progressive primary and cross strokes','base color between strokes','analytic stroke antialiasing','solid fallback','lit regions untouched','contour coverage excluded','foot anchored pattern during camera panning'],...report};
    fs.writeFileSync(path.join(__dirname,'hatching-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
