/* Missing Esri tiles are HTTP 404 instead of provider-generated placeholder images.
   Resolve the nearest available ancestor and crop its exact geographic quadrant. */
function createImageryLoader({fetchImage=fetch,cropImage=cropImageryTile}={}){
  const cache=new Map();
  const base='https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile';
  async function read(z,x,y,signal){
    signal.throwIfAborted();
    const key=`${z}/${y}/${x}`;
    if(cache.has(key))return cache.get(key);
    const response=await fetchImage(`${base}/${key}?blankTile=false`,{signal});
    let blob=null;
    if(response.status!==404&&response.headers.get('blank-tile')!=='true'){
      if(!response.ok)throw new Error(`Imagery service: HTTP ${response.status}`);
      blob=await response.blob();
    }
    signal.throwIfAborted();
    cache.set(key,blob);
    if(cache.size>192)cache.delete(cache.keys().next().value);
    return blob;
  }
  return async function load(z,x,y,signal){
    if(![z,x,y].every(Number.isInteger)||z<0||z>19||x<0||y<0||x>=2**z||y>=2**z)throw new Error('Invalid tile coordinates');
    for(let level=z;level>=0;level--){
      const factor=2**(z-level);
      const blob=await read(level,Math.floor(x/factor),Math.floor(y/factor),signal);
      if(!blob)continue;
      const result=level===z?blob:await cropImage(blob,{x:(x%factor)/factor,y:(y%factor)/factor,size:1/factor},signal);
      signal.throwIfAborted();
      return {data:await result.arrayBuffer()};
    }
    throw new Error('No satellite imagery available for this area');
  };
}
async function cropImageryTile(blob,region,signal){
  signal.throwIfAborted();
  const image=await createImageBitmap(blob);
  try{
    signal.throwIfAborted();
    const surface=document.createElement('canvas');surface.width=surface.height=256;
    const context=surface.getContext('2d');
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(image,region.x*image.width,region.y*image.height,region.size*image.width,region.size*image.height,0,0,256,256);
    return await new Promise((resolve,reject)=>surface.toBlob(result=>result?resolve(result):reject(new Error('Unable to decode imagery')),'image/png'));
  }finally{image.close()}
}
if(typeof module!=='undefined')module.exports={createImageryLoader};
