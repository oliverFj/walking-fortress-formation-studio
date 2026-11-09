import {cadenceReference} from './march.mjs';
import {DRUM_SIGNALS,SIGNAL_STEP_CYCLES,SIGNAL_TAIL_SECONDS} from './drum-signals.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const wrap=value=>((value%1)+1)%1;
// Original 48-frame clips: left/right ground contact at frames 6 and 30.
export const FOOTFALL_PHASES=Object.freeze([6/48,30/48]);
export function footfallsBetween(previous,current){
  const delta=wrap(current-previous);
  if(delta<1e-8||delta>.5)return [];
  return FOOTFALL_PHASES.filter(phase=>{
    const distance=wrap(phase-previous);
    return distance>1e-8&&distance<=delta+1e-8;
  }).sort((a,b)=>wrap(a-previous)-wrap(b-previous));
}
export function nextFootfall(phase){
  phase=wrap(phase);
  return FOOTFALL_PHASES.map(contact=>({phase:contact,distance:wrap(contact-phase)||1}))
    .sort((a,b)=>a.distance-b.distance)[0];
}
const FIRST_CONTACT=FOOTFALL_PHASES[0],CONTACT_INTERVAL=FOOTFALL_PHASES[1]-FIRST_CONTACT;
const moving=formation=>{
  const prior=formation.motion;
  if(!formation.strength||!prior)return false;
  if(Math.hypot(formation.x-prior.x,formation.z-prior.z)>1e-7||Math.abs(formation.heading-prior.heading)>1e-7)return true;
  return formation.layout.some(field=>{
    const old=prior.layout.find(item=>item.key===field.key);
    return !old||['x','z','width','depth'].some(key=>Math.abs(field[key]-old[key])>1e-7);
  });
};
const orderKey=signal=>`${signal.id}:${signal.key}:${signal.startProgress}:${signal.endProgress}`;
const validOrder=formation=>formation.strength>0&&Number.isFinite(formation.cadenceProgress)
  &&Number.isFinite(formation.drumSignal?.startProgress)&&Number.isFinite(formation.drumSignal?.endProgress)
  &&DRUM_SIGNALS[formation.drumSignal.key];
const orderOccupies=(formation,progress)=>validOrder(formation)
  &&progress>=formation.drumSignal.startProgress-1e-8&&progress<=formation.drumSignal.endProgress+1e-8;
const randomFrom=seed=>()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};

// Perspective adapted from Walking Fortress/game/audio.ts. Studio zoom is
// orthographic visible height in metres; smaller values mean a closer view.
export function audioPerspective(camera,formation){
  if(!camera)return {gain:1,pan:0,lowpass:6200,detail:1,reverb:.06};
  const zoom=Math.max(10,camera.zoom||54),aspect=Math.max(.5,camera.aspect||1.5);
  const yaw=camera.yaw||0,pitch=camera.pitch??Math.PI/6;
  const dx=formation.x-(camera.centerX||0),dz=formation.z-(camera.centerZ||0);
  const normalX=(dx*Math.cos(yaw)+dz*Math.sin(yaw))/(zoom*aspect/2);
  const normalY=(-dx*Math.sin(yaw)+dz*Math.cos(yaw))*Math.sin(pitch)/(zoom/2);
  const distance=Math.hypot(normalX,normalY),edge=Math.max(Math.abs(normalX),Math.abs(normalY));
  const detail=clamp((110-zoom)/90,0,1),dulling=clamp(distance/2.2,0,1);
  return {
    gain:clamp((.46+detail*.54)/(1+distance*distance*.72)*(edge<=1?1:Math.exp(-(edge-1)*1.75)),0,1),
    pan:clamp(normalX*.72,-.88,.88),
    lowpass:900+detail*5300-dulling*(360+detail*1750),detail,
    reverb:clamp((1-detail)*.26+distance*.09,.035,.32),
  };
}
export const DRUM_ACCENTS=Object.freeze([1,0,.42,.34,.78,0,.48,0,.92,0,.38,.34,.68,.32,.5,0]);
export function fieldDrumStroke(step,count=1){
  const index=((step%16)+16)%16,accent=DRUM_ACCENTS[index];
  if(!accent||count<1)return null;
  return {accent:accent*(1+Math.min(.24,Math.log2(count)*.045)),pitch:index===0?0:index===8?2:index%2?4:3};
}

