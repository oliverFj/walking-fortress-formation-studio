import test from 'node:test';
import assert from 'node:assert/strict';
import {DRUM_SIGNALS,SIGNAL_STEP_CYCLES,SIGNAL_TAIL_SECONDS,signalDurationCycles} from './drum-signals.mjs';
import {FOOTFALL_PHASES,footfallsBetween,nextFootfall,MarchAudio,audioPerspective,DRUM_ACCENTS,fieldDrumStroke,mixMarchStamp,regimentAudioOffset} from './audio.mjs';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,`${actual} != ${expected}`);

test('the original 48-frame animation contacts the ground at frames 6 and 30',()=>{
  assert.deepEqual(FOOTFALL_PHASES,[6/48,30/48]);
  assert.deepEqual(footfallsBetween(5/48,6/48),[6/48]);
  assert.deepEqual(footfallsBetween(6/48,7/48),[]);
  assert.deepEqual(footfallsBetween(29/48,30/48),[30/48]);
  assert.deepEqual(footfallsBetween(30/48,31/48),[]);
});

test('one complete animation cycle produces exactly two contacts',()=>{
  const contacts=[];
  for(let frame=1;frame<=48;frame++)contacts.push(...footfallsBetween((frame-1)/48,(frame%48)/48));
  assert.deepEqual(contacts,[6/48,30/48]);
  for(const phase of [0,.25,.5,.75]){
    assert.deepEqual(footfallsBetween((phase-.001+1)%1,(phase+.001)%1),[]);
  }
});

test('contact crossing includes its end, excludes its start and survives cycle wrap',()=>{
  assert.deepEqual(footfallsBetween(.124,.126),[.125]);
  assert.deepEqual(footfallsBetween(.624,.626),[.625]);
  assert.deepEqual(footfallsBetween(.95,.13),[.125]);
  assert.deepEqual(footfallsBetween(.125,.625),[.625]);
  assert.deepEqual(footfallsBetween(.625,.125),[.125]);
});

test('stopped phases and large scene jumps do not replay contacts',()=>{
  assert.deepEqual(footfallsBetween(.125,.125),[]);
  assert.deepEqual(footfallsBetween(.625,.625),[]);
  assert.deepEqual(footfallsBetween(.1,.8),[]);
  assert.deepEqual(footfallsBetween(.2,.1),[]);
});

test('lookahead always selects a future contact, including at a contact itself',()=>{
  for(const [phase,contact,distance] of [
    [0,.125,.125],[.12,.125,.005],[.125,.625,.5],
    [.13,.625,.495],[.625,.125,.5],[.95,.125,.175]
  ]){
    const next=nextFootfall(phase);
    assert.equal(next.phase,contact);
    close(next.distance,distance);
  }
});


test('runtime schedules two contacts per cycle and clears paused audio without backlog',()=>{
  const audio=new MarchAudio(),scheduled=[];
  let stopped=0;
  audio.enabled=true;
  audio.context={state:'running',currentTime:0};
  audio.level=()=>{};
  audio.footstep=(formation,mix,contact,spread,phase)=>{
    const source={formationId:formation.id,stop(){stopped++;}};
    audio.sources.add(source);
    const event={source,contact,phase};scheduled.push(event);return event;
  };
  const formation={id:1,strength:216,speed:1.5,x:1,z:0,heading:0,layout:[],marchPhase:0,
    motion:{x:0,z:0,heading:0,layout:[]}};
  for(let frame=0;frame<=240;frame++){
    audio.context.currentTime=frame/60;
    formation.marchPhase=(frame/120)%1;
    audio.update([formation]);
  }
  assert.equal(audio.stats.steps,4);
  assert.deepEqual(scheduled.map(event=>event.phase),[.125,.625,.125,.625]);
  scheduled.forEach((event,index)=>close(event.contact,.25+index));
  assert.deepEqual(audio.stats.events.map(event=>event.phase),[.125,.625,.125,.625]);

  audio.update([formation],{running:false});
  assert.equal(audio.clocks.size,0);
  assert.equal(audio.sources.size,0);
  assert.equal(stopped,4);
  // A paused scene may have moved or been replaced; resume adopts its phase.
  formation.marchPhase=.99;
  audio.context.currentTime=40;
  audio.update([formation]);
  assert.equal(scheduled.length,4);
  assert.equal(audio.stats.steps,4);
  for(let frame=1;frame<=21;frame++){
    audio.context.currentTime=40+frame/60;
    formation.marchPhase=(.99+frame/120)%1;
    audio.update([formation]);
  }
  assert.equal(audio.stats.steps,5);
  assert.equal(scheduled.length,5);
  assert.equal(scheduled[4].phase,.125);
  close(scheduled[4].contact,40.27);
});

