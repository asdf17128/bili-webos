import { safeMaskImage } from './danmakuMask.js';

const SVG = 'http://www.w3.org/2000/svg';
let nextMaskId = 0;
const geometryTags = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline']);
const make = (document, tag, attributes = {}) => {
  const node = document.createElementNS(SVG, tag);
  Object.keys(attributes).forEach(key => node.setAttribute(key, attributes[key]));
  return node;
};
const replace = (parent, child) => {
  if (parent.firstChild) parent.replaceChild(child, parent.firstChild); else parent.appendChild(child);
  while (parent.childNodes.length > 1) parent.removeChild(parent.lastChild);
};
const empty = parent => { while (parent.firstChild) parent.removeChild(parent.firstChild); };
const close = (a, b) => Math.abs(a - b) < 0.00001;

// Recognize only a single, straight rectangular subpath. Curves, holes and
// unsupported commands remain unknown; a bounding box alone is not evidence
// that an opaque rectangle fills its interior.
function rectanglePath(value) {
  if (/[CcSsQqTtAa]/.test(value)) return null;
  const tokens = value.match(/[MmLlHhVvZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  const points = []; let command = null, x = 0, y = 0, p = 0;
  while (p < tokens.length) {
    if (/^[a-z]$/i.test(tokens[p])) command = tokens[p++];
    if (!command) return null;
    if (/^[zZ]$/.test(command)) { command = null; if (p < tokens.length) return null; break; }
    const relative = command === command.toLowerCase(), upper = command.toUpperCase();
    const count = upper === 'H' || upper === 'V' ? 1 : 2;
    const values = tokens.slice(p, p + count).map(Number);
    if (values.length !== count || !values.every(Number.isFinite)) return null;
    p += count;
    if (upper === 'M' || upper === 'L') {
      if (upper === 'M' && points.length) return null;
      x = (relative ? x : 0) + values[0]; y = (relative ? y : 0) + values[1];
    } else if (upper === 'H') x = (relative ? x : 0) + values[0];
    else if (upper === 'V') y = (relative ? y : 0) + values[0];
    else return null;
    if (!points.length || !close(x, points[points.length - 1][0]) || !close(y, points[points.length - 1][1])) points.push([x, y]);
    if (upper === 'M') command = relative ? 'l' : 'L';
  }
  if (points.length > 1 && close(points[0][0], points[points.length - 1][0]) && close(points[0][1], points[points.length - 1][1])) points.pop();
  let changed = true;
  while (changed && points.length > 4) {
    changed = false;
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], b = points[i], c = points[(i + 1) % points.length];
      if ((close(a[0], b[0]) && close(b[0], c[0])) || (close(a[1], b[1]) && close(b[1], c[1]))) { points.splice(i, 1); changed = true; break; }
    }
  }
  if (points.length !== 4 || points.some((a, i) => { const b = points[(i + 1) % 4]; return !close(a[0], b[0]) && !close(a[1], b[1]); })) return null;
  const xs = [...new Set(points.map(p => p[0]))], ys = [...new Set(points.map(p => p[1]))];
  if (xs.length !== 2 || ys.length !== 2 || close(xs[0], xs[1]) || close(ys[0], ys[1]) || new Set(points.map(p => p.join(','))).size !== 4) return null;
  return points;
}

function sourceBox(template) {
  const values = template.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (values?.length === 4 && values.every(Number.isFinite) && values[2] > 0 && values[3] > 0) return values;
  const width = Number.parseFloat(template.getAttribute('width')), height = Number.parseFloat(template.getAttribute('height'));
  if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw Error('Invalid mask geometry');
  template.setAttribute('viewBox', `0 0 ${width} ${height}`);
  return [0, 0, width, height];
}

function colorAlpha(value) {
  if (!value || value === 'none' || value === 'transparent') return 0;
  if (value[0] === '#') {
    if (value.length === 5) return parseInt(value[4], 16) / 15;
    if (value.length === 9) return parseInt(value.slice(7), 16) / 255;
  }
  if (value.startsWith('rgba(') || value.includes('/')) {
    const alpha = value.match(/[,/]\s*([\d.]+)(%)?\s*\)$/);
    if (alpha) return Number(alpha[1]) / (alpha[2] ? 100 : 1);
  }
  return 1;
}
function paintOpacity(shape, template, view) {
  const style = view.getComputedStyle(shape); let group = 1;
  for (let node = shape; node && node !== template.parentNode; node = node.parentNode) group *= Number(view.getComputedStyle(node).opacity || 1);
  return { style, opacity: group * Number(style.fillOpacity || 1) * colorAlpha(style.fill), strokeOpacity: group * Number(style.strokeOpacity || 1) * colorAlpha(style.stroke) };
}
function canPad(shape, template, view) {
  if (!shape || paintOpacity(shape, template, view).opacity <= 0) return false;
  if (['rect', 'circle', 'ellipse', 'polygon'].includes(shape.localName)) return true;
  if (shape.localName !== 'path') return false;
  const d=shape.getAttribute('d')||'', starts=(d.match(/[Mm]/g)||[]).length, closes=(d.match(/[Zz]/g)||[]).length;
  return starts > 0 && starts === closes;
}

