const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createImageryLoader}=require('./imagery.js');
const signal=()=>new AbortController().signal;
const tile=()=>new Response(new Blob(['satellite']),{status:200});
test('uses available imagery without resampling',async()=>{
  const loader=createImageryLoader({fetchImage:async url=>{assert.match(url,/blankTile=false$/);return tile()},cropImage:()=>assert.fail('Unexpected crop')});
  assert.equal(new TextDecoder().decode((await loader(3,5,6,signal())).data),'satellite');
});
test('missing tiles use the correct quadrant of the nearest ancestor',async()=>{
  const requests=[];
  const loader=createImageryLoader({fetchImage:async url=>{requests.push(url);return requests.length<3?new Response(null,{status:404}):tile()},cropImage:async(blob,region)=>{assert.deepEqual(region,{x:.75,y:.5,size:.25});return blob}});
  await loader(5,23,18,signal());
  assert.match(requests[1],/tile\/4\/9\/11\?/);assert.match(requests[2],/tile\/3\/4\/5\?/);
  await loader(5,23,18,signal());assert.equal(requests.length,3);
});
test('blank-tile header is rejected even on HTTP 200',async()=>{
  let count=0;
  const loader=createImageryLoader({fetchImage:async()=>++count===1?new Response('placeholder',{headers:{'blank-tile':'true'}}):tile(),cropImage:async blob=>blob});
  assert.equal(new TextDecoder().decode((await loader(2,1,1,signal())).data),'satellite');
});
test('network and authorization errors do not trigger ancestor requests',async()=>{
  let count=0;
  const loader=createImageryLoader({fetchImage:async()=>{count++;return new Response(null,{status:403})}});
  await assert.rejects(loader(5,1,1,signal()),/403/);assert.equal(count,1);
});
test('cancelled requests stop before fetching',async()=>{
  const controller=new AbortController();controller.abort();
  const loader=createImageryLoader({fetchImage:()=>assert.fail('Unexpected request')});
  await assert.rejects(loader(2,1,1,controller.signal),{name:'AbortError'});
});