test('camera distance dims and dulls sound, and camera yaw changes stereo direction',()=>{
  const camera={zoom:20,aspect:1.5,yaw:0,pitch:Math.PI/6,centerX:0,centerZ:0};
  const centre={x:0,z:0},near=audioPerspective(camera,centre);
  const far=audioPerspective({...camera,zoom:110},centre);
  assert.ok(far.gain<near.gain);
  assert.ok(far.detail<near.detail);
  assert.ok(far.lowpass<near.lowpass);
  const offscreen=audioPerspective(camera,{x:40,z:0});
  assert.ok(offscreen.gain<near.gain);
  assert.ok(offscreen.lowpass<near.lowpass);
  const right=audioPerspective(camera,{x:5,z:0});
  const left=audioPerspective({...camera,yaw:Math.PI},{x:5,z:0});
  assert.ok(right.pan>0&&left.pan<0);
  close(right.pan,-left.pan);
});

test('field drums retain the legacy 16-position accents and pitch pattern',()=>{
  assert.deepEqual(DRUM_ACCENTS,[1,0,.42,.34,.78,0,.48,0,.92,0,.38,.34,.68,.32,.5,0]);
  assert.equal(DRUM_ACCENTS.filter(Boolean).length,11);
  for(let step=0;step<16;step++){
    const stroke=fieldDrumStroke(step);
    if(!DRUM_ACCENTS[step])assert.equal(stroke,null);
    else assert.deepEqual(stroke,{accent:DRUM_ACCENTS[step],pitch:step===0?0:step===8?2:step%2?4:3});
    assert.deepEqual(fieldDrumStroke(step+16),stroke);
  }
  assert.equal(fieldDrumStroke(0,0),null);
  close(fieldDrumStroke(0,64).accent,1.24);
});

test('drum subdivisions follow footfalls at normal and double rate, and pause clears both',()=>{
  for(const rate of [1,2]){
    const audio=new MarchAudio(),boots=[],drums=[];
    let stopped=0;
    audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=()=>{};
    audio.drumSamples=[{contact:.029}];
    const sourceFor=(formation,kind)=>{
      const source={formationId:formation.id,kind,stop(){stopped++;}};
      audio.sources.add(source);return source;
    };
    audio.footstep=(formation,mix,contact,spread,phase)=>{
      const event={source:sourceFor(formation,'boots'),contact,phase};boots.push(event);return event;
    };
    audio.drum=(formation,step,stroke,contact)=>{
      const event={source:sourceFor(formation,'drum'),contact,step,stroke};drums.push(event);return event;
    };
    const formation={id:1,strength:216,speed:1.5,x:1,z:0,heading:0,layout:[],marchPhase:0,
      motion:{x:0,z:0,heading:0,layout:[]}};
    for(let frame=0;frame<=240/rate;frame++){
      audio.context.currentTime=frame/60;
      formation.marchPhase=(frame*rate/120)%1;
      audio.update([formation],{rate,selectedId:formation.id});
    }
    assert.equal(audio.stats.steps,4);
    assert.deepEqual(boots.map(event=>event.phase),[.125,.625,.125,.625]);
    boots.forEach((event,index)=>close(event.contact,(.25+index)/rate));
    assert.equal(audio.stats.drums,11);
    assert.deepEqual(drums.map(event=>event.step),DRUM_ACCENTS.flatMap((accent,index)=>accent?[index]:[]));
    drums.forEach(event=>close(event.contact,(.25+event.step*.25)/rate));
    for(const step of [0,4,8,12]){
      close(drums.find(event=>event.step===step).contact,boots[step/4].contact);
    }
    audio.update([formation],{running:false,rate});
    assert.equal(audio.clocks.size,0);
    assert.equal(audio.drumClocks.size,0);
    assert.equal(audio.sources.size,0);
    assert.equal(stopped,boots.length+drums.length);
  }
});

