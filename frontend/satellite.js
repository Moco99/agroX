/* One camera, one globe projection and one imagery source at every altitude. */
const terrainLocations={argentina:[-61.55,-31.45],mexico:[-101.25,20.63],iowa:[-93.69,42.026],veracruz:[-96.35,19.12]};
regions.veracruz={name:'Veracruz, México',lat:19.12,lon:-96.35,rain:186,temp:24.1,solar:21.3,ndvi:.72,crops:[92,87,79]};
$('region').add(new Option('Veracruz, México','veracruz'));
const workspace=document.querySelector('.workspace');
const satelliteShell=document.createElement('section');
satelliteShell.className='satellite-shell';
satelliteShell.setAttribute('aria-label','Explorador satelital continuo');
satelliteShell.innerHTML=`<div id="satellite-map" aria-label="Globo y mapa satelital. Usa la rueda o dos dedos para acercarte."></div><div class="satellite-toolbar"><button id="explore-terrain"><i>${icon('locate')}</i>Explorar terrenos</button><button id="return-globe" aria-label="Volver a la vista global"><i>${icon('rotate')}</i>Vista global</button></div><div class="map-status" id="map-status" role="status">Cargando imágenes satelitales…</div>`;
workspace.prepend(satelliteShell);
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
let satelliteMap=null;
function mapStatus(message){$('map-status').textContent=message;$('map-status').hidden=!message}
function flyToLocation(center,level){
  if(!satelliteMap)return;
  const duration=Math.min(6500,Math.max(1400,Math.abs(level-satelliteMap.getZoom())*450));
  satelliteMap.flyTo({center,zoom:level,bearing:0,pitch:0,curve:1.2,duration,animate:!reducedMotion});
}
function initializeExplorer(){
  if(!window.maplibregl){mapStatus('No se pudo cargar el visor. Recarga la página.');return}
  try{
    const loadImagery=createImageryLoader();
    maplibregl.addProtocol('agrox-imagery',async(request,controller)=>{
      const match=/^agrox-imagery:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(request.url);
      if(!match)throw new Error('Invalid imagery request');
      const [,z,y,x]=match.map(Number);
      return loadImagery(z,x,y,controller.signal);
    });
    satelliteMap=new maplibregl.Map({
      container:'satellite-map',center:[-76,8],zoom:1.1,minZoom:0,maxZoom:19,
      maxPitch:0,dragRotate:false,attributionControl:false,renderWorldCopies:false,
      canvasContextAttributes:{antialias:true},
      style:{version:8,projection:{type:'globe'},
        sources:{satellite:{type:'raster',tileSize:256,maxzoom:19,
          tiles:['agrox-imagery://{z}/{y}/{x}'],
          attribution:'Imágenes © <a href="https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics y GIS User Community',
        }},
        layers:[{id:'satellite',type:'raster',source:'satellite',paint:{'raster-fade-duration':350}}],
        sky:{'sky-color':'#080f19','horizon-color':'#86bada','fog-color':'#162b3d','sky-horizon-blend':.8,'horizon-fog-blend':.5,'fog-ground-blend':.2},
      },
    });
    satelliteMap.touchZoomRotate.disableRotation();
    satelliteMap.addControl(new maplibregl.AttributionControl({compact:true}),'bottom-right');
    satelliteMap.addControl(new maplibregl.ScaleControl({maxWidth:110,unit:'metric'}),'bottom-left');
    satelliteMap.on('zoom',()=>{$('zoom-in').disabled=satelliteMap.getZoom()>=19;$('zoom-out').disabled=satelliteMap.getZoom()<=0});
    satelliteMap.on('idle',()=>mapStatus(''));
    satelliteMap.on('error',()=>mapStatus('No se pudieron cargar algunas imágenes. Comprueba tu conexión.'));
    satelliteMap.getCanvas().addEventListener('webglcontextlost',()=>mapStatus('Se perdió la aceleración gráfica. Recarga la página para recuperar el mapa.'));
    new ResizeObserver(()=>satelliteMap.resize()).observe(satelliteShell);
    $('zoom-in').onclick=()=>satelliteMap.zoomIn({duration:reducedMotion?0:450});
    $('zoom-out').onclick=()=>satelliteMap.zoomOut({duration:reducedMotion?0:450});
    $('locate').onclick=()=>flyToLocation(terrainLocations[current],Math.max(7,satelliteMap.getZoom()));
    $('explore-terrain').onclick=()=>flyToLocation(terrainLocations[current],16);
    $('return-globe').onclick=()=>flyToLocation(satelliteMap.getCenter(),1.1);
  }catch{mapStatus('Este visor necesita WebGL. Activa la aceleración gráfica del navegador y recarga la página.')}
}
const originalSetRegion=setRegion;
setRegion=function(value){originalSetRegion(value);flyToLocation(terrainLocations[value],satelliteMap?Math.max(5,satelliteMap.getZoom()):5)};
$('help').onclick=()=>detail('Un solo mapa, del planeta al terreno','Usa la rueda, los botones + y − o dos dedos para acercarte. El mismo mapa mantiene tu ubicación al pasar de la vista del planeta a las parcelas.<p><strong>Explorar terrenos</strong> realiza un acercamiento gradual a una zona agrícola de la región. <strong>Vista global</strong> se aleja desde el mismo punto.</p><p>Las imágenes requieren Internet y su fecha y resolución dependen de la zona. Los indicadores siguen siendo de demostración; el periodo del panel no cambia la fecha de las imágenes.</p>');
initializeExplorer();
