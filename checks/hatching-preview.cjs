const {chromium}=require('C:/Users/olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1320,height:850}});
 try {
  await page.goto(process.env.STUDIO_URL || 'http://127.0.0.1:8766');await page.waitForFunction(()=>window.formationStudio);await page.evaluate(()=>formationStudio.pause());
  await page.evaluate(async()=>{
   const {Renderer}=await import('./renderer.mjs');const holder=document.createElement('div');holder.style.cssText='position:fixed;inset:0;z-index:1000;background:#e3d9c0;display:grid;grid-template-columns:repeat(3,1fr);padding:12px;gap:12px;overflow:hidden';document.body.append(holder);
   for(const spec of [{title:'Uden formskygge',enabled:false,style:'hatch'},{title:'Fyldt blækskygge',enabled:true,style:'solid'},{title:'Streger og krydsstreger',enabled:true,style:'hatch'}]){
    const card=document.createElement('section');card.style.cssText='display:flex;flex-direction:column;background:#faf4e5;border:1px solid #8e8065;border-radius:10px;padding:12px';
    const heading=document.createElement('h2');heading.textContent=spec.title;heading.style.cssText='font:21px Georgia;margin:4px 0 6px';card.append(heading);const label=document.createElement('p');label.textContent='Sol 315° · to modsatte retninger · samme farve';label.style.cssText='font:14px sans-serif;margin:0 0 12px';card.append(label);
    const canvas=document.createElement('canvas');canvas.style.cssText='width:100%;height:710px;border-radius:6px;display:block';card.append(canvas);holder.append(card);
    const renderer=new Renderer(canvas);await renderer.loadAssets('assets/character.json');renderer.setCamera({yaw:45*Math.PI/180,centerX:-Math.sin(Math.PI/4)*1.2,centerZ:Math.cos(Math.PI/4)*1.2});renderer.camera.zoom=4.8;
    const snapshot={terrain:'flat',time:0,formations:[],soldiers:[{x:-.75,z:0,heading:0,phase:0,role:'pike',moving:false},{x:.75,z:0,heading:Math.PI,phase:0,role:'pike',moving:false}]};
    renderer.draw(snapshot,{showFields:false,showTargets:false,showPikes:false,lighting:{...renderer.assets.data.lighting,...spec}});
   }
  });
  await page.screenshot({path:path.join(__dirname,'hatching-close.png')});
  await page.reload();await page.waitForFunction(()=>window.formationStudio);await page.evaluate(()=>{formationStudio.pause();formationStudio.renderer.draw(formationStudio.snapshot,{showFields:true,showTargets:true,showPikes:true,lighting:{...formationStudio.view.lighting,style:'hatch'}});});
  await page.screenshot({path:path.join(__dirname,'hatching-army.png')});
 } finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