test('a full cohort spreads boot impacts and changes each voice and successive stamp',()=>{
  const sampleRate=8000,contact=.02;
  const boots=[150,225].map(frequency=>({
    contact,
    data:Float32Array.from({length:800},(_,i)=>
      Math.sin(i/sampleRate*frequency*2*Math.PI)*Math.exp(-Math.abs(i/sampleRate-contact)*45)*.12),
  }));
  const stamp=mixMarchStamp(boots,sampleRate,216,.08,137);
  const next=mixMarchStamp(boots,sampleRate,216,.08,1114);
  assert.equal(stamp.voices,48);
  assert.equal(stamp.placements.length,48);
  const offsets=stamp.placements.map(voice=>voice.offset);
  assert.ok(Math.min(...offsets)<-.065&&Math.max(...offsets)>.065,'impacts should cover both sides of the common beat');
  assert.equal(new Set(offsets).size,48,'each boot has its own impact time');
  assert.ok(offsets.filter(offset=>Math.abs(offset)<.005).length<=8,'avoid a pile of identical central impacts');
  assert.ok(new Set(stamp.placements.map(voice=>voice.pitch)).size>=20,'voices need varied pitch');
  assert.ok(new Set(stamp.placements.map(voice=>voice.gain)).size>=20,'voices need varied weight');
  for(const voice of stamp.placements){
    assert.ok(Math.abs(voice.pitch)<=2.3,'retain recognisable boots rather than extreme pitch shifts');
    close(voice.rate,2**(voice.pitch/12));
    assert.ok(voice.gain>0&&Math.abs(voice.pan)<=1);
    assert.ok(voice.sampleIndex>=0&&voice.sampleIndex<boots.length);
  }
  assert.ok(new Set(stamp.placements.map(voice=>voice.sampleIndex)).size>1,'use more than one isolated recording');
  assert.notDeepEqual(next.placements,stamp.placements,'successive stamps should not repeat the same cohort');
  assert.notDeepEqual(next.channels[0],stamp.channels[0],'variation must reach the rendered sound');
});


test('regiments with different speeds join one cadence with their own small sound offset',()=>{
  const audio=new MarchAudio(),scheduled=[];
  audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=()=>{};
  audio.footstep=(formation,mix,contact,spread,phase)=>{
    const event={source:{formationId:formation.id,stop(){}},formationId:formation.id,contact,spread,phase};
    audio.sources.add(event.source);scheduled.push(event);return event;
  };
  const rate=.7;
  const formations=[.5,3].map((speed,index)=>({
    id:index+1,strength:216,speed,x:0,z:0,heading:0,layout:[],marchPhase:.9,
    cadenceRate:rate,cadenceProgress:0,marchStartTime:(.125+index*.5)/rate,
    motion:{x:0,z:0,heading:0,layout:[]},
  }));
  for(let frame=0;frame<=240;frame++){
    const time=frame/60;audio.context.currentTime=time;
    for(const formation of formations){
      formation.cadenceProgress=time*rate;
      formation.x=time>=formation.marchStartTime?1:0;
    }
    audio.update(formations);
  }
  const contacts=id=>scheduled.filter(event=>event.formationId===id);
  assert.equal(audio.stats.steps,11);
  assert.equal(contacts(1).length,6);
  assert.equal(contacts(2).length,5);
  close(contacts(1)[0].contact,.125/rate);
  close(contacts(2)[0].contact,.625/rate+regimentAudioOffset(2));
  for(let index=0;index<5;index++){
    close(contacts(2)[index].contact-contacts(1)[index+1].contact,regimentAudioOffset(2));
    close(contacts(1)[index+1].spread,contacts(2)[index].spread);
    assert.equal(contacts(1)[index+1].phase,contacts(2)[index].phase);
  }
  close(audio.clocks.get(1).pace,rate);
  close(audio.clocks.get(2).pace,rate);
  assert.ok(audio.stats.events.every(event=>event.cadenceRate===rate));
  assert.deepEqual(new Set(audio.stats.events.map(event=>event.formationId)),new Set([1,2]));
});