function protection(template, box, document) {
  // Nested SVG viewports can clip geometry; bbox and point-in-fill checks do
  // not account for that clipping. Preserve the source but classify unknown.
  if (template.getElementsByTagName('svg').length) return null;
  const shapes = Array.from(template.getElementsByTagName('*')).filter(node => geometryTags.has(node.localName));
  const view = document.defaultView;
  const matrix = template.getScreenCTM();
  if (!matrix || box[2] <= 4 || box[3] <= 4) return null;
  const entries = [];
  for (const shape of shapes) {
    const ctm = shape.getScreenCTM();
    if (!ctm) return null;
    const {style, opacity, strokeOpacity} = paintOpacity(shape, template, view);
    const toSource = matrix.inverse().multiply(ctm), toShape = ctm.inverse().multiply(matrix);
    entries.push({ shape, style, opacity, strokeOpacity, toShape });
    let points = null;
    if (shape.localName === 'rect' && !Number(shape.getAttribute('rx')) && !Number(shape.getAttribute('ry'))) {
      const x = Number(shape.getAttribute('x') || 0), y = Number(shape.getAttribute('y') || 0), w = Number(shape.getAttribute('width')), h = Number(shape.getAttribute('height'));
      if ([x,y,w,h].every(Number.isFinite) && w > 0 && h > 0) points = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
    } else if (shape.localName === 'path') points = rectanglePath(shape.getAttribute('d') || '');
    if (!points || style.fill === 'none' || opacity < 0.999) continue;
    points = points.map(([x,y]) => [toSource.a*x+toSource.c*y+toSource.e, toSource.b*x+toSource.d*y+toSource.f]);
    if (points.some((a,i) => { const b=points[(i+1)%4]; return !close(a[0],b[0]) && !close(a[1],b[1]); })) continue;
    const xs=points.map(p=>p[0]), ys=points.map(p=>p[1]);
    if (Math.min(...xs)<=box[0]+2 && Math.max(...xs)>=box[0]+box[2]-2 && Math.min(...ys)<=box[1]+2 && Math.max(...ys)>=box[1]+box[3]-2) return false;
  }
  // Positive evidence only. A tiny hole may fall between samples, so no hit
  // means unknown, never "fully opaque". Complex geometry has a fixed budget.
  if (entries.length > 32 || entries.some(e => typeof e.shape.isPointInFill !== 'function')) return null;
  const samples = [[.5,.5],[.25,.5],[.75,.5],[.5,.25],[.5,.75],[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  for (const [fx,fy] of samples) {
    const x=box[0]+2+(box[2]-4)*fx, y=box[1]+2+(box[3]-4)*fy;
    let covered=false;
    for (const e of entries) {
      const point=template.createSVGPoint(); point.x=e.toShape.a*x+e.toShape.c*y+e.toShape.e; point.y=e.toShape.b*x+e.toShape.d*y+e.toShape.f;
      if (e.opacity > 0 && e.style.fill !== 'none' && e.shape.isPointInFill(point)) { covered=true; break; }
      if (e.strokeOpacity > 0 && e.style.stroke !== 'none') {
        if (typeof e.shape.isPointInStroke !== 'function') return null;
        if (e.shape.isPointInStroke(point)) { covered=true; break; }
      }
    }
    if (!covered) return true;
  }
  return null;
}

// A stable SVG resource avoids the image decode/raster/PNG/decode pipeline.
// Only validated geometry enters the document. No video pixels are read.
export function createDanmakuMaskVector(element) {
  const document=element.ownerDocument;
  let id;
  do { id=`bili-person-mask-${++nextMaskId}`; } while(document.getElementById(id));
  const edgeId=id+'-edge', root=make(document,'svg',{width:0,height:0,'aria-hidden':'true'}), defs=make(document,'defs');
  root.style.cssText='position:absolute;width:0;height:0;pointer-events:none'; root.appendChild(defs);
  const mask=make(document,'mask',{id,maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse'});mask.style.maskType='alpha';
  const edge=make(document,'mask',{id:edgeId,maskUnits:'userSpaceOnUse',maskContentUnits:'userSpaceOnUse'});edge.style.maskType='luminance';
  const white=make(document,'rect',{fill:'white'}), outline=make(document,'g'), border=make(document,'rect',{fill:'none',stroke:'white'});
  edge.appendChild(white);edge.appendChild(outline);edge.appendChild(border);
  const shape=make(document,'g'), bars=Array.from({length:4},()=>make(document,'rect',{fill:'white'}));bars.forEach(r=>mask.appendChild(r));mask.appendChild(shape);
  defs.appendChild(edge);defs.appendChild(mask);
  const probe=make(document,'g');defs.appendChild(probe);
  (element.parentNode || document.body).appendChild(root);
  let disposed=false, active=false;
  const clear=()=>{element.style.webkitMaskImage='none';element.style.maskImage='none';active=false;empty(shape);empty(outline);};
  const prepare=uri=>{
    if(disposed)throw Error('Disposed mask renderer');
    const safe=safeMaskImage(uri), parsed=new DOMParser().parseFromString(atob(safe.split(',')[1]),'image/svg+xml').documentElement;
    const template=document.importNode(parsed,true),box=sourceBox(template);
    if(!box.every(Number.isFinite)||box[2]>16384||box[3]>16384)throw Error('Invalid mask geometry');
    template.setAttribute('width',box[2]);template.setAttribute('height',box[3]);template.setAttribute('x',0);template.setAttribute('y',0);
    let sourceHasHole=null,paddingSupported=false;
    probe.appendChild(template);
    try{sourceHasHole=protection(template,box,document);const shapes=Array.from(template.getElementsByTagName('*')).filter(n=>geometryTags.has(n.localName));paddingSupported=!template.getElementsByTagName('svg').length&&shapes.length===1&&canPad(shapes[0],template,document.defaultView);}catch(_){sourceHasHole=null;}finally{probe.removeChild(template);}
    const result={template,sourceHasHole,sourceProtectedRatio:sourceHasHole===false?0:null,paddingSupported,dispose(){this.template=null;}};
    return result;
  };
  const apply=(prepared,{width,height,x,y,w,h})=>{
    if(disposed||!prepared.template)return;
    if(![width,height,x,y,w,h].every(Number.isFinite)||width<=0||height<=0||w<=0||h<=0)throw Error('Invalid mask layout');
    for(const node of [mask,edge,white]){node.setAttribute('x',0);node.setAttribute('y',0);node.setAttribute('width',width);node.setAttribute('height',height);}
    const fit=prepared.template.cloneNode(true);fit.setAttribute('x',x);fit.setAttribute('y',y);fit.setAttribute('width',w);fit.setAttribute('height',h);fit.setAttribute('preserveAspectRatio','none');
    replace(shape,fit);
    if(prepared.paddingSupported){
      const stroke=fit.cloneNode(true),padding=Math.max(0,Math.min(12,h/90));
      for(const node of [stroke,...Array.from(stroke.getElementsByTagName('*'))]){node.setAttribute('fill','none');node.setAttribute('stroke','black');node.setAttribute('stroke-width',padding*2);node.setAttribute('vector-effect','non-scaling-stroke');}
      replace(outline,stroke);shape.setAttribute('mask',`url(#${edgeId})`);
      for(const [key,value]of Object.entries({x,y,width:w,height:h,'stroke-width':padding*2}))border.setAttribute(key,value);
    }else{empty(outline);shape.removeAttribute('mask');border.setAttribute('stroke-width',0);}
    const rects=[[0,0,width,Math.max(0,y)],[0,y+h,width,Math.max(0,height-y-h)],[0,y,Math.max(0,x),h],[x+w,y,Math.max(0,width-x-w),h]];
    bars.forEach((node,i)=>{const [a,b,c,d]=rects[i];for(const[k,v]of Object.entries({x:a,y:b,width:c,height:d}))node.setAttribute(k,v);});
    if(!active){element.style.webkitMaskImage=`url("#${id}")`;element.style.maskImage=`url("#${id}")`;element.style.webkitMaskSize='auto';element.style.maskSize='auto';element.style.webkitMaskPosition='0px 0px';element.style.maskPosition='0px 0px';element.style.webkitMaskRepeat='no-repeat';element.style.maskRepeat='no-repeat';element.style.webkitMaskComposite='source-over';element.style.maskComposite='add';active=true;}
  };
  return {prepare,apply,clear,dispose(){if(disposed)return;clear();disposed=true;if(root.parentNode)root.parentNode.removeChild(root);}};
}
