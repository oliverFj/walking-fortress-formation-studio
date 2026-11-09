import { heightAt, terrainBounds } from './terrain.mjs';
import { normalizeLighting, lightDirection } from './lighting.mjs';
import { animationClips, soldierAnimation } from './animation.mjs';
import { normalizePikeAppearance, scalePikeCorners } from './pike-appearance.mjs';

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
uniform vec2 u_viewport;
uniform vec2 u_spriteAtlasSize;
out vec2 v_uv;
flat out vec4 v_uvRect;
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
  vec2 edgeU = a_corner01.zw-a_corner01.xy;
  vec2 edgeV = a_corner23.zw-a_corner01.xy;
  float determinant = edgeU.x*edgeV.y-edgeU.y*edgeV.x;
  if (abs(determinant) > 0.000001) {
    vec2 worldPixel = 2.0/(u_scale*u_viewport);
    vec2 dx = vec2(edgeV.y,-edgeU.y)*worldPixel.x/determinant;
    vec2 dy = vec2(-edgeV.x,edgeU.x)*worldPixel.y/determinant;
    vec2 sourceSize = a_uvRect.zw*u_spriteAtlasSize;
    float minification = max(length(dx*sourceSize),length(dy*sourceSize));
    // A subpixel strip must rasterize its neighbours too, or MSAA can miss
    // the entire pike. Extended UVs keep the same ink area/axis/physical width.
    vec2 margin = 0.5*(abs(dx)+abs(dy))*smoothstep(1.0,2.0,minification);
    uv = mix(-margin,vec2(1.0)+margin,uv);
    p = a_corner01.xy + edgeU*uv.x + edgeV*uv.y;
  }
  v_uv = a_uvRect.xy + uv * a_uvRect.zw;
  v_uvRect = a_uvRect;
  // The pattern belongs to the billboard, anchored at the feet. It stays put
  // when the camera pans, rather than sliding across a screen-space mask.
  v_hatchCoord = p;
  v_tint = a_tint;
  v_actorRotation = vec2(cos(a_heading),sin(a_heading));
  v_relight = a_relight;
  gl_Position = project(a_world + u_right * p.x + u_up * p.y);
}
`;
const hatchFunctions = `
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
float hatchCoverage(vec2 hatchCoord, float depth, float depthAA) {
  vec2 direction = vec2(-sin(u_hatchAngle),cos(u_hatchAngle));
  float primaryCoord = dot(hatchCoord,direction);
  float crossCoord = dot(hatchCoord,vec2(direction.y,-direction.x));
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
uniform float u_pikeOpacity;
in vec2 v_uv;
flat in vec4 v_uvRect;
in vec2 v_hatchCoord;
in vec4 v_tint;
flat in vec2 v_actorRotation;
flat in float v_relight;
out vec4 outColor;

// Filter each frame independently: ordinary atlas mipmaps would mix adjacent
// poses. Samples cover a screen pixel, not just one point in the source image.
vec4 frameSample(sampler2D atlas, vec2 uv, vec2 size) {
  vec2 low = v_uvRect.xy, high = low + v_uvRect.zw;
  vec2 edge = clamp(min((uv-low)*size+0.5,(high-uv)*size+0.5),0.0,1.0);
  vec4 sampleValue = textureLod(atlas,clamp(uv,low+0.5/size,high-0.5/size),0.0);
  sampleValue.a *= edge.x*edge.y;
  return sampleValue;
}
void spriteSample(vec2 dx, vec2 dy, float minification, out vec4 ink, out vec4 normalData) {
  vec2 size = vec2(textureSize(u_texture,0));
  ink = minification <= 1.0 ? texture(u_texture,v_uv) : frameSample(u_texture,v_uv,size);
  bool relight = u_lightEnabled && v_relight > 0.5;
  normalData = vec4(0.5,0.5,1.0,0.0);
  if (relight) normalData = minification <= 1.0 ? texture(u_normals,v_uv) : frameSample(u_normals,v_uv,size);
  if (minification <= 1.0) return;
  // At most eight taps per screen axis; one tap on an unminified axis also
  // keeps long, narrow pikes inexpensive. Color/normal sums are alpha-weighted.
  ivec2 taps = ivec2(clamp(ceil(vec2(length(dx*size),length(dy*size))),vec2(1.0),vec2(8.0)));
  vec4 colorSum = vec4(0.0), normalSum = vec4(0.0);
  for (int y=0;y<8;y++) {
    if (y >= taps.y) break;
    for (int x=0;x<8;x++) {
      if (x >= taps.x) break;
      vec2 offset = (vec2(float(x)+0.5,float(y)+0.5)/vec2(taps)-0.5);
      vec2 uv = v_uv + dx*offset.x + dy*offset.y;
      vec4 color = frameSample(u_texture,uv,size);
      colorSum += vec4(color.rgb*color.a,color.a);
      if (relight) {
        vec4 normal = frameSample(u_normals,uv,size);
        normalSum += vec4(normal.rgb*normal.a,normal.a);
      }
    }
  }
  float count = float(taps.x*taps.y);
  vec4 filtered = vec4(colorSum.rgb/max(colorSum.a,0.00001),colorSum.a/count);
  vec4 filteredNormal = vec4(normalSum.rgb/max(normalSum.a,0.00001),normalSum.a/count);
  // The transition leaves the original close-up sampling intact.
  float amount = smoothstep(1.0,2.0,minification);
  float alpha = mix(ink.a,filtered.a,amount);
  ink = vec4(mix(ink.rgb*ink.a,filtered.rgb*filtered.a,amount)/max(alpha,0.00001),alpha);
  normalData = mix(normalData,filteredNormal,amount);
}
${hatchFunctions}
void main() {
  vec2 dx = dFdx(v_uv), dy = dFdy(v_uv);
  vec2 size = vec2(textureSize(u_texture,0));
  float minification = max(length(dx*size),length(dy*size));
  vec4 ink, normalData;
  spriteSample(dx,dy,minification,ink,normalData);
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
  float hatching = hatchCoverage(v_hatchCoord,depth,depthAA);
  // Preserve fractional coverage of subpixel ink instead of blinking it off.
  float distanceFilter = smoothstep(1.0,2.0,minification);
  if (ink.a < mix(0.18,0.001,distanceFilter)) discard;
  vec3 base = ink.rgb;
  // Coverage excludes ink-only contour pixels and transparent atlas padding.
  if (u_lightEnabled && v_relight > 0.5 && normalData.a > mix(0.18,0.001,distanceFilter) && actorLength > 0.1) {
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
    float normalCoverage = mix(1.0,clamp(normalData.a/max(ink.a,0.00001),0.0,1.0),distanceFilter);
    base = mix(base,min(base,u_inkColor),mask*u_shadowStrength*normalCoverage);
  }
  outColor = vec4(base * v_tint.rgb,clamp(ink.a * v_tint.a * u_pikeOpacity,0.0,1.0));
}
`;

// Small contact ellipses share the exact filtered strokes used on the bodies.
// The local meter coordinates turn with the soldier, never with the camera.
const contactShadowVertex = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_worldXZ;
layout(location=1) in vec4 a_heights;
layout(location=2) in float a_heading;
${cameraUniforms}
out vec2 v_hatchCoord;
out vec2 v_shadowCoord;
void main() {
  int corner = gl_VertexID == 0 || gl_VertexID == 3 ? 0 :
    gl_VertexID == 1 ? 1 : gl_VertexID == 2 || gl_VertexID == 4 ? 2 : 3;
  vec2 uv = corner == 0 ? vec2(-1.,-1.) : corner == 1 ? vec2(1.,-1.) :
    corner == 2 ? vec2(1.,1.) : vec2(-1.,1.);
  vec2 local = uv * vec2(.65,.45);
  float c=cos(a_heading),s=sin(a_heading);
  vec2 worldXZ = a_worldXZ + vec2(local.x*c-local.y*s,local.x*s+local.y*c);
  float y = corner == 0 ? a_heights.x : corner == 1 ? a_heights.y : corner == 2 ? a_heights.z : a_heights.w;
  v_hatchCoord = local;
  v_shadowCoord = uv;
  gl_Position = project(vec3(worldXZ.x,y,worldXZ.y));
}
`;
const contactShadowFragment = `#version 300 es
precision highp float;
uniform vec3 u_inkColor;
uniform float u_shadowStrength;
uniform float u_shadowThreshold;
uniform float u_shadowSoftness;
uniform bool u_hatchEnabled;
uniform float u_hatchSpacing;
uniform float u_hatchWidth;
uniform float u_hatchAngle;
uniform float u_crossStart;
in vec2 v_hatchCoord;
in vec2 v_shadowCoord;
out vec4 outColor;
${hatchFunctions}
void main() {
  float brightness = length(v_shadowCoord)*.5;
  float depth = clamp((u_shadowThreshold-brightness)/max(u_shadowThreshold,.001),0.,1.);
  float boundaryAA = max(.0001,.5*fwidth(brightness));
  float depthAA = max(.006,.5*fwidth(depth));
  float hatching = hatchCoverage(v_hatchCoord,depth,depthAA);
  float boundary = u_hatchEnabled || u_shadowSoftness <= .00001
    ? 1.-smoothstep(u_shadowThreshold-boundaryAA,u_shadowThreshold+boundaryAA,brightness)
    : 1.-smoothstep(u_shadowThreshold-u_shadowSoftness,u_shadowThreshold+u_shadowSoftness,brightness);
  float alpha = boundary*u_shadowStrength*(u_hatchEnabled ? hatching : 1.);
  if (alpha < .001) discard;
  outColor = vec4(u_inkColor,alpha);
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
    this.contactShadowProgram = program(gl,contactShadowVertex,contactShadowFragment);
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
    this.contactShadowBuffer=gl.createBuffer();this.contactShadowVAO=gl.createVertexArray();
    gl.bindVertexArray(this.contactShadowVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.contactShadowBuffer);
    [2,4,1].forEach((size,index) => {
      const offsets=[0,2,6];
      gl.enableVertexAttribArray(index);
      gl.vertexAttribPointer(index,size,gl.FLOAT,false,28,offsets[index]*4);
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

  async loadAssets(url='assets/characters.json') {
    const absolute = new URL(url,document.baseURI);
    const response = await fetch(absolute);
    if (!response.ok) throw new Error('Figurens sprites kunne ikke indlæses.');
    const data = await response.json();
    let assets;
    if (data.schema === 'walking-fortress-characters-v1') {
      const entries = Object.entries(data.characters || {});
      if (!entries.length || !Object.hasOwn(data.characters, data.defaultCharacter) ||
        !['pike', 'shot'].every(role => Object.hasOwn(data.characters, data.roles?.[role]))) {
        throw new Error('Figurlisten mangler pikener, musketer eller standardfigur.');
      }
      const loaded = await Promise.allSettled(entries.map(async ([id, entry]) => {
        if (!entry?.manifest) throw new Error(`Figuren ${id} mangler et sprite-manifest.`);
        const manifest = new URL(entry.manifest, absolute);
        const source = await fetch(manifest);
        if (!source.ok) throw new Error(`Figuren ${id} kunne ikke indlæses.`);
        const metadata=await source.json();
        if (entry.pikeAppearance) metadata.pikeAppearance=normalizePikeAppearance(entry.pikeAppearance);
        return [id, await this.loadCharacter(metadata, manifest)];
      }));
      const failed = loaded.find(result => result.status === 'rejected');
      if (failed) {
        for (const result of loaded) if (result.status === 'fulfilled') this.deleteCharacter(result.value[1]);
        throw failed.reason;
      }
      const characters = new Map(loaded.map(result => result.value));
      assets = {...characters.get(data.defaultCharacter), characters, roles: data.roles, registry: data};
    } else assets = await this.loadCharacter(data, absolute);
    this.deleteAssets();
    this.assets = assets;
    this.pitch = (assets.data.elevation || 30.05) * DEG;
    return assets.data;
  }

  async loadCharacter(data, absolute) {
    data={...data,pikeAppearance:normalizePikeAppearance(data.pikeAppearance)};
    if (!Number.isFinite(data.pixelsPerUnit) || data.pixelsPerUnit<=0 ||
      !animationClips(data, 'walk').length || !animationClips(data, 'idle').length) {
      throw new Error('Figurens sprites mangler animation eller målestok.');
    }
    const descriptors = data.pages ?? [data];
    if (!Array.isArray(descriptors) || !descriptors.length || descriptors.some(page => !page?.bodyAtlas)) {
      throw new Error('Figurens billedsider mangler et kropsatlas.');
    }
    if (descriptors.some(page => page.normalAtlas) &&
      (data.normalSpace !== 'actor-blender-world' || data.normalEncoding !== 'RGB8-linear-signed')) {
      throw new Error('Figurens normalkort har et ukendt format.');
    }
    for (const clip of Object.values(data.clips || {})) for (const direction of clip.directions || []) for (const frame of direction) {
      const page = frame.page ?? 0;
      if (!Number.isInteger(page) || page < 0 || page >= descriptors.length) {
        throw new Error('Et animationsbillede henviser til en ukendt billedside.');
      }
    }
    const results = await Promise.allSettled(descriptors.map(page => this.loadCharacterPage(data, absolute, page)));
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      for (const result of results) if (result.status === 'fulfilled') this.deleteCharacter(result.value);
      throw failed.reason;
    }
    const pages = results.map(result => result.value);
    return data.pages ? {...pages[0], pages} : pages[0];
  }

  async loadCharacterPage(data, absolute, page) {
    const gl = this.gl;
    const results = await Promise.allSettled([
      textureFromURL(gl,new URL(page.bodyAtlas,absolute)),
      page.pikeAtlas ? textureFromURL(gl,new URL(page.pikeAtlas,absolute)) : Promise.resolve(null),
      page.normalAtlas ? textureFromURL(gl,new URL(page.normalAtlas,absolute),{normalData:true}) : Promise.resolve(null),
    ]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) {
      for (const result of results) if (result.status === 'fulfilled' && result.value) gl.deleteTexture(result.value.texture);
      throw failed.reason;
    }
    const [body,pike,normal] = results.map(result => result.value);
    if (normal && (normal.width !== body.width || normal.height !== body.height)) {
      [body,pike,normal].filter(Boolean).forEach(item => gl.deleteTexture(item.texture));
      throw new Error('Normalkortets mål passer ikke til figurens billedark.');
    }
    return {data,body,pike,normal};
  }

  deleteCharacter(assets) {
    for (const page of assets.pages || [assets]) {
      for (const part of ['body', 'pike', 'normal']) if (page[part]) this.gl.deleteTexture(page[part].texture);
    }
  }

  deleteAssets() {
    if (!this.assets) return;
    for (const assets of this.assets.characters?.values() || [this.assets]) this.deleteCharacter(assets);
    this.assets = null;
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

  worldToScreen(x,z) {
    const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
    if (!width || !height || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    const basis=cameraBasis(this.camera,this.pitch);
    const p=[x-this.camera.centerX,heightAt(this.terrain,x,z)-heightAt(this.terrain,this.camera.centerX,this.camera.centerZ),z-this.camera.centerZ];
    const dot=axis=>p.reduce((sum,value,i)=>sum+value*axis[i],0);
    return {x:width*.5+dot(basis.right)*height/this.camera.zoom,y:height*.5-dot(basis.up)*height/this.camera.zoom};
  }

  waypointHandles(snapshot,selectedId) {
    const formation=(snapshot.formations || []).find(item=>item.id===selectedId);
    if (!formation) return [];
    const result=[];
    for (const waypoint of formation.waypoints || []) for (const [cornerIndex,world] of (waypoint.corners || []).entries()) {
      if (!Array.isArray(world) || !world.every(Number.isFinite)) continue;
      const screen=this.worldToScreen(...world);
      if (screen) result.push({formationId:formation.id,waypointId:waypoint.id,cornerIndex,world:[...world],screen});
    }
    return result;
  }

  drawOverlays(snapshot,options) {
    const vertices=[],handles=[],terrain=this.terrain;
    const basis=cameraBasis(this.camera,this.pitch);
    const handleRadius=6*this.camera.zoom/Math.max(1,this.canvas.clientHeight);
    const handle=(world,active)=>{
      // Camera-facing handles keep a useful 12 CSS pixel size at any zoom.
      const center=[world[0],heightAt(terrain,...world)+.105,world[1]];
      const point=(x,y)=>center.map((value,i)=>value+basis.right[i]*x+basis.up[i]*y);
      const quad=(radius,color)=>{
        const p=[point(-radius,-radius),point(radius,-radius),point(radius,radius),point(-radius,radius)];
        for (const i of [0,1,2,0,2,3]) handles.push(...p[i],...color);
      };
      quad(handleRadius,[.12,.25,.27,active?1:.85]);
      quad(handleRadius*.64,[.95,.94,.83,1]);
    };
    const digits=['111101101101111','010110010010111','111001111100111','111001111001111','101101111001001',
      '111100111001111','111100111101111','111001001001001','111101111101111','111101111001111'];
    const number=(world,value)=>{
      const text=String(value),pixel=2*this.camera.zoom/Math.max(1,this.canvas.clientHeight);
      const center=[world[0],heightAt(terrain,...world)+.105,world[1]];
      const point=(x,y)=>center.map((v,i)=>v+basis.right[i]*x+basis.up[i]*y);
      const quad=(x0,y0,x1,y1,color)=>{
        const p=[point(x0,y0),point(x1,y0),point(x1,y1),point(x0,y1)];
        for (const i of [0,1,2,0,2,3]) handles.push(...p[i],...color);
      };
      const half=(text.length*4-1)*pixel/2;
      quad(-half-pixel,-3.5*pixel,half+pixel,3.5*pixel,[.95,.94,.83,.92]);
      for (const [digitIndex,digit] of [...text].entries()) for (let i=0;i<15;i++) if(digits[Number(digit)][i]==='1') {
        const x=-half+(digitIndex*4+i%3)*pixel,y=(1.5-Math.floor(i/3))*pixel;
        quad(x,y,x+pixel,y+pixel,[.12,.25,.27,1]);
      }
    };
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
      const waypoints=selected ? formation.waypoints || [] : [];
      if (options.showTargets!==false) {
        const previews=waypoints.length ? waypoints : [{fields:formation.targetFields || []}];
        let previous=[formation.x,formation.z];
        for (const [waypointIndex,waypoint] of previews.entries()) {
          const active=waypoint.active===true;
          const color=selected ? [.16,.34,.36,active?.95:.72] : [.27,.38,.39,.36];
          for (const field of waypoint.fields || []) {
            const polygon=field.polygon;
            if (!polygon || polygon.length<3) continue;
            if (selected && waypoints.length) for(let i=1;i<polygon.length-1;i++) overlayTriangle(vertices,polygon[0],polygon[i],polygon[i+1],[.22,.43,.43,active?.09:.045],terrain);
            for(let i=0;i<polygon.length;i++) groundStroke(vertices,polygon[i],polygon[(i+1)%polygon.length],selected?(active?.14:.10):.07,color,terrain,true);
          }
          if (waypoints.length && Number.isFinite(waypoint.x) && Number.isFinite(waypoint.z)) {
            const center=[waypoint.x,waypoint.z],h=waypoint.heading || 0;
            groundStroke(vertices,previous,center,.10,[.16,.34,.36,.58],terrain,true);
            const forward=[Math.sin(h),-Math.cos(h)],right=[Math.cos(h),Math.sin(h)];
            let frontEdge=0;
            for (const corner of waypoint.corners || []) frontEdge=Math.max(frontEdge,(corner[0]-center[0])*forward[0]+(corner[1]-center[1])*forward[1]);
            const start=center.map((value,i)=>value+forward[i]*(frontEdge+.45));
            const tip=start.map((value,i)=>value+forward[i]*2.1);
            groundStroke(vertices,start,tip,.13,color,terrain);
            for (const sign of [-1,1]) groundStroke(vertices,tip,tip.map((value,i)=>value-forward[i]*.8+right[i]*.5*sign),.13,color,terrain);
            for (const corner of waypoint.corners || []) handle(corner,active);
            number(center,waypointIndex+1);
            previous=center;
          }
        }
      }
      if (selected) {
        if (options.showFields!==false && Array.isArray(formation.anchor) && formation.anchor.every(Number.isFinite)) {
          const [ax,az]=formation.anchor,color=[0.48,0.24,0.10,0.95];
          for(let i=0;i<16;i++) {
            const a=i*Math.PI/8,b=(i+1)*Math.PI/8;
            groundStroke(vertices,[ax+Math.cos(a)*.65,az+Math.sin(a)*.65],[ax+Math.cos(b)*.65,az+Math.sin(b)*.65],.12,color,terrain);
          }
          groundStroke(vertices,[ax-.9,az],[ax+.9,az],.12,color,terrain);
          groundStroke(vertices,[ax,az-.9],[ax,az+.9],.12,color,terrain);
        }
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
        if (options.showTargets!==false && !waypoints.length && formation.target && Number.isFinite(formation.target.x) && Number.isFinite(formation.target.z) &&
          Math.hypot(formation.target.x-x,formation.target.z-z)>0.7) {
          groundStroke(vertices,center,[formation.target.x,formation.target.z],0.10,[0.18,0.30,0.30,0.50],terrain,true);
        }
      }
    }
    if (!vertices.length && !handles.length) return;
    const gl=this.gl;
    this.bindCamera(this.colorProgram);
    gl.bindVertexArray(this.overlayVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.overlayBuffer);
    gl.depthMask(false);
    if (vertices.length) {
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES,0,vertices.length/7);this.stats.drawCalls++;
    }
    if (handles.length) {
      // Their lower edge can sit below the terrain plane: treat handles as UI.
      gl.disable(gl.DEPTH_TEST);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(handles),gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES,0,handles.length/7);this.stats.drawCalls++;
      gl.enable(gl.DEPTH_TEST);
    }
    gl.depthMask(true);
  }

  spriteInstances(snapshot,options) {
    const batches=new Map();
    const tint=tintFromColor(options.inkColor);
    const add = (array,texture,frame,part,world,heading,relight,ppu,appearance=null) => {
      const rect=part.rect,pivot=frame.body.pivot;
      if (!rect || !pivot || !texture) return;
      let corners;
      if (part.corners) corners=part.corners.map(p => [(p[0]-pivot[0])/ppu,(pivot[1]-p[1])/ppu]);
      else corners=[[-pivot[0]/ppu,pivot[1]/ppu],[(rect[2]-pivot[0])/ppu,pivot[1]/ppu],
        [(rect[2]-pivot[0])/ppu,(pivot[1]-rect[3])/ppu],[-pivot[0]/ppu,(pivot[1]-rect[3])/ppu]];
      const appearanceTint=appearance ? tint.map((value,index)=>index<3 ? value*(1-appearance.darkness) : value) : tint;
      if (appearance && appearance.widthScale!==1) corners=scalePikeCorners(corners,appearance.widthScale);
      array.push(...world,rect[0]/texture.width,rect[1]/texture.height,rect[2]/texture.width,rect[3]/texture.height,
        ...corners[0],...corners[1],...corners[2],...corners[3],...appearanceTint,heading,relight);
    };
    const time=Number.isFinite(snapshot.time)?snapshot.time:0;
    for (const soldier of snapshot.soldiers || []) {
      if (!Number.isFinite(soldier.x) || !Number.isFinite(soldier.z)) continue;
      const characterId=soldier.characterId || this.assets.roles?.[soldier.role];
      const assets=this.assets.characters?.get(characterId) || this.assets;
      const data=assets.data,ppu=data.pixelsPerUnit;
      const animation=soldierAnimation(data,soldier,time);
      if (!animation) continue;
      const clip=animation.clip;
      const n=clip.directions.length;
      const relative=(this.camera.yaw-(soldier.heading || 0))/DEG;
      const direction=mod(Math.round((relative-(data.firstAzimuth || 0))/(data.azimuthStep || 360/n)),n);
      const frames=clip.directions[direction];
      if (!frames?.length) continue;
      const index=Math.min(frames.length-1,Math.floor(animation.phase*frames.length));
      const frame=frames[index];
      if (!frame?.body) continue;
      const page=assets.pages?.[frame.page ?? 0] || assets;
      if (!batches.has(page)) batches.set(page,{assets:page,pikeAppearance:normalizePikeAppearance(data.pikeAppearance),body:[],pikes:[]});
      const batch=batches.get(page);
      const world=[soldier.x,heightAt(this.terrain,soldier.x,soldier.z)+0.04,soldier.z];
      add(batch.body,page.body,frame,frame.body,world,soldier.heading || 0,page.normal ? 1 : 0,ppu);
      if(options.showPikes!==false && batch.pikeAppearance.opacity>0 && soldier.role!=='shot' && frame.pike && page.pike) add(batch.pikes,page.pike,frame,frame.pike,world,soldier.heading || 0,0,ppu,batch.pikeAppearance);
    }
    const result=[...batches.values()];
    return {body:result.flatMap(batch=>batch.body),pikes:result.flatMap(batch=>batch.pikes),batches:result};
  }

  drawSpriteBatch(values,texture) {
    if (!values.length) return;
    const gl=this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER,this.spriteBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture.texture);
    gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_texture'),0);
    gl.uniform2f(gl.getUniformLocation(this.spriteProgram,'u_spriteAtlasSize'),texture.width,texture.height);
    gl.uniform2f(gl.getUniformLocation(this.spriteProgram,'u_viewport'),this.canvas.width,this.canvas.height);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,values.length/21);
    this.stats.drawCalls++;
  }

  bindShadowStyle(p) {
    const gl=this.gl;
    gl.uniform3fv(gl.getUniformLocation(p,'u_inkColor'),tintFromColor(this.lighting.inkColor).slice(0,3));
    gl.uniform1f(gl.getUniformLocation(p,'u_shadowStrength'),this.lighting.strength);
    gl.uniform1f(gl.getUniformLocation(p,'u_shadowThreshold'),this.lighting.threshold);
    gl.uniform1f(gl.getUniformLocation(p,'u_shadowSoftness'),this.lighting.softness);
    gl.uniform1i(gl.getUniformLocation(p,'u_hatchEnabled'),this.lighting.style==='hatch');
    gl.uniform1f(gl.getUniformLocation(p,'u_hatchSpacing'),this.lighting.hatchSpacing);
    gl.uniform1f(gl.getUniformLocation(p,'u_hatchWidth'),this.lighting.hatchWidth);
    gl.uniform1f(gl.getUniformLocation(p,'u_hatchAngle'),this.lighting.hatchAngle*DEG);
    gl.uniform1f(gl.getUniformLocation(p,'u_crossStart'),this.lighting.crossStart);
  }

  drawContactShadows(instances) {
    if (!this.lighting.enabled || !instances.body.length) return;
    const values=[];
    for (let i=0;i<instances.body.length;i+=21) {
      const x=instances.body[i],z=instances.body[i+2],h=instances.body[i+19],c=Math.cos(h),s=Math.sin(h);
      const heights=[[-.65,-.45],[.65,-.45],[.65,.45],[-.65,.45]].map(([px,pz])=>heightAt(this.terrain,x+px*c-pz*s,z+px*s+pz*c)+.045);
      values.push(x,z,...heights,h);
    }
    const gl=this.gl;
    this.bindCamera(this.contactShadowProgram);this.bindShadowStyle(this.contactShadowProgram);
    gl.bindVertexArray(this.contactShadowVAO);gl.bindBuffer(gl.ARRAY_BUFFER,this.contactShadowBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.DYNAMIC_DRAW);
    gl.depthMask(false);gl.drawArraysInstanced(gl.TRIANGLES,0,6,values.length/7);gl.depthMask(true);
    this.stats.groundShadows=values.length/7;this.stats.drawCalls++;
  }

  draw(snapshot,options={}) {
    this.resize();
    const terrain=snapshot.terrain || 'flat';
    if (terrain!==this.terrain) this.makeTerrain(terrain);
    const gl=this.gl;
    this.lighting = normalizeLighting(options.lighting ?? this.assets?.data.lighting);
    this.lightDirection = lightDirection(this.lighting);
    this.stats={sprites:0,groundShadows:0,drawCalls:0,relighting:!!(this.assets?.normal && this.lighting.enabled),lightDirection:[...this.lightDirection],characters:{}};
    gl.clearColor(0.86,0.83,0.72,1);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.depthMask(true);this.bindCamera(this.groundProgram);gl.bindVertexArray(this.groundVAO);
    gl.uniform3fv(gl.getUniformLocation(this.groundProgram,'u_lightDirection'),this.lightDirection);
    gl.uniform1i(gl.getUniformLocation(this.groundProgram,'u_lightEnabled'),this.lighting.enabled);
    gl.drawArrays(gl.TRIANGLES,0,this.groundCount);this.stats.drawCalls++;
    const instances=this.assets && options.showSoldiers!==false ? this.spriteInstances(snapshot,options) : null;
    if (instances) this.drawContactShadows(instances);
    this.drawOverlays(snapshot,options);
    if (instances) {
      this.bindCamera(this.spriteProgram);gl.bindVertexArray(this.spriteVAO);
      gl.uniform3fv(gl.getUniformLocation(this.spriteProgram,'u_lightDirection'),this.lightDirection);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_lightEnabled'),this.lighting.enabled);
      this.bindShadowStyle(this.spriteProgram);
      gl.uniform1i(gl.getUniformLocation(this.spriteProgram,'u_normals'),1);
      const pikeOpacity=gl.getUniformLocation(this.spriteProgram,'u_pikeOpacity');
      gl.uniform1f(pikeOpacity,1);
      for (const batch of instances.batches) {
        const assets=batch.assets;
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,(assets.normal || assets.body).texture);
        this.drawSpriteBatch(batch.body,assets.body);
        const id=assets.data.id || 'character';
        this.stats.characters[id]=(this.stats.characters[id] || 0)+batch.body.length/21;
      }
      for (const batch of instances.batches) if (batch.assets.pike) {
        gl.uniform1f(pikeOpacity,batch.pikeAppearance.opacity);
        this.drawSpriteBatch(batch.pikes,batch.assets.pike);
      }
      gl.uniform1f(pikeOpacity,1);
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
    [this.groundBuffer,this.overlayBuffer,this.spriteBuffer,this.contactShadowBuffer].forEach(b=>gl.deleteBuffer(b));
    [this.groundVAO,this.overlayVAO,this.spriteVAO,this.contactShadowVAO].forEach(v=>gl.deleteVertexArray(v));
    [this.groundProgram,this.colorProgram,this.spriteProgram,this.contactShadowProgram].forEach(p=>gl.deleteProgram(p));
    this.deleteAssets();
  }
}
