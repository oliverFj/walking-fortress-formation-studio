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
      formationStudio.pause();const m=formationStudio.model,a=formationStudio.audio;
      m.formations=[];m.nextId=1;m.time=0;m.terrain='flat';
      for(const x of [-14,14])m.addFormation({x,z:15,heading:0,strength:24,frontFiles:4,speed:1.5});
      m.selectedId=1;
      const probe=window.orderProbe={orders:[],drums:[],signals:[],moves:[],arrivals:[],paths:[],seenOrders:new Set(),seenDrums:new Set(),seenSignals:new Set(),seenMoves:new Set(),seenArrivals:new Set(),startPeak:0};
      const update=a.update.bind(a);
      a.update=(...args)=>{
        update(...args);
        for(const event of a.stats.orderEvents){const key=`${event.formationId}:${event.signalId}:${event.step}`;if(!probe.seenOrders.has(key)){probe.seenOrders.add(key);probe.orders.push({...event});}}
        for(const event of a.stats.drumEvents){const key=`${event.formationId}:${event.step}`;if(!probe.seenDrums.has(key)){probe.seenDrums.add(key);probe.drums.push({...event});}}
        for(const f of m.formations){const s=f.drumSignal,key=s&&`${f.id}:${s.id}`;if(s&&!probe.seenSignals.has(key)){probe.seenSignals.add(key);probe.signals.push({formationId:f.id,...s});}}
        for(const key of a.paths.keys())if(!probe.paths.includes(key))probe.paths.push(key);
      };
      const step=m.step.bind(m);
      m.step=dt=>{
        const prior=m.formations.map(f=>({id:f.id,x:f.x,z:f.z,heading:f.heading,active:f.marchActive}));step(dt);
        for(const f of m.formations){
          const old=prior.find(p=>p.id===f.id);if(!old)continue;
          const changed=Math.hypot(f.x-old.x,f.z-old.z)>1e-8||Math.abs(f.heading-old.heading)>1e-8;
          if(changed&&!probe.seenMoves.has(f.id)){probe.seenMoves.add(f.id);probe.moves.push({formationId:f.id,time:m.time,progress:f.cadenceProgress,marchStartTime:f.marchStartTime,signal:{...f.drumSignal},heardOrders:probe.orders.filter(e=>e.formationId===f.id).length});}
          if(old.active&&!f.marchActive&&!f.maneuver&&!f.waypoints.length&&!probe.seenArrivals.has(f.id)){
            probe.seenArrivals.add(f.id);probe.arrivals.push({formationId:f.id,time:m.time,progress:f.cadenceProgress,x:f.x,z:f.z,target:{...f.target},signal:{...f.drumSignal},audioTime:a.context?.currentTime});
          }
        }
      };
      m.order(1,{x:-14,z:11,heading:0});m.order(2,{x:14,z:-30,heading:0});
    });
    await page.click('[data-tab="view"]');await page.click('#march-sound');
    await page.waitForFunction(()=>formationStudio.audio.context?.state==='running');
    await page.locator('#march-volume').fill('50');await page.locator('#march-volume').dispatchEvent('input');
    await page.locator('#drum-volume').fill('50');await page.locator('#drum-volume').dispatchEvent('input');
    assert.deepEqual(await page.evaluate(()=>({volume:formationStudio.audio.volume,drums:formationStudio.audio.drumVolume})),{volume:.5,drums:.5});
    await page.evaluate(()=>{
      const a=formationStudio.audio,analyser=a.context.createAnalyser();a.master.connect(analyser);
      window.orderAnalyser={analyser,timer:setInterval(()=>{if(formationStudio.model.formations.some(f=>f.marchActive))return;const data=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(data);for(const sample of data)orderProbe.startPeak=Math.max(orderProbe.startPeak,Math.abs(sample));},10)};
    });
    await page.click('#play-pause');
    await page.waitForFunction(()=>formationStudio.model.time>=1.2,null,{timeout:6000});
    const beforeMove=await page.evaluate(()=>({formations:formationStudio.model.formations.map(f=>({id:f.id,x:f.x,z:f.z,active:f.marchActive,signal:{...f.drumSignal},deadline:f.marchStartTime})),orders:orderProbe.orders.slice(),peak:orderProbe.startPeak,boots:formationStudio.audio.stats.steps,masterLevel:formationStudio.audio.masterLevel}));
    assert.ok(beforeMove.formations.every(f=>!f.active&&f.z===15),'The full start command must sound before either regiment starts walking');
    assert.equal(beforeMove.orders.length,8);assert.equal(beforeMove.boots,0);assert.ok(beforeMove.peak>.001,'A stationary regiment must actually emit its start command');
    assert.equal(beforeMove.masterLevel,1,'50% master volume must use the former 100% gain');
    await page.waitForFunction(()=>orderProbe.arrivals.some(a=>a.formationId===1),null,{timeout:10000});
    const complete=await page.evaluate(()=>({orders:orderProbe.orders.slice(),drums:orderProbe.drums.slice(),signals:orderProbe.signals.slice(),moves:orderProbe.moves.slice(),arrivals:orderProbe.arrivals.slice(),paths:orderProbe.paths.slice(),formations:formationStudio.model.formations.map(f=>({id:f.id,active:f.marchActive,z:f.z})),gl:formationStudio.renderer.gl.getError()}));
    for(const id of [1,2]){
      const start=complete.signals.find(s=>s.formationId===id&&s.key==='start'),events=complete.orders.filter(e=>e.formationId===id&&e.signalId===start.id),move=complete.moves.find(m=>m.formationId===id);
      assert.deepEqual(events.map(e=>e.step),[0,2,3,4]);
      assert.ok(move.progress>=start.endProgress&&move.time>=move.marchStartTime,'Movement must wait until the start phrase and its tail finish');
      assert.equal(move.heardOrders,4,'All command attacks must be heard before movement');
      assert.ok(Math.abs((move.marchStartTime*.7-.125)/.5-Math.round((move.marchStartTime*.7-.125)/.5))<1e-8,'The delayed departure must remain on a shared footfall');
      assert.ok(complete.paths.includes(`${id}:orders`),'Each command uses its own positioned regiment audio path');
    }
    for(const event of complete.orders){
      const signal=complete.signals.find(s=>s.formationId===event.formationId&&s.id===event.signalId);
      assert.ok(Math.abs(event.contactProgress-(signal.startProgress+event.step*.125))<1e-8);
      assert.ok(Math.abs((event.contactProgress-.125)/.125-Math.round((event.contactProgress-.125)/.125))<1e-8,'Every command attack must lie on the common drum subdivision');
    }
    for(const step of [0,2,3,4]){
      const pair=complete.orders.filter(e=>e.key==='start'&&e.step===step);
      assert.equal(pair.length,2);assert.equal(pair[0].contactProgress,pair[1].contactProgress);
      assert.ok(Math.abs(pair[0].contactTime-pair[1].contactTime)<.025,'Order attacks use the actual common beat, without regiment offset');
    }
    const stop=complete.signals.find(s=>s.formationId===1&&s.key==='stop'),stopEvents=complete.orders.filter(e=>e.formationId===1&&e.signalId===stop.id),arrival=complete.arrivals.find(a=>a.formationId===1);
    assert.deepEqual(stopEvents.map(e=>e.step),[0,1,3]);assert.ok(arrival.progress>=stop.endProgress-1e-8);
    assert.ok(arrival.audioTime-stopEvents.at(-1).contactTime>=.62,'The stop command must finish ringing before actual arrival');
    assert.ok(Math.hypot(arrival.x-arrival.target.x,arrival.z-arrival.target.z)<.081);
    assert.ok(complete.formations.find(f=>f.id===2).active,'The other regiment must keep marching during and after the stop command');
    const inStop=event=>{const progress=.125+event.step*.125;return progress>=stop.startProgress-1e-8&&progress<stop.endProgress-1e-8;};
    assert.ok(!complete.drums.some(e=>e.formationId===1&&inStop(e)),'A regiment\'s normal drums must give way to its command');
    assert.ok(complete.drums.some(e=>e.formationId===2&&inStop(e)),'Other regiments must retain their regular marching drums');
    await page.click('#play-pause');
    const paused=await page.evaluate(()=>({time:formationStudio.model.time,orders:formationStudio.audio.stats.orders}));
    assert.deepEqual(await page.evaluate(()=>({sources:formationStudio.audio.sources.size,orderClocks:formationStudio.audio.orderClocks.size})),{sources:0,orderClocks:0});
    await page.waitForTimeout(250);assert.deepEqual(await page.evaluate(()=>({time:formationStudio.model.time,orders:formationStudio.audio.stats.orders})),paused);
    const pending=await page.evaluate(()=>{
      const m=formationStudio.model;for(const f of m.formations)m.halt(f.id);
      const f=m.formations[0];m.order(f.id,{x:f.x,z:f.z-8,heading:0});
      const scene=formationStudio.sceneDocument();formationStudio.openScene(JSON.parse(JSON.stringify(scene)));
      return {before:scene.model,after:m.exportScene(),id:f.id};
    });
    assert.deepEqual(pending.after,pending.before,'Save/reopen must preserve a pending start command and its departure gate');
    assert.equal(pending.after.formations[0].drumSignal.key,'start');assert.equal(pending.after.formations[0].marchActive,false);
    await page.click('#play-pause');
    await page.waitForFunction(id=>formationStudio.audio.orderClocks.get(id)?.pending.size>0,pending.id,{timeout:3000});
    const cancelled=await page.evaluate(id=>{
      const m=formationStudio.model,a=formationStudio.audio,f=m.formations.find(f=>f.id===id),signalId=f.drumSignal.id;
      m.halt(id);return {id,signalId,x:f.x,z:f.z,time:m.time,orders:a.stats.orderEvents.filter(e=>e.formationId===id&&e.signalId===signalId).length};
    },pending.id);
    await page.waitForFunction(time=>formationStudio.model.time>=time+2,cancelled.time,{timeout:5000});
    const afterCancel=await page.evaluate(({id,signalId})=>{const a=formationStudio.audio,f=formationStudio.model.formations.find(f=>f.id===id);return {x:f.x,z:f.z,signal:f.drumSignal,orders:a.stats.orderEvents.filter(e=>e.formationId===id&&e.signalId===signalId).length,sources:[...a.sources].filter(source=>source.formationId===id&&source.kind==='orders').length,orderClock:a.orderClocks.has(id)};},cancelled);
    assert.equal(afterCancel.x,cancelled.x);assert.equal(afterCancel.z,cancelled.z);assert.equal(afterCancel.signal,null);assert.equal(afterCancel.orders,cancelled.orders);assert.equal(afterCancel.sources,0);assert.equal(afterCancel.orderClock,false);
    await page.evaluate(()=>{formationStudio.pause();clearInterval(orderAnalyser.timer);formationStudio.audio.master.disconnect(orderAnalyser.analyser);});
    assert.equal(complete.gl,0);assert.deepEqual(errors,[]);
    const report={result:'passed',checks:['50% master gain equals former full-volume gain','stationary regiments audibly play all four start attacks before movement','departure follows command tail on the next common footfall','each regiment has a positioned command path','command attacks share the global drum subdivision without regiment offsets','three stop attacks and ringing tail finish before final arrival','only the commanded regiment suppresses regular drum strokes','pause clears command sources and freezes progress','save/reopen retains the pending start command','Holdt cancels scheduled command attacks and prevents ghost playback'],beforeMove,complete,pending:pending.after.formations[0].drumSignal,cancelled,afterCancel,errors};
    fs.writeFileSync(path.join(__dirname,'drum-orders-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