// Relative category gains: the drum slider can now bring the cadence clearly
// forward instead of reaching its ceiling below the combined marching boots.
export const BOOT_MIX_GAIN=.75;
export const DRUM_MIX_GAIN=3.2;

// Mix independently varied boots around the shared contact. Resampling changes
// pitch, and compensating the contact marker keeps each landing on its offset.
export function mixMarchStamp(boots,sampleRate,strength,spread,seed=1){
  if(!boots.length)throw new Error('Der mangler støvletrin');
  const random=randomFrom(seed),men=clamp(Math.round(strength),1,864),voices=Math.min(men,48);
  const minRate=Math.pow(2,-2.25/12);
  const lead=spread+Math.max(...boots.map(boot=>boot.contact/minRate));
  const duration=lead+spread+Math.max(...boots.map(boot=>(boot.data.length/sampleRate-boot.contact)/minRate));
  const channels=[new Float32Array(Math.ceil(duration*sampleRate)),new Float32Array(Math.ceil(duration*sampleRate))];
  const mass=clamp(Math.sqrt(men/216),.07,1.25),placements=[];
  let order=[],lastSample=-1;
  for(let voice=0;voice<voices;voice++){
    // Stratified irregular timing avoids a central pile of identical impacts.
    // All landings still fall within the soldiers' +/-4% cycle variation.
    const offset=voices===1?0:((voice+random())/voices*2-1)*spread;
    if(!order.length){
      order=boots.map((_,index)=>index);
      for(let i=order.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
      if(order.length>1&&order[order.length-1]===lastSample)[order[0],order[order.length-1]]=[order[order.length-1],order[0]];
    }
    const sampleIndex=order.pop(),boot=boots[sampleIndex];lastSample=sampleIndex;
    const pitch=(random()*2-1)*2.25,rate=Math.pow(2,pitch/12);
    const pan=random()*1.8-.9,left=Math.sqrt((1-pan)/2),right=Math.sqrt((1+pan)/2);
    const gain=(.45+random()*.75)*mass*3/Math.sqrt(voices);
    const brightness=3200+random()*5800,alpha=1-Math.exp(-2*Math.PI*brightness/sampleRate);
    const start=Math.max(0,Math.round((lead+offset-boot.contact/rate)*sampleRate));
    const length=Math.ceil(boot.data.length/rate);let tone=0;
    for(let i=0;i<length&&start+i<channels[0].length;i++){
      const position=i*rate,index=Math.floor(position),fraction=position-index;
      const raw=(boot.data[index]||0)*(1-fraction)+(boot.data[index+1]||0)*fraction;
      tone+=alpha*(raw-tone);
      const sample=gain*tone;
      channels[0][start+i]+=sample*left;channels[1][start+i]+=sample*right;
    }
    placements.push({offset,pitch,rate,gain,pan,sampleIndex});
  }
  let peak=0;for(const channel of channels)for(const sample of channel)peak=Math.max(peak,Math.abs(sample));
  const scale=peak>.85?.85/peak:1;
  if(scale!==1)for(const channel of channels)for(let i=0;i<channel.length;i++)channel[i]*=scale;
  return {channels,lead,duration,voices,placements};
}

// A small fixed delay separates regiments without drifting off the shared beat.
// Formation 1 retains the original timing; other IDs spread across 45 ms.
export function regimentAudioOffset(id) {
  return (((Math.max(1,id)-1)*0.618033988749895)%1)*.045;
}

export class MarchAudio {
  constructor(){
    this.enabled=false;this.volume=.35;this.drumVolume=.65;this.context=null;this.master=null;
    this.clocks=new Map();this.sources=new Set();this.banks=new Map();this.paths=new Map();this.masterLevel=0;
    this.bootSamples=[];this.drumSamples=[];this.drumClocks=new Map();this.camera=null;
    // Keep heard starts through pause/mute so a fresh audio clock cannot replay
    // the first marching contact when playback resumes on that same beat.
    this.heardStarts=new Map();this.heardOrders=new Map();this.orderClocks=new Map();this.lastCadenceProgress=null;
    this.stats={steps:0,drums:0,lastFormationId:null,lastPhase:null,events:[],drumEvents:[],orders:0,orderEvents:[]};this.lastVariants=new Map();
  }
  async enable(){
    try {
      if(!this.context||this.context.state==='closed'){
        const AudioContext=globalThis.AudioContext||globalThis.webkitAudioContext;
        if(!AudioContext)return false;
        this.context=new AudioContext();this.master=this.context.createGain();
        const limiter=this.context.createDynamicsCompressor();
        limiter.threshold.value=-6;limiter.knee.value=6;limiter.ratio.value=8;
        limiter.attack.value=.002;limiter.release.value=.12;
        this.master.gain.value=0;this.master.connect(limiter);limiter.connect(this.context.destination);
        this.masterLevel=0;this.banks.clear();this.paths.clear();this.bootSamples=[];this.drumSamples=[];
        this.createReverb();
      }
      // Resume during the trusted click, before awaiting local asset reads.
      await this.context.resume();
      if(!this.bootSamples.length)await this.loadSamples();
      this.enabled=this.context.state==='running';this.reset();return this.enabled;
    }catch(error){this.assetError=error.message;this.enabled=false;this.level(0);return false;}
  }
  async loadSamples(){
    const load=async url=>{
      const manifestUrl=new URL(url,import.meta.url),response=await fetch(manifestUrl);
      if(!response.ok)throw new Error(`Lydfil mangler: ${url}`);
      const manifest=await response.json();
      return Promise.all(manifest.samples.map(async sample=>{
        const file=await fetch(new URL(sample.file,manifestUrl));
        if(!file.ok)throw new Error(`Lydfil mangler: ${sample.file}`);
        const buffer=await this.context.decodeAudioData(await file.arrayBuffer());
        return {...sample,buffer,data:buffer.getChannelData(0)};
      }));
    };
    const [boots,drums]=await Promise.all([load('./assets/audio/boots/manifest.json'),load('./assets/audio/drums/manifest.json')]);
    this.bootSamples=boots;this.drumSamples=drums;
  }
  createReverb(){
    const context=this.context,reverb=context.createConvolver(),tone=context.createBiquadFilter(),wet=context.createGain();
    const impulse=context.createBuffer(2,Math.ceil(context.sampleRate*.55),context.sampleRate),random=randomFrom(367);
    for(let channel=0;channel<2;channel++){
      const samples=impulse.getChannelData(channel);
      for(let i=0;i<samples.length;i++)samples[i]=(random()*2-1)*Math.exp(-i/context.sampleRate*10)*(i<context.sampleRate*.025?0:1);
    }
    reverb.buffer=impulse;tone.type='lowpass';tone.frequency.value=2400;wet.gain.value=.5;
    reverb.connect(tone);tone.connect(wet);wet.connect(this.master);this.reverb=reverb;
  }
  path(formation,category='boots'){
    const key=`${formation.id}:${category}`;let path=this.paths.get(key);
    if(!path){
      const context=this.context,filter=context.createBiquadFilter(),gain=context.createGain(),pan=context.createStereoPanner(),send=context.createGain();
      filter.type='lowpass';filter.Q.value=.4;filter.connect(gain);gain.connect(pan);pan.connect(this.master);pan.connect(send);send.connect(this.reverb);
      path={filter,gain,pan,send,formationId:formation.id,category};this.paths.set(key,path);
    }
    this.position(path,formation);return path;
  }
  position(path,formation){
    const perspective=audioPerspective(this.camera,formation),now=this.context.currentTime;
    path.perspectiveGain=perspective.gain;
    path.gain.gain.setTargetAtTime(perspective.gain*(['drums','orders'].includes(path.category)?2*this.drumVolume:1),now,.04);
    path.pan.pan.setTargetAtTime(perspective.pan,now,.04);
    path.filter.frequency.setTargetAtTime(perspective.lowpass,now,.04);
    path.send.gain.setTargetAtTime(perspective.reverb,now,.06);
  }
  level(value){
    if(!this.master||value===this.masterLevel)return;
    this.masterLevel=value;this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(value,this.context.currentTime,.01);
  }
  stop(source){try{source.stop();}catch{}this.sources.delete(source);}
  reset(){for(const source of this.sources)this.stop(source);this.clocks.clear();this.drumClocks.clear();this.orderClocks.clear();}
  mute(){this.enabled=false;this.level(0);this.reset();}
  setVolume(value){this.volume=Number.isFinite(Number(value))?clamp(Number(value),0,1):0;this.level(this.enabled?2*this.volume:0);if(!this.volume)this.reset();}
  setDrumVolume(value){
    this.drumVolume=Number.isFinite(Number(value))?clamp(Number(value),0,1):0;
    for(const path of this.paths.values())if(['drums','orders'].includes(path.category)){
      path.gain.gain.setTargetAtTime((path.perspectiveGain??1)*2*this.drumVolume,this.context.currentTime,.01);
    }
    if(!this.drumVolume){for(const source of this.sources)if(['drums','orders'].includes(source.kind))this.stop(source);this.drumClocks.clear();this.orderClocks.clear();}
  }
  update(formations,{running=true,visible=true,rate=1,camera,selectedId}={}){
    this.camera=camera;
    const progress=formations.find(f=>Number.isFinite(f.cadenceProgress))?.cadenceProgress;
    if(Number.isFinite(progress)){
      // A new/opened scene can reuse both formation IDs and start times.
      // Detect its rewind even while paused or muted, before the early return.
      if(this.lastCadenceProgress!==null&&progress<this.lastCadenceProgress-1e-8){this.heardStarts.clear();this.heardOrders.clear();this.reset();}
      this.lastCadenceProgress=progress;
    }
    this.syncOrders(formations);
    if(!this.enabled||!running||!visible||this.volume===0||this.context?.state!=='running'){
      this.consumeSilentOrders(formations);this.reset();this.level(0);return;
    }
    const active=formations.filter(moving),ids=new Set(active.map(f=>f.id));
    const commanding=formations.filter(f=>validOrder(f)&&f.cadenceProgress<=f.drumSignal.endProgress+1e-8);
    this.level(active.length||commanding.length||[...this.sources].some(source=>source.kind==='orders')?2*this.volume:0);
    for(const [id] of this.clocks)if(!ids.has(id)){
      for(const source of this.sources)if(source.formationId===id&&source.kind!=='orders')this.stop(source);
      this.clocks.delete(id);this.drumClocks.delete(id);
      for(const [key,path] of this.paths)if(path.formationId===id&&path.category!=='orders'){
        for(const node of [path.filter,path.gain,path.pan,path.send])node.disconnect();this.paths.delete(key);
      }
    }
    for(const path of this.paths.values()){
      const formation=formations.find(f=>f.id===path.formationId);if(formation)this.position(path,formation);
    }
    const sounding=new Set([...active,...commanding].map(f=>f.id));
    const mix=Math.max(1,sounding.size)**-.2,now=this.context.currentTime;
    this.updateOrders(formations,mix,rate,now);
    for(const formation of active){
      const cadenceRate=Number.isFinite(formation.cadenceRate)&&formation.cadenceRate>0?formation.cadenceRate:null;
      const shared=cadenceRate!==null&&Number.isFinite(formation.cadenceProgress);
      const timingOffset=regimentAudioOffset(formation.id)/rate;
      const phase=wrap(shared?formation.cadenceProgress:formation.marchPhase);
      const pace=(cadenceRate??clamp(formation.speed/cadenceReference(formation.speed),.15,5)/2)*rate;
      let clock=this.clocks.get(formation.id),startContactIncluded=false;
      if(!clock){
        let progress=shared?formation.cadenceProgress:phase;
        const start=formation.marchStartTime;
        if(shared&&Number.isFinite(start)&&this.heardStarts.get(formation.id)!==start){
          const startProgress=start*cadenceRate,elapsed=progress-startProgress;
          // Joining regiments begin on a contact. Include it on their first
          // moving frame; enabling sound much later adopts the current beat.
          if(elapsed>=-1e-8&&elapsed<=.08){progress=startProgress-1e-7;startContactIncluded=true;}
          this.heardStarts.set(formation.id,start);
        }
        clock={phase:wrap(progress),progress,pace,pending:new Map(),shared,lastContactIndex:-Infinity};this.clocks.set(formation.id,clock);
      }
      const previous=clock.progress,delta=shared?formation.cadenceProgress-clock.progress:wrap(phase-clock.phase);
      if(delta<0||delta>.5){
        for(const event of clock.pending.values())this.stop(event.source);
        clock.progress=shared?formation.cadenceProgress:phase;clock.pending.clear();clock.lastContactIndex=-Infinity;
      }else clock.progress+=delta;
      clock.phase=phase;clock.previous=previous;clock.startContactIncluded=startContactIncluded;
      if(pace!==clock.pace){
        for(const [index,event] of clock.pending)if(event.contact>now){this.stop(event.source);clock.pending.delete(index);}
        clock.pace=pace;
      }
      for(const contactPhase of footfallsBetween(wrap(previous),phase)){
        if(delta<0||delta>.5)break;
        // An epsilon-close contact may be observed just before its raw phase.
        // Use its absolute index and consume it once, including lookahead.
        const contactProgress=contactPhase+Math.floor(clock.progress-contactPhase+1e-8);
        const index=Math.round((contactProgress-FIRST_CONTACT)/CONTACT_INTERVAL);
        if(index<=clock.lastContactIndex)continue;
        clock.lastContactIndex=index;
        let event=clock.pending.get(index);
        const contact=shared?now-(clock.progress-(FIRST_CONTACT+index*CONTACT_INTERVAL))/pace:now;
        if(!event)event=this.footstep(formation,mix,contact+timingOffset,.04/pace,contactPhase);
        clock.pending.delete(index);
        this.stats.steps++;this.stats.lastFormationId=formation.id;this.stats.lastPhase=contactPhase;
        this.stats.events.push({formationId:formation.id,contactIndex:index,cadenceRate:cadenceRate??pace/rate,phase:contactPhase,observedPhase:phase,contactTime:event.contact,timingOffset,observedTime:now});
        if(this.stats.events.length>32)this.stats.events.shift();
      }
      const index=Math.max(Math.floor((clock.progress-FIRST_CONTACT)/CONTACT_INTERVAL+1e-8)+1,clock.lastContactIndex+1);
      const contactPhase=FOOTFALL_PHASES[((index%2)+2)%2];
      const distance=(FIRST_CONTACT+index*CONTACT_INTERVAL-clock.progress)/pace,spread=.04/pace;
      const preRoll=Math.max(0,...this.bootSamples.map(boot=>boot.contact));
      if(distance<=spread+preRoll+.035&&!clock.pending.has(index)){
        clock.pending.set(index,this.footstep(formation,mix,now+distance+timingOffset,spread,contactPhase));
      }
    }
    this.updateDrums(active,mix,rate,now);
  }
  playBuffer(buffer,formation,category,contact,lead,gainValue=1,playbackRate=1,orderTail=SIGNAL_TAIL_SECONDS){
    const context=this.context,source=context.createBufferSource(),gain=context.createGain();
    source.buffer=buffer;source.playbackRate.value=playbackRate;source.formationId=formation.id;source.kind=category;
    gain.gain.value=gainValue;source.connect(gain);gain.connect(this.path(formation,category).filter);
    const start=contact-lead/playbackRate,now=context.currentTime;
    const offset=Math.max(0,(now-start)*playbackRate);
    if(offset<buffer.duration){
      const when=Math.max(now,start);
      if(['drums','orders'].includes(category)){
        // Match the old field-drum envelope; long recording tails otherwise
        // obscure successive strokes in the cadence.
        gain.gain.setValueAtTime(.0001,when);
        gain.gain.exponentialRampToValueAtTime(.52*gainValue,when+.003);
        gain.gain.setValueAtTime(.4*gainValue,when+.18);
        gain.gain.exponentialRampToValueAtTime(.0001,category==='orders'?Math.max(when+.181,contact+orderTail):when+.72);
      }
      source.start(when,offset);if(['drums','orders'].includes(category))source.stop(category==='orders'?Math.max(when+.181,contact+orderTail):when+.76);this.sources.add(source);
    }
    source.onended=()=>{source.disconnect();gain.disconnect();this.sources.delete(source);};
    return {source,contact};
  }
  footstep(formation,mix,contact,spread,phase){
    const context=this.context,kind=formation.speed>=2.25?'run':'walk';
    let variant=Math.floor(Math.random()*32);
    if(variant===this.lastVariants.get(formation.id))variant=(variant+1)%32;
    this.lastVariants.set(formation.id,variant);
    const key=`${formation.id}:${kind}:${Math.round(formation.strength)}:${spread.toFixed(3)}:${variant}`;
    let bank=this.banks.get(key);
    if(!bank){
      const boots=this.bootSamples.filter(boot=>boot.kind===kind);
      const stamp=mixMarchStamp(boots,context.sampleRate,formation.strength,spread,137+variant*977+formation.id*7919);
      const buffer=context.createBuffer(2,stamp.channels[0].length,context.sampleRate);
      stamp.channels.forEach((channel,index)=>buffer.copyToChannel(channel,index));
      bank={buffer,lead:stamp.lead};if(this.banks.size>=64)this.banks.delete(this.banks.keys().next().value);this.banks.set(key,bank);
    }
    return {...this.playBuffer(bank.buffer,formation,'boots',contact,bank.lead,mix*BOOT_MIX_GAIN),phase};
  }
  updateDrums(active,mix,rate,now=this.context.currentTime){
    if(!this.drumVolume||!this.drumSamples.length||!active.length){this.drumClocks.clear();return;}
    // Reuse the boot scheduling timestamp: preparing a new boot bank can
    // advance the audio clock while the simulation phase remains unchanged.
    const first=FIRST_CONTACT,interval=CONTACT_INTERVAL/4;
    const lead=Math.max(...this.drumSamples.map(sample=>sample.contact));
    for(const formation of active){
      const motion=this.clocks.get(formation.id),timingOffset=regimentAudioOffset(formation.id)/rate;
      let clock=this.drumClocks.get(formation.id);
      if(!clock||clock.pace!==motion.pace||motion.progress<clock.progress||clock.shared!==motion.shared){
        if(clock)for(const event of clock.pending.values())if(event.contact>now)this.stop(event.source);
        const progress=motion.startContactIncluded?motion.previous:motion.progress;
        clock={progress,pace:motion.pace,pending:new Map(),shared:motion.shared,lastStep:-Infinity};
        this.drumClocks.set(formation.id,clock);
      }
      // Each regiment has its own drummer and source position, while the
      // absolute subdivision index keeps every pattern on the common clock.
      for(let step=Math.floor((clock.progress-first)/interval)+1;first+step*interval<=motion.progress+1e-8;step++){
        if(step<=clock.lastStep)continue;
        clock.lastStep=step;
        const stroke=orderOccupies(formation,first+step*interval)?null:fieldDrumStroke(step,1);
        if(stroke){
          const contact=(motion.shared?now-(motion.progress-(first+step*interval))/motion.pace:now)+timingOffset;
          let event=clock.pending.get(step);
          if(!event)event=this.drum(formation,step,stroke,contact,mix);
          this.stats.drums++;clock.pending.delete(step);
          this.stats.drumEvents.push({formationId:formation.id,step,contactTime:event.contact,timingOffset});
          if(this.stats.drumEvents.length>96)this.stats.drumEvents.shift();
        }
      }
      clock.progress=motion.progress;
      const last=motion.progress+motion.pace*(lead+.06);
      for(let step=Math.max(Math.floor((motion.progress-first)/interval+1e-8)+1,clock.lastStep+1);first+step*interval<=last;step++){
        const stroke=orderOccupies(formation,first+step*interval)?null:fieldDrumStroke(step,1);
        if(stroke&&!clock.pending.has(step))clock.pending.set(step,this.drum(formation,step,stroke,now+(first+step*interval-motion.progress)/motion.pace+timingOffset,mix));
      }
    }
  }
  syncOrders(formations){
    const ids=new Set(formations.map(f=>f.id));
    for(const [id,heard] of this.heardOrders){
      const formation=formations.find(f=>f.id===id);
      if(!formation||!validOrder(formation)||heard.key!==orderKey(formation.drumSignal)){
        for(const source of this.sources)if(source.formationId===id&&source.kind==='orders')this.stop(source);
        const path=this.paths.get(`${id}:orders`);
        if(path){
          for(const node of [path.filter,path.gain,path.pan,path.send])node.disconnect();
          this.paths.delete(`${id}:orders`);
        }
        this.orderClocks.delete(id);this.heardOrders.delete(id);
      }
    }
    for(const formation of formations)if(validOrder(formation)){
      const key=orderKey(formation.drumSignal);
      if(!this.heardOrders.has(formation.id))this.heardOrders.set(formation.id,{key,steps:new Set()});
      // Cancel ordinary drum lookahead inside the command, including when a
      // stop cue is added after the next field-drum stroke was scheduled.
      const clock=this.drumClocks.get(formation.id);
      if(clock)for(const [step,event] of clock.pending)if(orderOccupies(formation,FIRST_CONTACT+step*CONTACT_INTERVAL/4)){
        this.stop(event.source);clock.pending.delete(step);
      }
    }
    for(const source of this.sources)if(!ids.has(source.formationId))this.stop(source);
  }
  consumeSilentOrders(formations){
    for(const formation of formations)if(validOrder(formation)){
      const signal=formation.drumSignal,heard=this.heardOrders.get(formation.id);
      for(const stroke of DRUM_SIGNALS[signal.key])if(signal.startProgress+stroke.step*SIGNAL_STEP_CYCLES<=formation.cadenceProgress+1e-8)heard.steps.add(stroke.step);
    }
  }
  updateOrders(formations,mix,rate,now=this.context.currentTime){
    if(!this.drumVolume||!this.drumSamples.length){this.consumeSilentOrders(formations);return;}
    const lead=Math.max(...this.drumSamples.map(sample=>sample.contact));
    for(const formation of formations)if(validOrder(formation)){
      const signal=formation.drumSignal,progress=formation.cadenceProgress;
      const pace=(formation.cadenceRate||.7)*rate,heard=this.heardOrders.get(formation.id);
      let clock=this.orderClocks.get(formation.id);
      const fresh=!clock;
      if(!clock){clock={key:heard.key,progress,pace,pending:new Map()};this.orderClocks.set(formation.id,clock);}
      if(clock.pace!==pace||progress<clock.progress-1e-8||progress-clock.progress>.5){
        for(const event of clock.pending.values())this.stop(event.source);
        clock.pending.clear();
      }
      const jump=progress-clock.progress>.5||progress<clock.progress-1e-8;
      clock.pace=pace;
      for(const stroke of DRUM_SIGNALS[signal.key]){
        const contactProgress=signal.startProgress+stroke.step*SIGNAL_STEP_CYCLES;
        if(heard.steps.has(stroke.step))continue;
        if(contactProgress<=progress+1e-8){
          // Sound enabled mid-phrase adopts the current pulse. Never dump
          // missed command strokes into one frame or replay heard accents.
          if(jump||(fresh&&progress-contactProgress>.08)){
            const pending=clock.pending.get(stroke.step);if(pending)this.stop(pending.source);
            clock.pending.delete(stroke.step);heard.steps.add(stroke.step);continue;
          }
          let event=clock.pending.get(stroke.step);
          if(!event)event=this.order(formation,signal,stroke,now-(progress-contactProgress)/pace,mix,rate);
          clock.pending.delete(stroke.step);heard.steps.add(stroke.step);this.stats.orders++;
          this.stats.orderEvents.push({formationId:formation.id,signalId:signal.id,key:signal.key,step:stroke.step,contactProgress,contactTime:event.contact});
          if(this.stats.orderEvents.length>96)this.stats.orderEvents.shift();
        }else if((contactProgress-progress)/pace<=lead+.06&&!clock.pending.has(stroke.step)){
          clock.pending.set(stroke.step,this.order(formation,signal,stroke,now+(contactProgress-progress)/pace,mix,rate));
        }
      }
      clock.progress=progress;
    }
  }
  order(formation,signal,stroke,contact,mix=1,playbackScale=1){
    const index=(((stroke.step+formation.id-1)%this.drumSamples.length)+this.drumSamples.length)%this.drumSamples.length;
    const sample=this.drumSamples[index],rate=clamp((53+stroke.pitch)/54,.9,1.12);
    const detail=audioPerspective(this.camera,formation).detail;
    const event=this.playBuffer(sample.buffer,formation,'orders',contact,sample.contact,mix*DRUM_MIX_GAIN*stroke.accent*(.46+detail*.34),rate,SIGNAL_TAIL_SECONDS/playbackScale);
    event.source.signalId=signal.id;event.source.signalKey=orderKey(signal);return event;
  }
  drum(formation,step,stroke,contact,mix=1){
    const index=(((step+formation.id-1)%this.drumSamples.length)+this.drumSamples.length)%this.drumSamples.length;
    const sample=this.drumSamples[index],rate=clamp((53+stroke.pitch)/54,.9,1.12);
    const detail=audioPerspective(this.camera,formation).detail;
    return this.playBuffer(sample.buffer,formation,'drums',contact,sample.contact,mix*DRUM_MIX_GAIN*stroke.accent*(.46+detail*.34),rate);
  }
}
