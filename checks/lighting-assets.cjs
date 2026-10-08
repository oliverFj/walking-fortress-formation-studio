const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1320,height:850}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.formationStudio);
    const result=await page.evaluate(async()=>{
      formationStudio.pause();const {Renderer}=await import('./renderer.mjs');
      const holder=document.createElement('div');holder.style.cssText='position:fixed;inset:0;z-index:1000;background:#e3d9c0;display:grid;grid-template-columns:repeat(3,1fr);padding:12px;gap:12px;overflow:hidden';document.body.append(holder);
      const specifications=[{yaw:45,azimuth:315,title:'Sol 315° · kamera 45°'},{yaw:45,azimuth:135,title:'Sol 135° · kamera 45°'},{yaw:225,azimuth:315,title:'Sol 315° · kamera 225°'}];
      const checks=[],images=[];
      for (const spec of specifications) {
        const card=document.createElement('section');card.style.cssText='display:flex;flex-direction:column;background:#faf4e5;border:1px solid #8e8065;border-radius:10px;padding:12px';
        const heading=document.createElement('h2');heading.textContent=spec.title;heading.style.cssText='font:20px Georgia;margin:4px 0 6px';card.append(heading);
        const label=document.createElement('p');label.textContent='To pikenerer med modsat front. Samme verdensfaste sol.';label.style.cssText='font:14px sans-serif;margin:0 0 12px';card.append(label);
        const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:670px;border-radius:6px;display:block';card.append(canvas);holder.append(card);
        const renderer=new Renderer(canvas);await renderer.loadAssets('assets/character.json');
        renderer.setCamera({yaw:spec.yaw*Math.PI/180,zoom:10,centerX:-Math.sin(spec.yaw*Math.PI/180)*2.2,centerZ:Math.cos(spec.yaw*Math.PI/180)*2.2});
        const snapshot={terrain:'flat',time:0,formations:[],soldiers:[{x:-1.7,z:0,heading:0,phase:0,role:'pike',moving:false},{x:1.7,z:0,heading:Math.PI,phase:0,role:'pike',moving:false}]};
        renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes:true,lighting:{...renderer.assets.data.lighting,azimuth:spec.azimuth}});
        const enabled=renderer.stats.relighting;
        const ground=[...renderer.gl.getUniform(renderer.groundProgram,renderer.gl.getUniformLocation(renderer.groundProgram,'u_lightDirection'))];
        const body=[...renderer.gl.getUniform(renderer.spriteProgram,renderer.gl.getUniformLocation(renderer.spriteProgram,'u_lightDirection'))];
        const image=new Uint8Array(canvas.width*canvas.height*4);renderer.gl.readPixels(0,0,canvas.width,canvas.height,renderer.gl.RGBA,renderer.gl.UNSIGNED_BYTE,image);images.push(image);
        checks.push({spec,enabled,normalSpace:renderer.assets.data.normalSpace,sprites:renderer.stats.sprites,glError:renderer.gl.getError(),ground,body});
      }
      let changingPixels=0;
      for(let i=0;i<Math.min(images[0].length,images[1].length);i+=4)if(Math.max(Math.abs(images[0][i]-images[1][i]),Math.abs(images[0][i+1]-images[1][i+1]),Math.abs(images[0][i+2]-images[1][i+2]))>10)changingPixels++;
      return {views:checks,changingPixels};
    });
    await page.screenshot({path:path.join(__dirname,'lighting-actual-assets.png')});
    for(const check of result.views){assert.equal(check.enabled,true);assert.equal(check.normalSpace,'actor-blender-world');assert.equal(check.sprites,2);assert.equal(check.glError,0);assert.deepEqual(check.ground,check.body);}
    assert.deepEqual(result.views[0].body,result.views[2].body);assert.notDeepEqual(result.views[0].body,result.views[1].body);assert.ok(result.changingPixels>100,`Real normal maps did not change sufficient body pixels: ${result.changingPixels}`);assert.deepEqual(errors,[]);
    const report={result:'passed',checks:result,errors};fs.writeFileSync(path.join(__dirname,'lighting-assets-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