test("pause does not replay a freshly joined regiment's first contact",()=>{
  const audio=new MarchAudio(),contacts=[];
  audio.enabled=true;audio.context={state:'running',currentTime:1};audio.level=()=>{};
  audio.footstep=(formation,mix,contact,spread,phase)=>{
    const event={source:{formationId:formation.id,stop(){}},contact};
    audio.sources.add(event.source);contacts.push(contact);return event;
  };
  const formation={id:1,strength:216,speed:3,x:1,z:0,heading:0,layout:[],
    cadenceRate:.7,cadenceProgress:.135,marchPhase:.135,marchStartTime:.125/.7,
    motion:{x:0,z:0,heading:0,layout:[]}};
  audio.update([formation]);
  assert.equal(contacts.length,1);
  assert.equal(audio.stats.steps,1);
  audio.update([formation],{running:false});
  audio.update([formation]);
  assert.equal(contacts.length,1);
  assert.equal(audio.stats.steps,1);
});

test('every marching regiment retains an independent drum pattern regardless of selection',()=>{
  const audio=new MarchAudio(),drums=[];
  audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=()=>{};
  audio.drumSamples=[{contact:0}];
  const sourceFor=(formation,kind)=>{
    const source={formationId:formation.id,kind,stop(){}};audio.sources.add(source);return source;
  };
  audio.footstep=(formation,mix,contact)=>({source:sourceFor(formation,'boots'),contact});
  audio.drum=(formation,step,stroke,contact)=>{
    const event={source:sourceFor(formation,'drums'),step,contact,formationId:formation.id};
    drums.push(event);return event;
  };
  const formations=[.5,3].map((speed,index)=>({
    id:index+1,strength:216,speed,x:0,z:0,heading:0,layout:[],marchPhase:0,
    cadenceRate:.7,cadenceProgress:0,marchStartTime:(.125+index*.5)/.7,
    motion:{x:0,z:0,heading:0,layout:[]},
  }));
  for(let frame=0;frame<=240;frame++){
    const time=frame/60;audio.context.currentTime=time;
    for(const formation of formations){
      formation.cadenceProgress=time*.7;formation.x=time>=formation.marchStartTime?1:0;
    }
    audio.update(formations,{selectedId:time<1.5?1:2});
  }
  assert.equal(drums[0].step,0,'the first contact must also include its accented drum');
  close(drums[0].contact,.125/.7);
  for(const formation of formations){
    const own=drums.filter(event=>event.formationId===formation.id);
    assert.ok(own.length>8,'each regiment must have its own audible drum pattern');
    assert.equal(new Set(own.map(event=>event.step)).size,own.length,'selection changes must not repeat strokes');
    for(const event of own)close(event.contact,(.125+event.step*.125)/.7+regimentAudioOffset(formation.id));
    assert.ok(own.some(event=>event.step>=16),'each drum measure continues across full animation cycles');
  }
  const ownFirst=drums.find(event=>event.formationId===2);
  assert.equal(ownFirst.step,4,'the later regiment joins the current measure rather than restarting it');
  const shared=drums.filter(event=>event.step===8);
  assert.equal(shared.length,2,'both regiments must add a drum stroke on the same underlying beat');
  close(shared[1].contact-shared[0].contact,regimentAudioOffset(2));
});

test('regiment sound offsets stay stable and small without changing the common cadence',()=>{
  close(regimentAudioOffset(1),0);
  const offsets=Array.from({length:24},(_,index)=>regimentAudioOffset(index+1));
  assert.equal(new Set(offsets).size,24);
  for(let id=1;id<=24;id++){
    close(regimentAudioOffset(id),offsets[id-1]);
    assert.ok(offsets[id-1]>=0&&offsets[id-1]<.045,'the offset must remain less than 45 ms');
  }
});

