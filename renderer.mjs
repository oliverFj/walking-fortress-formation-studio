import { heightAt, terrainBounds } from './terrain.mjs';
import { normalizeLighting, lightDirection } from './lighting.mjs';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mod = (v, n) => ((v % n) + n) % n;

function shader(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Grafikkortet kunne ikke oprette shaderen: ${message}`);
  }
  return s;
}

function program(gl, vertex, fragment) {
  const p = gl.createProgram();
  const v = shader(gl, gl.VERTEX_SHADER, vertex);
  const f = shader(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

const cameraUniforms = `
uniform vec3 u_center;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_eyeDirection;
uniform vec2 u_scale;
vec4 project(vec3 world) {
  vec3 p = world - u_center;
  return vec4(dot(p, u_right) * u_scale.x, dot(p, u_up) * u_scale.y,
    -dot(p, u_eyeDirection) / 210.0, 1.0);
}
`;

const groundVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
${cameraUniforms}
out vec3 v_world;
uniform vec3 u_lightDirection;
uniform bool u_lightEnabled;
out float v_light;
void main() {
  v_world = a_position;
  v_light = u_lightEnabled ? 0.79 + 0.22 * max(dot(a_normal, u_lightDirection),0.0) : 1.0;
  gl_Position = project(a_position);
}
`;
const groundFragment = `#version 300 es
precision highp float;
in vec3 v_world;
in float v_light;
out vec4 outColor;
void main() {
  vec3 base = mix(vec3(0.78,0.735,0.605),vec3(0.61,0.59,0.50),smoothstep(0.8,8.0,v_world.y));
  vec2 grid = abs(fract(v_world.xz / 5.0 - 0.5) - 0.5) / max(fwidth(v_world.xz / 5.0),vec2(0.0001));
  float line = 1.0 - min(min(grid.x,grid.y),1.0);
  base *= 1.0 - 0.05 * line;
  outColor = vec4(base * v_light,1.0);
}
`;

const colorVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_position;
layout(location=1) in vec4 a_color;
${cameraUniforms}
out vec4 v_color;
void main() { gl_Position = project(a_position); v_color = a_color; }
`;
const colorFragment = `#version 300 es
precision highp float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }
`;

const spriteVertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_world;
layout(location=1) in vec4 a_uvRect;
layout(location=2) in vec4 a_corner01;
layout(location=3) in vec4 a_corner23;
layout(location=4) in vec4 a_tint;
layout(location=5) in float a_heading;
layout(location=6) in float a_relight;
${cameraUniforms}
out vec2 v_uv;
out vec2 v_hatchCoord;
out vec4 v_tint;
flat out vec2 v_actorRotation;
flat out float v_relight;
void main() {
  int corner = gl_VertexID == 0 || gl_VertexID == 3 ? 0 :
    gl_VertexID == 1 ? 1 : gl_VertexID == 2 || gl_VertexID == 4 ? 2 : 3;
  vec2 p = corner == 0 ? a_corner01.xy : corner == 1 ? a_corner01.zw :
    corner == 2 ? a_corner23.xy : a_corner23.zw;
  vec2 uv = corner == 0 ? vec2(0.,0.) : corner == 1 ? vec2(1.,0.) :
    corner == 2 ? vec2(1.,1.) : vec2(0.,1.);
  v_uv = a_uvRect.xy + uv * a_uvRect.zw;
  // The pattern belongs to the billboard, anchored at the feet. It stays put
  // when the camera pans, rather than sliding across a screen-space mask.
  v_hatchCoord = p;
  v_tint = a_tint;
  v_actorRotation = vec2(cos(a_heading),sin(a_heading));
  v_relight = a_relight;
  gl_Position = project(a_world + u_right * p.x + u_up * p.y);
}
`;
const spriteFragment = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_normals;
uniform vec3 u_lightDirection;
uniform bool u_lightEnabled;
uniform vec3 u_inkColor;
uniform float u_shadowStrength;
uniform float u_shadowThreshold;
uniform float u_shadowSoftness;
uniform bool u_hatchEnabled;
uniform float u_hatchSpacing;
uniform float u_hatchWidth;
uniform float u_hatchAngle;
uniform float u_crossStart;
in vec2 v_uv;
in vec2 v_hatchCoord;
in vec4 v_tint;
flat in vec2 v_actorRotation;
flat in float v_relight;
out vec4 outColor;

