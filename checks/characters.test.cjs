const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1640,height:1050}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  try {
    await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio);
    const result=await page.evaluate(async()=>{
      formationStudio.pause();
      const {Renderer}=await import('./renderer.mjs');
      const {soldierAnimation,animationClips}=await import('./animation.mjs');
      const holder=document.createElement('div');
      holder.style.cssText='position:fixed;inset:0;z-index:1000;background:#e3d9c0;display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(2,minmax(0,1fr));padding:12px;gap:12px;overflow:hidden';
      document.body.append(holder);
      const views=[],directions=[],canvas=document.createElement('canvas');
      canvas.style.cssText='width:100%;flex:1;min-height:0;display:block';
      let renderer;
      for(const role of ['pike','shot'])for(const state of [{moving:false,speed:1.5,label:'Stilstand'},{moving:true,speed:.5,label:'Langsom gang · 0,5 m/s'},{moving:true,speed:1.5,label:'Gang · 1,5 m/s'},{moving:true,speed:3,label:'Løb · 3 m/s'}]) {
        const card=document.createElement('section');
        card.style.cssText='background:#faf4e5;border:1px solid #8e8065;border-radius:10px;padding:10px;min-height:0;display:flex;flex-direction:column';
        const title=document.createElement('h2');title.style.cssText='font:18px Georgia;margin:0 0 4px';
        title.textContent=`${role==='pike'?'Pikener':'Musketer'} · ${state.label}`;card.append(title);
        const caption=document.createElement('p');caption.style.cssText='font:12px sans-serif;margin:0';caption.textContent='Tre faste varianter/faser · verdensfast lys';card.append(caption);
        card.append(canvas);holder.append(card);
        if(!renderer){renderer=new Renderer(canvas);await renderer.loadAssets('assets/characters.json');}
        const characterId=renderer.assets.roles[role],assets=renderer.assets.characters.get(characterId),data=assets.data;
        renderer.setCamera({yaw:Math.PI/4,zoom:10,centerX:-Math.sin(Math.PI/4)*2.4,centerZ:Math.cos(Math.PI/4)*2.4});
        // Isolate real sprite pixels from terrain-light changes in the image comparison.
        renderer.groundCount=0;
        const soldiers=[.03,.37,.71].map((animationSeed,index)=>({x:(index-1)*1.65/Math.sqrt(2),z:(index-1)*1.65/Math.sqrt(2),heading:0,role,moving:state.moving,speed:state.speed,animationSeed,phase:index*.17}));
        const snapshot={terrain:'flat',time:.4,formations:[],soldiers};
        const options={showFields:false,showTargets:false,showPikes:true,lighting:{...data.lighting,style:'solid',azimuth:315}};
        renderer.draw(snapshot,options);
        const stats={...renderer.stats},gl=renderer.gl;
        const first=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,first);
        renderer.draw(snapshot,{...options,lighting:{...options.lighting,azimuth:135}});
        const second=new Uint8Array(first.length);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,second);
        let changingPixels=0;
        for(let index=0;index<first.length;index+=4)if(Math.max(Math.abs(first[index]-second[index]),Math.abs(first[index+1]-second[index+1]),Math.abs(first[index+2]-second[index+2]))>10)changingPixels++;
        const selected=soldiers.map(soldier=>soldierAnimation(data,soldier,snapshot.time));
        const kind=state.moving?'walk':'idle';
        const expected=animationClips(data,kind).filter(([,clip])=>!state.moving||clip.nominalSpeed===state.speed).map(([name])=>name);
        for(let index=0;index<16;index++) {
          renderer.setCamera({yaw:index*Math.PI/8});renderer.draw(snapshot,options);
          directions.push({characterId,speed:state.speed,moving:state.moving,yaw:index,glError:gl.getError(),sprites:renderer.stats.sprites});
        }
        renderer.setCamera({yaw:Math.PI/4});renderer.draw(snapshot,{...options,lighting:{...options.lighting,style:'hatch'}});
        views.push({role,characterId,moving:state.moving,speed:state.speed,expected,selected:selected.map(animation=>({name:animation.name,rate:animation.rate,phase:animation.phase,duration:animation.clip.duration,nominalSpeed:animation.clip.nominalSpeed})),changingPixels,stats,normalMatches:assets.body.width===assets.normal.width&&assets.body.height===assets.normal.height,glError:gl.getError()});
        const preview=document.createElement('img');preview.src=canvas.toDataURL();preview.style.cssText='width:100%;flex:1;min-height:0;object-fit:contain';
        card.replaceChild(preview,canvas);
      }
      renderer.destroy();
      // A mixed formation must bind both body/normal pairs during the same frame.
      const main=formationStudio.renderer;
      main.draw(formationStudio.snapshot,{...formationStudio.view,showSoldiers:true,showFields:true,showPikes:true});
      return {views,directions,mixed:{...main.stats},roles:main.assets.roles};
    });
    await page.screenshot({path:path.join(__dirname,'characters-actual-assets.png')});
    assert.deepEqual(result.roles,{pike:'pikeman',shot:'musketeer'});
    assert.ok(result.mixed.characters.pikeman>0&&result.mixed.characters.musketeer>0);
    for(const view of result.views) {
      assert.equal(view.stats.sprites,3);assert.equal(view.stats.relighting,true);assert.equal(view.stats.characters[view.characterId],3);
      assert.equal(view.normalMatches,true);assert.equal(view.glError,0);
      assert.ok(view.changingPixels>20,`${view.characterId}: sunlight did not affect body pixels`);
      assert.deepEqual([...new Set(view.selected.map(animation=>animation.name))].sort(),view.expected.sort());
      if(view.moving) {
        assert.ok(view.selected.every(animation=>animation.nominalSpeed===view.speed&&animation.rate===1));
        const sharedPhase=.4/view.selected[0].duration;
        assert.ok(view.selected.every(animation=>Math.abs(((animation.phase-sharedPhase+1.5)%1)-.5)<=.04+1e-10));
      }
    }
    for(const direction of result.directions){assert.equal(direction.glError,0);assert.equal(direction.sprites,3);}
    assert.deepEqual(errors,[]);
    const report={result:'passed',...result,errors};
    fs.writeFileSync(path.join(__dirname,'characters-report.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