test('three regiments contribute boots and drums on the same individually offset beat, including at double playback rate',()=>{
  for(const rate of [1,2]){
    const audio=new MarchAudio(),boots=[],drums=[],stopped=[];
    audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=()=>{};
    audio.drumSamples=[{contact:.029}];
    const sourceFor=(formation,kind)=>{
      const source={formationId:formation.id,kind,stop(){stopped.push({id:this.formationId,kind:this.kind});}};
      audio.sources.add(source);return source;
    };
    audio.footstep=(formation,mix,contact,spread,phase)=>{
      const event={source:sourceFor(formation,'boots'),formationId:formation.id,mix,contact,phase};boots.push(event);return event;
    };
    audio.drum=(formation,step,stroke,contact,mix)=>{
      const event={source:sourceFor(formation,'drums'),formationId:formation.id,step,stroke,contact,mix};drums.push(event);return event;
    };
    const formations=[.5,1.5,3].map((speed,index)=>({
      id:index+1,strength:216,speed,x:1,z:0,heading:0,layout:[],marchPhase:0,
      cadenceRate:.7,cadenceProgress:0,marchStartTime:.125/.7,
      motion:{x:0,z:0,heading:0,layout:[]},
    }));
    for(let frame=0;frame<=240/rate;frame++){
      audio.context.currentTime=frame/60;
      for(const formation of formations)formation.cadenceProgress=frame/60*.7*rate;
      audio.update(formations,{rate,selectedId:frame%3+1});
    }
    assert.equal(audio.clocks.size,3);assert.equal(audio.drumClocks.size,3);
    for(const formation of formations){
      const ownBoots=boots.filter(event=>event.formationId===formation.id),ownDrums=drums.filter(event=>event.formationId===formation.id);
      assert.ok(ownBoots.length>=6);assert.ok(ownDrums.length>ownBoots.length);
      ownBoots.forEach((event,index)=>{
        close(event.contact,(.125+index*.5)/(.7*rate)+regimentAudioOffset(formation.id)/rate);
        close(event.mix,3**(-.2));
        assert.ok(event.mix>1/Math.sqrt(3),'additional regiments must add audible sound energy');
        const drum=ownDrums.find(stroke=>stroke.step===index*4);
        assert.ok(drum,"each footfall must have the same regiment's aligned drum accent");
        close(drum.contact,event.contact);
      });
      assert.equal(new Set(ownDrums.map(event=>event.step)).size,ownDrums.length,'each regiment plays each subdivision at most once');
      for(const event of ownDrums){
        close(event.contact,(.125+event.step*.125)/(.7*rate)+regimentAudioOffset(formation.id)/rate);
        close(event.mix,3**(-.2));
      }
    }
    for(const event of [...audio.stats.events,...audio.stats.drumEvents])close(event.timingOffset,regimentAudioOffset(event.formationId)/rate);
    assert.equal(new Set(audio.stats.events.map(event=>event.formationId)).size,3);
    assert.equal(new Set(audio.stats.drumEvents.map(event=>event.formationId)).size,3);

    formations[1].motion.x=formations[1].x;
    const haltedAt=drums.length,bootHaltedAt=boots.length;
    audio.update(formations,{rate});
    assert.deepEqual([...audio.clocks.keys()],[1,3]);assert.deepEqual([...audio.drumClocks.keys()],[1,3]);
    assert.ok(stopped.some(source=>source.id===2&&source.kind==='boots'));
    assert.ok(stopped.some(source=>source.id===2&&source.kind==='drums'));
    for(let frame=1;frame<=90/rate;frame++){
      audio.context.currentTime=(240/rate+frame)/60;
      for(const formation of formations)formation.cadenceProgress=audio.context.currentTime*.7*rate;
      audio.update(formations,{rate});
    }
    assert.deepEqual(new Set(boots.slice(bootHaltedAt).map(event=>event.formationId)),new Set([1,3]));
    assert.deepEqual(new Set(drums.slice(haltedAt).map(event=>event.formationId)),new Set([1,3]));
    audio.update(formations,{running:false,rate});
    assert.equal(audio.clocks.size,0);assert.equal(audio.drumClocks.size,0);assert.equal(audio.sources.size,0);
    audio.update(formations,{rate});
    assert.equal(audio.clocks.size,2);assert.equal(audio.drumClocks.size,2);
    audio.mute();
    assert.equal(audio.clocks.size,0);assert.equal(audio.drumClocks.size,0);assert.equal(audio.sources.size,0);
  }
});


