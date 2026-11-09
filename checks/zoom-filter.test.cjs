const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.formationStudio);
    const hasBaseline=fs.existsSync(path.join(__dirname,'library-zoom-baseline/renderer.mjs'));
    const synthetic=await page.evaluate(async(hasBaseline)=>{
      formationStudio.pause();
      const current=await import('./renderer.mjs'),baseline=hasBaseline ? await import('./checks/library-zoom-baseline/renderer.mjs') : null;
      const results={};
      const profiles=baseline ? [['baseline',baseline.Renderer],['filtered',current.Renderer]] : [['filtered',current.Renderer]];
      for(const [name,Renderer] of profiles){
        const canvas=document.createElement('canvas');canvas.style.cssText='width:400px;height:400px;position:absolute;left:0;top:0';document.body.append(canvas);
        const renderer=new Renderer(canvas),gl=renderer.gl;renderer.groundCount=0;
        function atlas(width,height,rect,pattern){
          const pixels=new Uint8Array(width*height*4);
          for(let y=0;y<height;y++)for(let x=0;x<width;x++){
            const p=(y*width+x)*4,inside=x>=rect[0] && x<rect[0]+rect[2] && y>=rect[1] && y<rect[1]+rect[3];
            pixels.set(inside ? pattern(x-rect[0],y-rect[1]) : [255,0,0,255],p);
          }
          const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
          return {texture,width,height};
        }
        const bodyRect=[32,16,32,80],pikeRect=[24,16,8,80],frame={body:{rect:bodyRect,pivot:[16,80]},pike:{rect:pikeRect,corners:[[-20,0],[-12,0],[-12,80],[-20,80]]}};
        const clip={duration:1,directions:[[frame]]};
        const body=atlas(128,128,bodyRect,(x)=>[0,0,0,x%3===0 ? 255 : 0]);
        const pike=atlas(128,128,pikeRect,(x)=>[0,0,0,x===3 ? 255 : 0]);
        renderer.assets={data:{pixelsPerUnit:16,clips:{idle:clip,walk:clip},firstAzimuth:0,azimuthStep:360},body,normal:null,pike};
        const snapshot={terrain:'flat',time:0,formations:[],soldiers:[{x:0,z:0,heading:0,phase:0,moving:false,role:'pike'}]};
        const options={showFields:false,showTargets:false,showPikes:true,lighting:{enabled:false,strength:0}};
        function draw(){renderer.draw(snapshot,options);const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;}
        const views=[];
        for(const downscale of [4,8]){
          renderer.assets.data.pixelsPerUnit=downscale*4;renderer.setCamera({yaw:0,zoom:100,centerZ:0,centerX:0});
          snapshot.soldiers=[];const ground=draw();snapshot.soldiers=[{x:0,z:0,heading:0,phase:0,moving:false,role:'pike'}];
          const samples=[];
          for(let step=0;step<16;step++){
            renderer.setCamera({centerX:step/16/4});const image=draw();let bodyMass=0,pikeMass=0,bleed=0;
            for(let y=199;y<226;y++)for(let x=183;x<207;x++){
              const p=(y*canvas.width+x)*4,dark=Math.max(0,(ground[p]+ground[p+1]+ground[p+2]-image[p]-image[p+1]-image[p+2])/3/255);
              if(x<200-24/downscale)pikeMass+=dark;else bodyMass+=dark;
              if(image[p]>image[p+1]+25 && image[p+1]<80)bleed++;
            }
            samples.push({bodyMass,pikeMass,bleed});
          }
          const summary=(part)=>{const values=samples.map(s=>s[part]),mean=values.reduce((a,b)=>a+b)/values.length;return {mean,min:Math.min(...values),max:Math.max(...values),spread:(Math.max(...values)-Math.min(...values))/Math.max(mean,1e-8)};};
          views.push({downscale,body:summary('bodyMass'),pike:summary('pikeMass'),neighbourBleed:Math.max(...samples.map(s=>s.bleed)),samples});
        }
        // A filled contour isolates the transition from the expected phase changes
        // of stripes that are still near the sampling limit.
        gl.deleteTexture(body.texture);renderer.assets.body=atlas(128,128,bodyRect,()=>[0,0,0,255]);
        const transition=[];
        for(let step=0;step<=52;step++){
          const downscale=.98+step*.02;
          renderer.assets.data.pixelsPerUnit=downscale*4;renderer.setCamera({centerX:.03125});
          snapshot.soldiers=[];const ground=draw();snapshot.soldiers=[{x:0,z:0,heading:0,phase:0,moving:false,role:'pike'}];
          const image=draw();let mass=0,bleed=0;
          for(let y=195;y<290;y++)for(let x=150;x<235;x++){
            const p=(y*canvas.width+x)*4;
            mass+=Math.max(0,(ground[p]+ground[p+1]+ground[p+2]-image[p]-image[p+1]-image[p+2])/3/255);
            if(image[p]>image[p+1]+25 && image[p+1]<80)bleed++;
          }
          transition.push({downscale,normalizedMass:mass*downscale*downscale,bleed});
        }
        let biggestJump=0;
        for(let i=1;i<transition.length;i++)biggestJump=Math.max(biggestJump,Math.abs(transition[i].normalizedMass-transition[i-1].normalizedMass)/transition[i-1].normalizedMass);
        results[name]={views,transition:{biggestJump,neighbourBleed:Math.max(...transition.filter(v=>v.downscale>1).map(v=>v.bleed)),samples:transition},glError:gl.getError()};renderer.destroy();canvas.remove();
      }
      return results;
    },hasBaseline);
    fs.writeFileSync(path.join(__dirname,'zoom-filter-synthetic-report.json'),JSON.stringify(synthetic,null,2));
    for(let i=0;i<synthetic.filtered.views.length;i++){
      const before=synthetic.baseline?.views[i],after=synthetic.filtered.views[i];
      assert.ok(after.body.mean>1 && after.pike.mean>.08,'Thin body contours and pike must remain visible');
      assert.ok(after.body.spread<(before ? before.body.spread*.8 : .1),'Body coverage must become more stable under subpixel panning');
      assert.ok(after.pike.spread<(before ? before.pike.spread*.8 : .1),'Pike coverage must become more stable under subpixel panning');
      assert.equal(after.neighbourBleed,0,'Samples must not include a neighbouring atlas frame');
    }
    assert.equal(synthetic.filtered.glError,0);
    assert.ok(synthetic.filtered.transition.biggestJump<.08,`Filtering and raster padding must not cause a large zoom-transition jump: ${synthetic.filtered.transition.biggestJump}`);
    assert.equal(synthetic.filtered.transition.neighbourBleed,0);
    const real=await page.evaluate(async()=>{
      const {Renderer}=await import('./renderer.mjs');
      const holder=document.createElement('div');holder.style.cssText='position:fixed;inset:0;z-index:1000;background:#e3d9c0;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;padding:12px';document.body.append(holder);
      const checks=[];
      for(const zoom of [90,140]){
        const card=document.createElement('section'),title=document.createElement('h2');title.textContent=`Formation · zoom ${zoom}`;title.style.cssText='font:20px Georgia';card.append(title);
        const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:810px';card.append(canvas);holder.append(card);
        const renderer=new Renderer(canvas);await renderer.loadAssets('assets/characters.json');
        renderer.setCamera({yaw:25*Math.PI/180,zoom,centerX:0,centerZ:0});
        const soldiers=[];for(let row=0;row<12;row++)for(let col=0;col<18;col++)soldiers.push({x:(col-8.5)*1.1,z:(row-5.5)*1.1,heading:0,phase:0,animationSeed:0,moving:false,role:'pike'});
        renderer.draw({terrain:'flat',time:0,formations:[],soldiers},{showFields:false,showTargets:false,showPikes:true,lighting:formationStudio.view.lighting});
        checks.push({zoom,sprites:renderer.stats.sprites,glError:renderer.gl.getError()});
      }
      return checks;
    });
    await page.screenshot({path:path.join(__dirname,'zoom-filter-formations.png')});
    for(const view of real){assert.equal(view.sprites,216);assert.equal(view.glError,0);}assert.deepEqual(errors,[]);
    const report={result:'passed',synthetic,real,errors};fs.writeFileSync(path.join(__dirname,'zoom-filter-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({result:report.result,before:synthetic.baseline?.views.map(({samples,...v})=>v),after:synthetic.filtered.views.map(({samples,...v})=>v),transitionJump:synthetic.filtered.transition.biggestJump,real}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