// Integral of a repeated hard-edged stroke. Box filtering over the pixel's
// footprint gives fractional coverage without blurring the ink itself. When
// many strokes fit in one pixel this converges to their actual covered area,
// which prevents crawling or moire as the camera zooms out.
float strokeIntegral(float x, float duty) {
  return floor(x)*duty + clamp(fract(x),0.0,duty);
}
float strokeCoverage(float coordinate, float spacing, float width) {
  float q = coordinate / spacing;
  float duty = clamp(width / spacing,0.0,0.9);
  float footprint = max(fwidth(q),0.00001);
  float center = q + 0.5*duty;
  return clamp((strokeIntegral(center+0.5*footprint,duty)-
    strokeIntegral(center-0.5*footprint,duty))/footprint,0.0,1.0);
}
float hatchCoverage(float depth, float depthAA) {
  vec2 direction = vec2(-sin(u_hatchAngle),cos(u_hatchAngle));
  float primaryCoord = dot(v_hatchCoord,direction);
  float crossCoord = dot(v_hatchCoord,vec2(direction.y,-direction.x));
  // The nested strokes share an origin: going deeper adds lines between the
  // existing ones rather than changing their position.
  float sparse = strokeCoverage(primaryCoord,u_hatchSpacing*4.0,u_hatchWidth);
  float medium = strokeCoverage(primaryCoord,u_hatchSpacing*2.0,u_hatchWidth);
  float dense = strokeCoverage(primaryCoord,u_hatchSpacing,u_hatchWidth);
  float primary = max(sparse,max(
    medium*smoothstep(0.16-depthAA,0.16+depthAA,depth),
    dense*smoothstep(0.42-depthAA,0.42+depthAA,depth)));
  float crossSparse = strokeCoverage(crossCoord,u_hatchSpacing*2.0,u_hatchWidth);
  float crossDense = strokeCoverage(crossCoord,u_hatchSpacing,u_hatchWidth);
  float deepStart = min(0.95,u_crossStart+0.25);
  float cross = max(crossSparse*smoothstep(u_crossStart-depthAA,u_crossStart+depthAA,depth),
    crossDense*smoothstep(deepStart-depthAA,deepStart+depthAA,depth));
  return 1.0-(1.0-primary)*(1.0-cross);
}
void main() {
  vec4 ink = texture(u_texture,v_uv);
  vec4 normalData = texture(u_normals,v_uv);
  vec3 actor = normalData.rgb * 2.0 - 1.0;
  float actorLength = length(actor);
  vec3 mapped = actorLength > 0.1 ? actor.xzy / actorLength : vec3(0.0,1.0,0.0);
  float c = v_actorRotation.x, s = v_actorRotation.y;
  vec3 worldNormal = vec3(mapped.x*c-mapped.z*s,mapped.y,mapped.x*s+mapped.z*c);
  float brightness = clamp(0.5+0.5*dot(worldNormal,u_lightDirection),0.0,1.0);
  float depth = clamp((u_shadowThreshold-brightness)/max(u_shadowThreshold,0.001),0.0,1.0);
  // Derivatives are evaluated before alpha discard and coverage branches, so
  // neighbouring contour/padding pixels cannot leave derivatives undefined.
  float boundaryAA = max(0.0001,0.5*fwidth(brightness));
  float depthAA = max(0.006,0.5*fwidth(depth));
  float hatching = hatchCoverage(depth,depthAA);
  if (ink.a < 0.18) discard;
  vec3 base = ink.rgb;
  // Coverage excludes ink-only contour pixels and transparent atlas padding.
  if (u_lightEnabled && v_relight > 0.5 && normalData.a > 0.18 && actorLength > 0.1) {
    float mask;
    if (u_hatchEnabled) {
      // A thin antialiased shadow boundary clips the strokes. There is no
      // filled grey veil between them: those pixels retain their base color.
      mask = hatching*(1.0-smoothstep(u_shadowThreshold-boundaryAA,u_shadowThreshold+boundaryAA,brightness));
    } else {
      mask = u_shadowSoftness <= 0.00001
        ? (brightness < u_shadowThreshold ? 1.0 : 0.0)
        : 1.0-smoothstep(u_shadowThreshold-u_shadowSoftness,u_shadowThreshold+u_shadowSoftness,brightness);
    }
    // Existing darker contour pixels cannot become lighter when shaded.
    base = mix(base,min(base,u_inkColor),mask*u_shadowStrength);
  }
  outColor = vec4(base * v_tint.rgb,ink.a * v_tint.a);
}
`;

function cameraBasis(camera, pitch) {
  const sy = Math.sin(camera.yaw), cy = Math.cos(camera.yaw);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  return {
    right: [cy,0,sy],
    up: [-sy*sp,cp,cy*sp],
    eye: [sy*cp,sp,-cy*cp],
  };
}

async function textureFromURL(gl,url,{normalData=false}={}) {
  const image = new Image();
  image.decoding = 'async';
  await new Promise((resolve,reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error(`Billedarket kunne ikke indlæses: ${url}`));
    image.src = url;
  });
  if (image.width > gl.getParameter(gl.MAX_TEXTURE_SIZE) || image.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
    throw new Error('Billedarket er større end grafikkortets maksimale teksturstørrelse.');
  }
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  // Normal RGB is data, never color. RGBA8 has no sRGB decoding; disabling
  // browser color conversion also prevents a PNG profile from altering vectors.
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,normalData ? gl.NONE : gl.BROWSER_DEFAULT_WEBGL);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,image);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  return {texture,width:image.width,height:image.height};
}

function overlayTriangle(vertices, a,b,c,color,terrain) {
  const maxEdge = Math.max(Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(b[0]-c[0],b[1]-c[1]),Math.hypot(c[0]-a[0],c[1]-a[1]));
  const n = Math.max(1,Math.ceil(maxEdge/2));
  const point = (i,j) => [a[0] + (b[0]-a[0])*i/n + (c[0]-a[0])*j/n,
    a[1] + (b[1]-a[1])*i/n + (c[1]-a[1])*j/n];
  const push = (p) => vertices.push(p[0],heightAt(terrain,p[0],p[1])+0.065,p[1],...color);
  for (let i=0;i<n;i++) for (let j=0;j<n-i;j++) {
    push(point(i,j)); push(point(i+1,j)); push(point(i,j+1));
    if (i+j<n-1) { push(point(i+1,j));push(point(i+1,j+1));push(point(i,j+1)); }
  }
}

function groundStroke(vertices,a,b,width,color,terrain,dashed=false) {
  const dx = b[0]-a[0], dz = b[1]-a[1], length = Math.hypot(dx,dz);
  if (length < 0.001) return;
  const nx = -dz/length*width/2, nz = dx/length*width/2;
  const n = Math.max(1,Math.ceil(length/1.2));
  const push = p => vertices.push(p[0],heightAt(terrain,p[0],p[1])+0.105,p[1],...color);
  for (let i=0;i<n;i++) {
    if (dashed && i%2) continue;
    const t0=i/n,t1=(i+1)/n;
    const p0=[a[0]+dx*t0-nx,a[1]+dz*t0-nz];
    const p1=[a[0]+dx*t0+nx,a[1]+dz*t0+nz];
    const p2=[a[0]+dx*t1+nx,a[1]+dz*t1+nz];
    const p3=[a[0]+dx*t1-nx,a[1]+dz*t1-nz];
    [p0,p1,p2,p0,p2,p3].forEach(push);
  }
}

function tintFromColor(value) {
  if (Array.isArray(value)) return [value[0]??1,value[1]??1,value[2]??1,1];
  if (typeof value==='string' && /^#[\da-f]{6}$/i.test(value)) {
    return [parseInt(value.slice(1,3),16)/255,parseInt(value.slice(3,5),16)/255,parseInt(value.slice(5,7),16)/255,1];
  }
  return [1,1,1,1];
}

/** Terrain, footprints and sprites share one orthographic 3D camera.
 * Sprite planes retain the render elevation; the simulation has no renderer dependency.
 */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2',{alpha:false,antialias:true,premultipliedAlpha:false});
    if (!this.gl) throw new Error('Formationsstudioet kræver WebGL 2. Aktivér hardwareacceleration i browseren.');
    this.camera = {yaw:25*DEG,zoom:55,centerX:0,centerZ:15};
    this.pitch = 30.05*DEG;
    this.terrain = 'flat';
    this.assets = null;
    this.lighting = normalizeLighting();
    this.lightDirection = lightDirection(this.lighting);
    this.stats = {sprites:0,drawCalls:0,relighting:false};
    const gl = this.gl;
    this.groundProgram = program(gl,groundVertex,groundFragment);
    this.colorProgram = program(gl,colorVertex,colorFragment);
    this.spriteProgram = program(gl,spriteVertex,spriteFragment);
    this.groundBuffer = gl.createBuffer();
    this.groundVAO = gl.createVertexArray();
    gl.bindVertexArray(this.groundVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.groundBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,24,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,24,12);
    this.overlayBuffer=gl.createBuffer();this.overlayVAO=gl.createVertexArray();
    gl.bindVertexArray(this.overlayVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.overlayBuffer);
    gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
    gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,28,12);
    this.spriteBuffer=gl.createBuffer();this.spriteVAO=gl.createVertexArray();
    gl.bindVertexArray(this.spriteVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.spriteBuffer);
    [3,4,4,4,4,1,1].forEach((size,index) => {
      const offsets=[0,3,7,11,15,19,20];
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index,size,gl.FLOAT,false,84,offsets[index]*4);
      gl.vertexAttribDivisor(index,1);
    });
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    this.makeTerrain('flat');
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1,2);
    const width = Math.max(1,Math.round(this.canvas.clientWidth*dpr));
    const height = Math.max(1,Math.round(this.canvas.clientHeight*dpr));
    if (this.canvas.width!==width || this.canvas.height!==height) {
      this.canvas.width=width;this.canvas.height=height;
    }
    this.gl.viewport(0,0,width,height);
  }

  setCamera(patch) {
    for (const key of ['yaw','zoom','centerX','centerZ']) {
      if (Number.isFinite(patch[key])) this.camera[key]=patch[key];
    }
    this.camera.zoom=clamp(this.camera.zoom,10,150);
    this.camera.yaw=mod(this.camera.yaw,TAU);
    this.camera.centerX=clamp(this.camera.centerX,-90,90);
    this.camera.centerZ=clamp(this.camera.centerZ,-90,90);
  }

  async loadAssets(url='assets/character.json') {
    const absolute = new URL(url,document.baseURI);
    const response = await fetch(absolute);
    if (!response.ok) throw new Error('Figurens sprites kunne ikke indlæses.');
    const data = await response.json();
    if (!Number.isFinite(data.pixelsPerUnit) || data.pixelsPerUnit<=0 || !data.clips?.walk || !data.clips?.idle) {
      throw new Error('Figurens sprites mangler animation eller målestok.');
    }
    const gl = this.gl;
    if (data.normalAtlas && (data.normalSpace !== 'actor-blender-world' || data.normalEncoding !== 'RGB8-linear-signed')) {
      throw new Error('Figurens normalkort har et ukendt format.');
    }
    const [body,pike,normal] = await Promise.all([
      textureFromURL(gl,new URL(data.bodyAtlas,absolute)),
      data.pikeAtlas ? textureFromURL(gl,new URL(data.pikeAtlas,absolute)) : Promise.resolve(null),
      data.normalAtlas ? textureFromURL(gl,new URL(data.normalAtlas,absolute),{normalData:true}) : Promise.resolve(null),
    ]);
    if (normal && (normal.width !== body.width || normal.height !== body.height)) {
      [body,pike,normal].filter(Boolean).forEach(item => gl.deleteTexture(item.texture));
      throw new Error('Normalkortets mål passer ikke til figurens billedark.');
    }
    if (this.assets) {
      gl.deleteTexture(this.assets.body.texture);
      if (this.assets.pike) gl.deleteTexture(this.assets.pike.texture);
      if (this.assets.normal) gl.deleteTexture(this.assets.normal.texture);
    }
    this.assets={data,body,pike,normal};
    this.pitch=(data.elevation || 30.05)*DEG;
    return data;
  }

  makeTerrain(name) {
    this.terrain=name;
    const bounds=terrainBounds || {minX:-70,maxX:70,minZ:-70,maxZ:70};
    const positions=[];
    const step=2;
    const push = (x,z) => {
      const h=heightAt(name,x,z);
      const dx=(heightAt(name,x+0.2,z)-heightAt(name,x-0.2,z))/0.4;
      const dz=(heightAt(name,x,z+0.2)-heightAt(name,x,z-0.2))/0.4;
      const length=Math.hypot(dx,1,dz);
      positions.push(x,h,z,-dx/length,1/length,-dz/length);
    };
    for (let z=bounds.minZ;z<bounds.maxZ;z+=step) for(let x=bounds.minX;x<bounds.maxX;x+=step) {
      const x1=Math.min(x+step,bounds.maxX),z1=Math.min(z+step,bounds.maxZ);
      push(x,z);push(x1,z);push(x1,z1);push(x,z);push(x1,z1);push(x,z1);
    }
    this.groundCount=positions.length/6;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.groundBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER,new Float32Array(positions),this.gl.STATIC_DRAW);
  }

  bindCamera(p) {
    const gl=this.gl,basis=cameraBasis(this.camera,this.pitch);
    const center=[this.camera.centerX,heightAt(this.terrain,this.camera.centerX,this.camera.centerZ),this.camera.centerZ];
    gl.useProgram(p);
    gl.uniform3fv(gl.getUniformLocation(p,'u_center'),center);
    gl.uniform3fv(gl.getUniformLocation(p,'u_right'),basis.right);
    gl.uniform3fv(gl.getUniformLocation(p,'u_up'),basis.up);
    gl.uniform3fv(gl.getUniformLocation(p,'u_eyeDirection'),basis.eye);
    gl.uniform2f(gl.getUniformLocation(p,'u_scale'),2/(this.camera.zoom*this.canvas.width/this.canvas.height),2/this.camera.zoom);
  }

  drawOverlays(snapshot,options) {
    const vertices=[],terrain=this.terrain;
    for (const formation of snapshot.formations || []) {
      const selected=formation.id===options.selectedId;
      if (options.showFields!==false) for(const field of formation.fields || []) {
        const polygon=field.polygon;
        if (!polygon || polygon.length<3) continue;
        const shot=field.role==='shot';
        const fill=shot ? [0.57,0.36,0.20,selected?0.23:0.16] : [0.26,0.36,0.27,selected?0.25:0.17];
        for(let i=1;i<polygon.length-1;i++) overlayTriangle(vertices,polygon[0],polygon[i],polygon[i+1],fill,terrain);
        const edge=selected ? [0.19,0.15,0.08,0.95] : [0.31,0.29,0.23,0.72];
        for(let i=0;i<polygon.length;i++) groundStroke(vertices,polygon[i],polygon[(i+1)%polygon.length],selected?0.15:0.08,edge,terrain);
      }
      if (options.showTargets!==false) for(const field of formation.targetFields || []) {
        const polygon=field.polygon;
        if (!polygon || polygon.length<3) continue;
        const color=selected ? [0.20,0.36,0.37,0.8] : [0.27,0.38,0.39,0.36];
        for(let i=0;i<polygon.length;i++) groundStroke(vertices,polygon[i],polygon[(i+1)%polygon.length],selected?0.12:0.07,color,terrain,true);
      }
      if (selected) {
        const x=formation.x,z=formation.z,h=formation.heading||0;
        const forward=[Math.sin(h),-Math.cos(h)],right=[Math.cos(h),Math.sin(h)];
        const center=[x,z];
        let frontEdge=0;
        for (const field of formation.fields || []) for (const vertex of field.polygon || []) {
          frontEdge=Math.max(frontEdge,(vertex[0]-x)*forward[0]+(vertex[1]-z)*forward[1]);
        }
        const start=[x+forward[0]*(frontEdge+0.5),z+forward[1]*(frontEdge+0.5)];
        const tip=[start[0]+forward[0]*3.0,start[1]+forward[1]*3.0];
        const color=[0.15,0.20,0.20,0.9];
        groundStroke(vertices,start,tip,0.14,color,terrain);
        groundStroke(vertices,tip,[tip[0]-forward[0]*1.2+right[0]*0.7,tip[1]-forward[1]*1.2+right[1]*0.7],0.14,color,terrain);
        groundStroke(vertices,tip,[tip[0]-forward[0]*1.2-right[0]*0.7,tip[1]-forward[1]*1.2-right[1]*0.7],0.14,color,terrain);
        if (formation.target && Number.isFinite(formation.target.x) && Number.isFinite(formation.target.z) &&
          Math.hypot(formation.target.x-x,formation.target.z-z)>0.7) {
          groundStroke(vertices,center,[formation.target.x,formation.target.z],0.10,[0.18,0.30,0.30,0.50],terrain,true);
        }
      }
    }
    if (!vertices.length) return;
    const gl=this.gl;
    this.bindCamera(this.colorProgram);
    gl.bindVertexArray(this.overlayVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.overlayBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
    gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,vertices.length/7);gl.depthMask(true);
    this.stats.drawCalls++;
  }

  spriteInstances(snapshot,options) {
    const body=[],pikes=[],assets=this.assets,data=assets.data,ppu=data.pixelsPerUnit;
    const tint=tintFromColor(options.inkColor);
    const add = (array,texture,frame,part,world,heading,relight) => {
      const rect=part.rect,pivot=frame.body.pivot;
      if (!rect || !pivot || !texture) return;
      let corners;
      if (part.corners) corners=part.corners.map(p => [(p[0]-pivot[0])/ppu,(pivot[1]-p[1])/ppu]);
      else corners=[[-pivot[0]/ppu,pivot[1]/ppu],[(rect[2]-pivot[0])/ppu,pivot[1]/ppu],
        [(rect[2]-pivot[0])/ppu,(pivot[1]-rect[3])/ppu],[-pivot[0]/ppu,(pivot[1]-rect[3])/ppu]];
      array.push(...world,rect[0]/texture.width,rect[1]/texture.height,rect[2]/texture.width,rect[3]/texture.height,
        ...corners[0],...corners[1],...corners[2],...corners[3],...tint,heading,relight);
    };
    const time=Number.isFinite(snapshot.time)?snapshot.time:0;
    for (const soldier of snapshot.soldiers || []) {
      if (!Number.isFinite(soldier.x) || !Number.isFinite(soldier.z)) continue;
      const clip=soldier.moving ? data.clips.walk : data.clips.idle;
      const n=clip.directions.length;
      const relative=(this.camera.yaw-(soldier.heading || 0))/DEG;
      const direction=mod(Math.round((relative-(data.firstAzimuth || 0))/(data.azimuthStep || 360/n)),n);
      const frames=clip.directions[direction];
      if (!frames?.length) continue;
      const phase=Number.isFinite(soldier.phase)?soldier.phase:0;
      const index=mod(Math.floor((time/clip.duration+phase)*frames.length),frames.length);
      const frame=frames[index];
      if (!frame?.body) continue;
      const world=[soldier.x,heightAt(this.terrain,soldier.x,soldier.z)+0.04,soldier.z];
      add(body,assets.body,frame,frame.body,world,soldier.heading || 0,assets.normal ? 1 : 0);
      if(options.showPikes!==false && soldier.role!=='shot' && frame.pike && assets.pike) add(pikes,assets.pike,frame,frame.pike,world,soldier.heading || 0,0);
    }
    return {body,pikes};
  }

  drawSpriteBatch(values,texture) {
    if (!values.length) return;
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture.texture);
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_texture'),0);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,values.length/21);
    this.stats.drawCalls++;
  }

  draw(snapshot,options={}) {
    this.resize();
    const terrain=snapshot.terrain || 'flat';
    if (terrain!==this.terrain) this.makeTerrain(terrain);
    const gl=this.gl;
    this.lighting = normalizeLighting(options.lighting ?? this.assets?.data.lighting);
    this.lightDirection = lightDirection(this.lighting);
    this.stats={sprites:0,drawCalls:0,relighting:!!(this.assets?.normal && this.lighting.enabled),lightDirection:[...this.lightDirection]};
    gl.clearColor(0.86,0.83,0.72,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.depthMask(true);this.bindCamera(this.groundProgram);gl.bindVertexArray(this.groundVAO);
    gl.uniform3fv(gl.getUniformLocation(this.groundProgram,'u_lightDirection'),this.lightDirection);
    gl.uniform1i(gl.getUniformLocation(this.groundProgram,'u_lightEnabled'),this.lighting.enabled);
    gl.drawArrays(gl.TRIANGLES,0,this.groundCount);this.stats.drawCalls++;
    this.drawOverlays(snapshot,options);
    if (this.assets && options.showSoldiers!==false) {
      const instances=this.spriteInstances(snapshot,options);
      this.bindCamera(this.spriteProgram);gl.bindVertexArray(this.spriteVAO);
      gl.uniform3fv(gl.getUniformLocation(this.spriteProgram,'u_lightDirection'),this.lightDirection);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_lightEnabled'),this.lighting.enabled);
      gl.uniform3fv(gl.getUniformLocation(this.spriteProgram,'u_inkColor'),tintFromColor(this.lighting.inkColor).slice(0,3));
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_shadowStrength'),this.lighting.strength);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_shadowThreshold'),this.lighting.threshold);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_shadowSoftness'),this.lighting.softness);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_hatchEnabled'),this.lighting.style==='hatch');
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_hatchSpacing'),this.lighting.hatchSpacing);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_hatchWidth'),this.lighting.hatchWidth);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_hatchAngle'),this.lighting.hatchAngle*DEG);
      gl.uniform1f(gl.getUniformLocation(this.spriteProgram,'u_crossStart'),this.lighting.crossStart);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,(this.assets.normal || this.assets.body).texture);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_normals'),1);
      this.drawSpriteBatch(instances.body,this.assets.body);
      if (this.assets.pike) this.drawSpriteBatch(instances.pikes,this.assets.pike);
      this.stats.sprites=instances.body.length/21;
    }
    gl.bindVertexArray(null);
  }

  screenToGround(cssX,cssY) {
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    if(!width || !height) return null;
    const basis=cameraBasis(this.camera,this.pitch);
    const sx=(cssX/width-0.5)*this.camera.zoom*width/height;
    const sy=(0.5-cssY/height)*this.camera.zoom;
    const center=[this.camera.centerX,heightAt(this.terrain,this.camera.centerX,this.camera.centerZ),this.camera.centerZ];
    const origin=center.map((v,i) => v+basis.right[i]*sx+basis.up[i]*sy+basis.eye[i]*210);
    const point=t => origin.map((v,i) => v-basis.eye[i]*t);
    const difference=t => {const p=point(t);return p[1]-heightAt(this.terrain,p[0],p[2]);};
    let prior=0,previous=difference(0);
    for(let t=2;t<=430;t+=2) {
      const next=difference(t);
      if(previous>=0 && next<=0) {
        let lo=prior,hi=t;
        for(let j=0;j<18;j++) {const mid=(lo+hi)/2;if(difference(mid)>0)lo=mid;else hi=mid;}
        const p=point((lo+hi)/2),b=terrainBounds;
        if(b && (p[0]<b.minX || p[0]>b.maxX || p[2]<b.minZ || p[2]>b.maxZ)) return null;
        return {x:p[0],z:p[2]};
      }
      prior=t;previous=next;
    }
    return null;
  }

  destroy() {
    const gl=this.gl;
    [this.groundBuffer,this.overlayBuffer,this.spriteBuffer].forEach(b=>gl.deleteBuffer(b));
    [this.groundVAO,this.overlayVAO,this.spriteVAO].forEach(v=>gl.deleteVertexArray(v));
    [this.groundProgram,this.colorProgram,this.spriteProgram].forEach(p=>gl.deleteProgram(p));
    if(this.assets) {gl.deleteTexture(this.assets.body.texture);if(this.assets.pike)gl.deleteTexture(this.assets.pike.texture);if(this.assets.normal)gl.deleteTexture(this.assets.normal.texture);}
  }
}