test('rewinding a muted scene permits the reused formation ID to sound its new first contact',()=>{
  const audio=new MarchAudio(),contacts=[];
  audio.enabled=true;audio.context={state:'running',currentTime:1};audio.level=()=>{};
  audio.footstep=(formation,mix,contact)=>{
    const event={source:{formationId:formation.id,stop(){}},contact};
    audio.sources.add(event.source);contacts.push(contact);return event;
  };
  const formation={id:1,strength:216,speed:3,x:1,z:0,heading:0,layout:[],
    cadenceRate:.7,cadenceProgress:.135,marchPhase:.135,marchStartTime:.125/.7,
    motion:{x:0,z:0,heading:0,layout:[]}};
  audio.update([formation]);
  assert.equal(contacts.length,1);
  audio.enabled=false;formation.cadenceProgress=0;formation.marchPhase=0;formation.x=0;
  audio.update([formation],{running:false});
  audio.enabled=true;formation.cadenceProgress=.135;formation.marchPhase=.135;formation.x=1;
  audio.update([formation]);
  assert.equal(contacts.length,2);
  assert.equal(audio.stats.steps,2);
});

test('an epsilon-close contact cannot play twice through crossing or lookahead',()=>{
  const audio=new MarchAudio(),contacts=[],drums=[];
  audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=()=>{};
  audio.drumSamples=[{contact:0}];
  const sourceFor=formation=>{const source={formationId:formation.id,stop(){}};audio.sources.add(source);return source;};
  audio.footstep=(formation,mix,contact,spread,phase)=>{
    const event={source:sourceFor(formation),contact,phase};contacts.push(event);return event;
  };
  audio.drum=(formation,step,stroke,contact)=>{
    const event={source:sourceFor(formation),contact,step};drums.push(event);return event;
  };
  const formation={id:1,strength:216,speed:3,x:1,z:0,heading:0,layout:[],
    cadenceRate:.7,cadenceProgress:.6,marchPhase:.6,marchStartTime:null,
    motion:{x:0,z:0,heading:0,layout:[]}};
  for(const progress of [.6,.625-1e-10,.625+1e-10,.64]){
    audio.context.currentTime=progress/.7;formation.cadenceProgress=progress;formation.marchPhase=progress;
    audio.update([formation]);
  }
  assert.equal(contacts.length,1,'lookahead must not schedule an already consumed contact again');
  assert.equal(audio.stats.steps,1);
  assert.equal(audio.stats.events[0].contactIndex,1,'epsilon before the contact must retain the correct absolute index');
  assert.equal(drums.filter(event=>event.step===4).length,1,'the aligned drum subdivision must also play once');
  close(contacts[0].contact,.625/.7);
});

const audioHarness=()=>{
  const audio=new MarchAudio(),heard={boots:[],drums:[],orders:[]},stopped=[];
  audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=value=>audio.masterLevel=value;
  audio.drumSamples=[{contact:.029}];
  const play=(formation,kind,details)=>{
    const source={formationId:formation.id,kind,stop(){stopped.push(this);}};
    audio.sources.add(source);
    const event={source,formationId:formation.id,...details};heard[kind].push(event);return event;
  };
  audio.footstep=(formation,mix,contact)=>play(formation,'boots',{mix,contact});
  audio.drum=(formation,step,stroke,contact,mix)=>play(formation,'drums',{step,stroke,contact,mix});
  audio.order=(formation,signal,stroke,contact,mix,rate)=>play(formation,'orders',{signalId:signal.id,key:signal.key,step:stroke.step,stroke,contact,mix,rate});
  const advance=(formations,progress,options={})=>{
    audio.context.currentTime=progress/(.7*(options.rate||1));
    for(const formation of formations)formation.cadenceProgress=progress;
    audio.update(formations,options);
  };
  return {audio,heard,stopped,advance};
};
const signalFormation=(id=1)=>({id,strength:216,speed:1.5,x:0,z:0,heading:0,layout:[],
  cadenceRate:.7,cadenceProgress:0,marchPhase:0,marchStartTime:null,motion:{x:0,z:0,heading:0,layout:[]}});
const signal=(id,key,startProgress)=>({id,key,startProgress,endProgress:startProgress+signalDurationCycles(key)});

