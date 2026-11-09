const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
(async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.goto(process.env.STUDIO_URL||'http://127.0.0.1:8766');
    await page.waitForFunction(()=>window.formationStudio?.audio,{timeout:20000});
    await page.evaluate(()=>{
      formationStudio.pause();const m=formationStudio.model;m.formations=[];m.nextId=1;m.time=0;
      for(const [x,speed] of [[-20,.5],[0,1.5],[20,3]])m.addFormation({x,z:20,strength:24,frontFiles:4,speed});
      m.selectedId=1;
      const probe=window.sharedProbe={violations:[],activations:[],orders:[]},step=m.step.bind(m);
      m.step=dt=>{
        const prior=m.formations.map(f=>({id:f.id,x:f.x,z:f.z,heading:f.heading,active:f.marchActive,deadline:f.marchStartTime}));
        step(dt);
        for(const f of m.formations){
          const old=prior.find(p=>p.id===f.id),changed=Math.hypot(f.x-old.x,f.z-old.z)>1e-9||Math.abs(f.heading-old.heading)>1e-9;
          if(old.deadline!==null&&m.time<=old.deadline+1e-9&&!old.active&&changed)probe.violations.push({kind:'early movement',time:m.time,id:f.id,deadline:old.deadline});
          if(Math.abs(f.marchPhase-(m.time*.7)%1)>1e-9||f.cadenceRate!==.7)probe.violations.push({kind:'clock drift',time:m.time,id:f.id});
          if(!old.active&&f.marchActive)probe.activations.push({id:f.id,time:m.time,deadline:old.deadline});
        }
      };
      const f=m.formations[0];m.order(f.id,{x:f.x,z:-25,heading:0});probe.orders.push({id:f.id,time:m.time,deadline:f.marchStartTime,signal:{...f.drumSignal}});
    });
    await page.click('[data-tab="view"]');await page.click('#march-sound');
    await page.waitForFunction(()=>formationStudio.audio.context?.state==='running');
    await page.click('#play-pause');
    await page.waitForFunction(()=>formationStudio.model.time>=.4);
    await page.evaluate(()=>{const m=formationStudio.model,f=m.formations[1];m.order(f.id,{x:f.x,z:-25,heading:0});sharedProbe.orders.push({id:f.id,time:m.time,deadline:f.marchStartTime,signal:{...f.drumSignal}});});
    await page.waitForFunction(()=>formationStudio.model.time>=.6);
    await page.evaluate(()=>{const m=formationStudio.model,f=m.formations[2];m.order(f.id,{x:f.x,z:-25,heading:0});sharedProbe.orders.push({id:f.id,time:m.time,deadline:f.marchStartTime,signal:{...f.drumSignal}});});
    await page.waitForFunction(()=>formationStudio.model.formations.every(f=>f.marchActive));
    try {await page.waitForFunction(()=>formationStudio.model.time>=4&&formationStudio.audio.drumClocks.size===3,null,{timeout:12000});}
    catch(error){console.error(JSON.stringify(await page.evaluate(()=>({time:formationStudio.model.time,enabled:formationStudio.audio.enabled,context:formationStudio.audio.context?.state,volume:formationStudio.audio.volume,drumVolume:formationStudio.audio.drumVolume,hidden:document.hidden,playing:document.getElementById('play-pause').getAttribute('aria-pressed'),clocks:[...formationStudio.audio.clocks.keys()],drumClocks:[...formationStudio.audio.drumClocks.keys()],stats:formationStudio.audio.stats,formations:formationStudio.model.formations.map(f=>({id:f.id,x:f.x,z:f.z,status:f.status,marchActive:f.marchActive,motion:f.motion})),errors:document.getElementById('loading').innerText}))));throw error;}
    const running=await page.evaluate(async()=>{
      const {soldierAnimation}=await import('./animation.mjs'),{regimentAudioOffset}=await import('./audio.mjs'),s=formationStudio.snapshot,r=formationStudio.renderer;
      const animations=s.soldiers.filter(soldier=>soldier.moving).map(soldier=>{
        const data=(r.assets.characters?.get(r.assets.roles?.[soldier.role])||r.assets).data,animation=soldierAnimation(data,soldier,s.time);
        return {id:soldier.formationId,phase:soldier.movementPhase,rate:animation.rate,clipDuration:animation.clip.duration};
      });
      return {time:s.time,formations:s.formations.map(f=>({id:f.id,speed:f.speed,marchPhase:f.marchPhase,cadenceRate:f.cadenceRate,timingOffset:regimentAudioOffset(f.id)})),animations,probe:sharedProbe,events:formationStudio.audio.stats.events.slice(),drumEvents:formationStudio.audio.stats.drumEvents.slice(),paths:[...formationStudio.audio.paths.keys()],drumClocks:[...formationStudio.audio.drumClocks.keys()],audioState:{enabled:formationStudio.audio.enabled,volume:formationStudio.audio.volume,drumVolume:formationStudio.audio.drumVolume,context:formationStudio.audio.context.state,hidden:document.hidden,formations:formationStudio.model.formations.map(f=>({id:f.id,x:f.x,z:f.z,status:f.status,motion:f.motion}))},gl:r.gl.getError()};
    });
    assert.deepEqual(running.probe.violations,[]);
    assert.equal(running.probe.activations.length,3);
    for(const order of running.probe.orders){assert.equal(order.signal.key,'start');assert.ok(order.deadline*.7>order.signal.endProgress,'The shared start must follow the full command phrase');}
    for(const activation of running.probe.activations){assert.ok(activation.time>=activation.deadline);assert.ok(activation.time-activation.deadline<.018);}
    assert.equal(new Set(running.formations.map(f=>f.marchPhase)).size,1);
    assert.ok(running.animations.length>0);
    for(const animation of running.animations){assert.ok(Math.abs(animation.rate/animation.clipDuration-.7)<1e-9);assert.ok(Math.abs(animation.phase-running.formations[0].marchPhase)<1e-9);}
    const groups=[],heard=new Set(),drumHeard=new Set();
    const expectedOffset=id=>running.formations.find(formation=>formation.id===id).timingOffset;
    for(const event of running.events){
      assert.equal(event.cadenceRate,.7);assert.ok(Number.isInteger(event.contactIndex));
      assert.ok(Math.abs(event.timingOffset-expectedOffset(event.formationId))<1e-9);
      const key=`${event.formationId}:${event.contactIndex}`;assert.ok(!heard.has(key),'A formation must emit each global beat once');heard.add(key);
      let group=groups.find(group=>group.contactIndex===event.contactIndex);
      if(!group){group={phase:event.phase,contactIndex:event.contactIndex,ids:[],times:[],baseTimes:[],offsets:[]};groups.push(group);}
      group.ids.push(event.formationId);group.times.push(event.contactTime);group.baseTimes.push(event.contactTime-event.timingOffset);group.offsets.push(event.timingOffset);
      const drum=running.drumEvents.find(stroke=>stroke.formationId===event.formationId&&stroke.step===event.contactIndex*4);
      assert.ok(drum,'Each regiment must have its own drum accent at every boot contact');
      assert.ok(Math.abs(drum.contactTime-event.contactTime)<.025,`One regiment boots/drums differ by ${drum.contactTime-event.contactTime}s for ${event.formationId}:${event.contactIndex}; both should share the offset within browser scheduling tolerance`);
    }
    for(const drum of running.drumEvents){
      const key=`${drum.formationId}:${drum.step}`;assert.ok(!drumHeard.has(key),'A formation must emit each drum subdivision once');drumHeard.add(key);
      assert.ok(Math.abs(drum.timingOffset-expectedOffset(drum.formationId))<1e-9);
    }
    assert.deepEqual(new Set(running.drumClocks),new Set([1,2,3]),JSON.stringify(running.audioState));
    for(const id of [1,2,3])for(const category of ['boots','drums'])assert.ok(running.paths.includes(`${id}:${category}`),'Every regiment needs its own positioned boots and drum voices');
    for(const group of groups)assert.equal(group.ids.length,new Set(group.ids).size,'A formation must emit each shared contact once');
    const shared=groups.filter(group=>new Set(group.ids).size===3);
    assert.ok(shared.length>=3,'All three formations must share at least three individually offset footfall contacts');
    for(const group of shared){
      assert.ok(Math.max(...group.baseTimes)-Math.min(...group.baseTimes)<.025,'The underlying cadence must remain shared');
      assert.ok(Math.max(...group.times)-Math.min(...group.times)<.045,'Regiments must remain within 45 ms of each other');
      assert.equal(new Set(group.offsets).size,3,'Regiments should not sound at exactly the same instant');
    }
    const beforeHalt=await page.evaluate(()=>{
      const audio=formationStudio.audio;formationStudio.model.halt(2);
      return {bootCounts:[1,2,3].map(id=>audio.stats.events.filter(event=>event.formationId===id).length),drumCounts:[1,2,3].map(id=>audio.stats.drumEvents.filter(event=>event.formationId===id).length)};
    });
    const haltTime=await page.evaluate(()=>formationStudio.model.time);
    await page.waitForFunction(time=>formationStudio.model.time>=time+1,haltTime,{timeout:5000});
    const afterHalt=await page.evaluate(()=>{
      const audio=formationStudio.audio;
      return {bootCounts:[1,2,3].map(id=>audio.stats.events.filter(event=>event.formationId===id).length),drumCounts:[1,2,3].map(id=>audio.stats.drumEvents.filter(event=>event.formationId===id).length),clocks:[...audio.clocks.keys()],drumClocks:[...audio.drumClocks.keys()],paths:[...audio.paths.keys()],sources:[...audio.sources].map(source=>source.formationId)};
    });
    assert.equal(afterHalt.bootCounts[1],beforeHalt.bootCounts[1]);assert.equal(afterHalt.drumCounts[1],beforeHalt.drumCounts[1]);
    for(const index of [0,2]){assert.ok(afterHalt.bootCounts[index]>beforeHalt.bootCounts[index]);assert.ok(afterHalt.drumCounts[index]>beforeHalt.drumCounts[index]);}
    assert.deepEqual(new Set(afterHalt.clocks),new Set([1,3]));assert.deepEqual(new Set(afterHalt.drumClocks),new Set([1,3]));
    assert.ok(!afterHalt.paths.some(key=>key.startsWith('2:'))&&!afterHalt.sources.includes(2),'Halting one regiment must stop only its own audio');
    await page.click('#play-pause');
    const paused=await page.evaluate(()=>({time:formationStudio.model.time,phases:formationStudio.model.formations.map(f=>f.marchPhase),steps:formationStudio.audio.stats.steps}));
    assert.deepEqual(await page.evaluate(()=>({boots:formationStudio.audio.clocks.size,drums:formationStudio.audio.drumClocks.size,sources:formationStudio.audio.sources.size})),{boots:0,drums:0,sources:0});
    await page.waitForTimeout(350);
    assert.deepEqual(await page.evaluate(()=>({time:formationStudio.model.time,phases:formationStudio.model.formations.map(f=>f.marchPhase),steps:formationStudio.audio.stats.steps})),paused);
    const restored=await page.evaluate(()=>{
      const m=formationStudio.model;m.formations.forEach(f=>m.halt(f.id));const f=m.formations[0];m.order(f.id,{x:f.x,z:-25,heading:0});
      const before=formationStudio.sceneDocument();formationStudio.openScene(JSON.parse(JSON.stringify(before)));
      return {before:before.model,after:formationStudio.model.exportScene()};
    });
    assert.deepEqual(restored.after,restored.before);
    assert.equal(restored.after.formations[0].marchActive,false);assert.ok(restored.after.formations[0].marchStartTime>restored.after.time);
    await page.screenshot({path:path.join(__dirname,'shared-cadence.png')});
    assert.equal(running.gl,0);assert.deepEqual(errors,[]);
    const report={result:'passed',checks:['staggered drum orders finish before all three regiments join a shared beat without early movement','slow, walk and run clips retain the same cadence','three regiments add independent boots and drums with stable offsets below 45 ms and no duplicate beats','halting one regiment leaves both other regiments audible','pause freezes the clock and clears all boot and drum voices','scene reopen preserves a pending drum command and beat start'],orders:running.probe.orders,activations:running.probe.activations,sharedContacts:shared,drumEvents:running.drumEvents,afterHalt,errors};
    fs.writeFileSync(path.join(__dirname,'shared-cadence-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
