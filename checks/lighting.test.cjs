const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio);
    const report=await page.evaluate(async()=>{
      formationStudio.pause();
      const {Renderer}=await import('./renderer.mjs');
      const canvas=document.createElement('canvas');canvas.style.cssText='width:400px;height:400px;position:absolute;top:0;left:0';document.body.append(canvas);
      const renderer=new Renderer(canvas),gl=renderer.gl;
      renderer.setCamera({yaw:0,zoom:10,centerX:0,centerZ:0});
      function texture(color) {
        const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(color));
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
        return {texture:t,width:1,height:1};
      }
      const frame={body:{rect:[0,0,1,1],pivot:[0.5,1]}};
      const clip={duration:1,directions:[[frame]]};
      renderer.assets={data:{pixelsPerUnit:.4,clips:{idle:clip,walk:clip},firstAzimuth:0,azimuthStep:360},body:texture([238,228,196,255]),normal:texture([128,0,128,255]),pike:null};
      const snapshot={terrain:'flat',time:0,formations:[],soldiers:[{x:0,z:0,heading:0,moving:false,role:'pike'}]};
      const lighting={style:'solid',enabled:true,azimuth:0,elevation:0,threshold:.5,strength:1,softness:0,inkColor:'#000000'};
      function draw(extra={}) {
        renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes:false,lighting:{...lighting,...extra}});
        const pixel=new Uint8Array(4);gl.readPixels(Math.round(canvas.width*.5),Math.round(canvas.height*.625),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        return [...pixel];
      }
      const lit=draw();const shadow=draw({azimuth:180});
      snapshot.soldiers[0].heading=Math.PI;const turned=draw();snapshot.soldiers[0].heading=0;
      const cameraViews=[];
      for(const yaw of [0,Math.PI/2,Math.PI,5.4]){renderer.setCamera({yaw});cameraViews.push(draw());}
      const disabled=draw({azimuth:180,enabled:false});
      const sharedVector=renderer.lightDirection.slice();
      const groundVector=[...gl.getUniform(renderer.groundProgram,gl.getUniformLocation(renderer.groundProgram,'u_lightDirection'))];
      const bodyVector=[...gl.getUniform(renderer.spriteProgram,gl.getUniformLocation(renderer.spriteProgram,'u_lightDirection'))];
      // Normal alpha zero means contour-only coverage: never relight those pixels.
      gl.deleteTexture(renderer.assets.normal.texture);renderer.assets.normal=texture([128,0,128,0]);
      const noNormalCoverage=draw({azimuth:180});
      gl.deleteTexture(renderer.assets.normal.texture);renderer.assets.normal=texture([128,0,128,255]);
      // The separate pike carries no body-normal flag, even when its UVs overlap.
      renderer.assets.pike=texture([216,160,77,255]);frame.pike={rect:[0,0,1,1]};
      renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes:true,lighting:{...lighting,azimuth:180}});
      const pikePixel=new Uint8Array(4);gl.readPixels(Math.round(canvas.width*.5),Math.round(canvas.height*.625),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pikePixel);
      const result={lit,shadow,turned,cameraViews,disabled,noNormalCoverage,pike:[...pikePixel],sharedVector,groundVector,bodyVector,glError:gl.getError()};
      renderer.destroy();canvas.remove();return result;
    });
    assert.deepEqual(report.lit,[238,228,196,255]);assert.deepEqual(report.shadow,[0,0,0,255]);
    assert.deepEqual(report.turned,report.shadow);
    for(const pixel of report.cameraViews)assert.deepEqual(pixel,report.lit);
    assert.deepEqual(report.disabled,report.lit);assert.deepEqual(report.noNormalCoverage,report.lit);
    assert.deepEqual(report.pike,[216,160,77,255]);
    for(let i=0;i<3;i++){assert.ok(Math.abs(report.groundVector[i]-report.sharedVector[i])<1e-7);assert.equal(report.groundVector[i],report.bodyVector[i]);}
    assert.equal(report.glError,0);assert.deepEqual(errors,[]);
    const result={result:'passed',checks:['hard ink pixel values','actor heading rotates normals','camera orbit leaves landscape sunlight fixed','terrain and actor share identical sun uniform','unlit toggle','normal alpha excludes ink contours','pikes preserve existing ink and owner masks'],...report};
    fs.writeFileSync(path.join(__dirname,'lighting-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