test('volume and drum sliders at 50 percent retain their former maximum, including command paths',()=>{
  const audio=new MarchAudio(),levels=[],param=()=>({value:0,setTargetAtTime(value){this.value=value;}});
  audio.enabled=true;audio.context={state:'running',currentTime:0};audio.level=value=>levels.push(value);
  audio.setVolume(.5);close(levels.at(-1),1);
  audio.setVolume(1);close(levels.at(-1),2);
  audio.setVolume(0);close(levels.at(-1),0);
  for(const category of ['boots','drums','orders']){
    const path={category,gain:{gain:param()},pan:{pan:param()},filter:{frequency:param()},send:{gain:param()}};
    audio.paths.set(category,path);audio.drumVolume=.5;audio.position(path,{x:0,z:0});
    close(path.gain.gain.value,1);
  }
  audio.setDrumVolume(1);
  close(audio.paths.get('drums').gain.gain.value,2);close(audio.paths.get('orders').gain.gain.value,2);
  close(audio.paths.get('boots').gain.gain.value,1);
  audio.setDrumVolume(0);
  close(audio.paths.get('drums').gain.gain.value,0);close(audio.paths.get('orders').gain.gain.value,0);
});

test('stationary start commands use their legacy accents on the exact common subdivision at both playback rates',()=>{
  for(const rate of [1,2]){
    const {audio,heard,advance}=audioHarness(),formations=[signalFormation(1),signalFormation(2)];
    for(const f of formations)f.drumSignal=signal(1,'start',.125);
    for(let frame=0;frame<=110;frame++)advance(formations,frame/100,{rate});
    assert.equal(audio.stats.orders,8);assert.equal(audio.stats.steps,0);assert.equal(audio.stats.drums,0);
    assert.equal(audio.orderClocks.size,2);
    for(const formation of formations){
      const own=heard.orders.filter(event=>event.formationId===formation.id);
      assert.deepEqual(own.map(event=>event.stroke),DRUM_SIGNALS.start);
      own.forEach(event=>{close(event.contact,(.125+event.step*SIGNAL_STEP_CYCLES)/(.7*rate));assert.equal(event.rate,rate);});
      const records=audio.stats.orderEvents.filter(event=>event.formationId===formation.id);
      assert.deepEqual(records.map(event=>event.step),[0,2,3,4]);
      records.forEach(event=>close(event.contactProgress,.125+event.step*.125));
    }
    for(let i=0;i<4;i++)close(heard.orders[i*2].contact,heard.orders[i*2+1].contact);
    close(audio.masterLevel,2*audio.volume);
  }
});

test('a stop command suppresses only its own field drums and keeps playing after movement stops',()=>{
  const {audio,heard,stopped,advance}=audioHarness(),formations=[signalFormation(1),signalFormation(2)];
  for(const f of formations)f.x=1;
  advance(formations,.5);
  formations[0].drumSignal=signal(2,'stop',.625);
  for(let frame=51;frame<=148;frame++){
    const progress=frame/100;
    // The sound clock must survive removal of this formation's boot clock.
    if(progress>=.8)formations[0].motion.x=1;
    advance(formations,progress);
  }
  const own=heard.orders.filter(event=>event.formationId===1);
  assert.deepEqual(own.map(event=>event.step),[0,1,3]);
  assert.equal(audio.stats.orders,3);
  assert.ok(audio.stats.events.some(event=>event.formationId===1&&event.phase===.625));
  assert.ok(heard.drums.some(event=>event.formationId===2&&event.contact>.625/.7));
  assert.ok(audio.stats.drumEvents.filter(event=>event.formationId===1)
    .every(event=>event.step<4||event.step>10),'ordinary drum strokes must leave room for their own stop phrase');
  assert.ok(stopped.every(source=>source.kind!=='orders'),'ending movement must not cut off the stop phrase');
  advance(formations,1.48);assert.equal(audio.stats.orders,3,'completed persistent signals must not repeat');
});

test('pause, mute, zero drum gain and scene jumps cancel pending command audio without replay or backlog',()=>{
  for(const interruption of ['pause','mute','drum-zero','hidden']){
    const {audio,heard,advance}=audioHarness(),f=signalFormation();f.drumSignal=signal(1,'start',.125);
    advance([f],.13);assert.equal(audio.stats.orders,1);
    // The second stroke is in lookahead when interrupted.
    advance([f],.35);assert.equal(heard.orders.length,2);
    if(interruption==='pause')advance([f],.35,{running:false});
    else if(interruption==='hidden')advance([f],.35,{visible:false});
    else if(interruption==='mute')audio.mute();
    else audio.setDrumVolume(0);
    assert.equal([...audio.sources].filter(source=>source.kind==='orders').length,0);
    audio.enabled=true;if(interruption==='drum-zero')audio.setDrumVolume(.65);
    advance([f],.35);
    for(let frame=36;frame<=70;frame++)advance([f],frame/100);
    assert.deepEqual(audio.stats.orderEvents.map(event=>event.step),[0,2,3,4]);
    assert.equal(heard.orders.filter(event=>event.step===0).length,1,'heard first stroke must not replay');
  }
  const {audio,advance}=audioHarness(),f=signalFormation();f.drumSignal=signal(1,'start',.125);
  advance([f],0);advance([f],3);assert.equal(audio.stats.orders,0,'scene jumps must not pile up missed strokes');
  f.drumSignal=signal(2,'start',3.125);advance([f],3.13);assert.equal(audio.stats.orders,1);
  audio.enabled=false;advance([f],0,{running:false});
  f.drumSignal=signal(1,'start',.125);audio.enabled=true;advance([f],.13);
  assert.equal(audio.stats.orders,2,'a new rewound scene must be allowed its new command');
});

test('replacing or clearing a command cancels only that regiment, while muted elapsed commands are skipped',()=>{
  const {audio,heard,stopped,advance}=audioHarness(),formations=[signalFormation(1),signalFormation(2)];
  formations.forEach(f=>f.drumSignal=signal(1,'start',.125));
  advance(formations,.35);
  const disconnected=[];
  for(const id of [1,2])audio.paths.set(`${id}:orders`,{formationId:id,category:'orders',
    ...Object.fromEntries(['filter','gain','pan','send'].map(name=>[name,{disconnect(){disconnected.push({id,name});}}]))});
  audio.position=()=>{};
  formations[0].drumSignal=null;advance(formations,.36);
  assert.deepEqual(disconnected.map(node=>node.id),[1,1,1,1]);
  assert.equal(audio.paths.has('1:orders'),false);assert.equal(audio.paths.has('2:orders'),true);
  assert.ok(stopped.some(source=>source.kind==='orders'&&source.formationId===1));
  assert.ok(stopped.every(source=>source.formationId===1));
  for(let frame=37;frame<=70;frame++)advance(formations,frame/100);
  assert.deepEqual(audio.stats.orderEvents.filter(event=>event.formationId===2).map(event=>event.step),[2,3,4]);
  assert.ok(heard.orders.filter(event=>event.formationId===1).length<=1);
  audio.mute();formations[0].drumSignal=signal(3,'stop',1.125);
  advance(formations,1.7);audio.enabled=true;advance(formations,1.7);
  assert.equal(heard.orders.filter(event=>event.signalId===3).length,0,'mute must not queue missed command strokes for resume');
});

test('native order drum tails end before the model release while retaining the shared contact marker',()=>{
  const audio=new MarchAudio(),calls=[],param=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
  const source={playbackRate:{value:1},connect(){},disconnect(){},start(...args){calls.push(['start',...args]);},stop(time){calls.push(['stop',time]);}};
  audio.context={currentTime:1,createBufferSource:()=>source,createGain:()=>({gain:param(),connect(){},disconnect(){}})};
  audio.path=()=>({filter:{}});
  const event=audio.playBuffer({duration:2},signalFormation(),'orders',1.1,.029,1,1);
  close(event.contact,1.1);close(calls[0][1],1.1-.029);close(calls[1][1],1.1+SIGNAL_TAIL_SECONDS);
  assert.equal(source.kind,'orders');
  calls.length=0;
  audio.playBuffer({duration:2},signalFormation(),'orders',1.1,.029,1,1,SIGNAL_TAIL_SECONDS/2);
  close(calls[1][1],1.1+SIGNAL_TAIL_SECONDS/2);
  let capturedTail;audio.drumSamples=[{buffer:{duration:2},contact:.029}];
  audio.playBuffer=(buffer,formation,category,contact,lead,gain,pitch,tail)=>{capturedTail=tail;return {source:{},contact};};
  audio.order(signalFormation(),signal(1,'start',.125),DRUM_SIGNALS.start[0],1.1,1,2);
  close(capturedTail,SIGNAL_TAIL_SECONDS/2);
});
