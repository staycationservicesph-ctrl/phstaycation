(function(){
'use strict';
const IMG={"banner": "/img/banner.5a745894.webp", "logo": "/img/logo.2f56a58d.webp", "m372": "/img/m372.19d1c64f.webp", "gal5": "/img/gal5.24fff95f.webp", "gal8": "/img/gal8.55f985f1.webp", "map": "/img/map.c34f678c.webp", "gal3": "/img/gal3.bcfb3097.webp", "gal2": "/img/gal2.b154e1ee.webp", "m525": "/img/m525.e2df6c0f.webp", "m1407": "/img/m1407.1abca91d.webp", "gal7": "/img/gal7.ae46f01b.webp", "gal4": "/img/gal4.829775c9.webp", "hero3": "/img/hero3.06717a83.webp", "gal6": "/img/gal6.f67530a2.webp", "pool": "/img/pool.c9261c6c.webp", "gym": "/img/gym.0ee0b30e.webp", "hero1": "/img/hero1.b5e7c759.webp", "garden": "/img/garden.97f72e93.webp", "gal1": "/img/gal1.6a7de295.webp", "hero2": "/img/hero2.98e967ec.webp"};
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso=n=>'\u20B1'+Number(n).toLocaleString('en-PH');
const pad=n=>String(n).padStart(2,'0');
const iso=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parse=s=>{const a=s.split('-').map(Number);return new Date(a[0],a[1]-1,a[2])};
const addDays=(s,n)=>{const d=parse(s);d.setDate(d.getDate()+n);return iso(d)};
const nightsBetween=(a,b)=>Math.round((parse(b)-parse(a))/864e5);
const fmt=s=>parse(s).toLocaleDateString('en-PH',{month:'short',day:'numeric'});
const fmtL=s=>parse(s).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
const IC={
 check:'<polyline points="20 6 9 17 4 12"/>',
 bed:'<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 16h20M6 10V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>',
 users:'<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
 pin:'<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
 clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
 shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 star:'<polygon points="12 2 15 9 22 9.3 16.5 14 18.5 21 12 17 5.5 21 7.5 14 2 9.3 9 9"/>',
 ban:'<circle cx="12" cy="12" r="10"/><line x1="4.9" y1="4.9" x2="19.1" y2="19.1"/>',
 moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
 wifi:'<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r="1"/><path d="M2 9a15 15 0 0 1 20 0"/>',
 water:'<path d="M12 2.7s6 6.3 6 10.3a6 6 0 0 1-12 0c0-4 6-10.3 6-10.3z"/>',
 home:'<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M14 9h1M9 13h1M14 13h1M9 17h6"/>',
 info:'<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
 sofa:'<path d="M4 11V8a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v3M2 13a2 2 0 0 1 4 0v3h12v-3a2 2 0 0 1 4 0v5H2z"/>',
 heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21.2l7.8-7.7 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
 grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
};
const ic=(n,extra)=>'<svg class="i" viewBox="0 0 24 24" aria-hidden="true"'+(extra||'')+'>'+(IC[n]||'')+'</svg>';

const LIVE=true;
const COOLDOWN=20000;
const MPC=window.MPCore;
let db={units:[],bookings:[],rules:[]};

const MOS={'1407':'m1407','372':'m372','525':'m525'};
const POOL=['gal2','gal7','gal3','gal8'];
const photoFor=un=>{const i=db.units.indexOf(un);return IMG[MOS[un.id]||POOL[i%POOL.length]]};

const search={ci:addDays(today,3),co:addDays(today,5),guests:2};
const unitById=id=>db.units.find(x=>x.id===id);
const active=b=>b.status!=='cancelled';
const isFree=(uid,ci,co)=>!db.bookings.some(b=>b.unit===uid&&active(b)&&b.ci<co&&ci<b.co);
const occupied=(uid,day)=>db.bookings.some(b=>b.unit===uid&&active(b)&&b.ci<=day&&day<b.co);
const validRange=(ci,co)=>!!ci&&!!co&&co>ci&&ci>=today;
const nightPrice=(un,day)=>MPC.nightPrice(un,day,db.rules);
const quote=(unit,ci,co,guests)=>MPC.quote(unit,ci,co,guests,db.rules);

/* ---------- shareable search link: ?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD&guests=N ---------- */
let urlOn=false;
(function(){try{
  const p=new URLSearchParams(location.search),ci=p.get('checkin')||'',co=p.get('checkout')||'',g=Number(p.get('guests'));
  const okD=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&iso(parse(s))===s;
  if(okD(ci)&&okD(co)&&validRange(ci,co)&&nightsBetween(ci,co)<=60){search.ci=ci;search.co=co;urlOn=true}
  if(Number.isInteger(g)&&g>=1&&g<=5){search.guests=g;urlOn=true}
}catch(e){}})();
function syncUrl(){
  if(!urlOn)return;
  try{
    const u=new URL(location.href);['checkin','checkout','guests'].forEach(k=>u.searchParams.delete(k));
    if(validRange(search.ci,search.co)){u.searchParams.set('checkin',search.ci);u.searchParams.set('checkout',search.co);u.searchParams.set('guests',String(search.guests))}
    const next=u.pathname+u.search+u.hash;
    if(next!==location.pathname+location.search+location.hash)history.replaceState(null,'',next);
  }catch(e){}
}

/* ---------- saved units (kept only in this browser) ---------- */
const SAVED_KEY='mp_saved';
let saved=(function(){try{const a=JSON.parse(localStorage.getItem(SAVED_KEY)||'[]');return new Set(Array.isArray(a)?a.map(String).slice(0,50):[])}catch(e){return new Set()}})();
function toggleSaved(id){
  if(saved.has(id))saved.delete(id);else saved.add(id);
  try{localStorage.setItem(SAVED_KEY,JSON.stringify([...saved]))}catch(e){}
  renderProps();
}
function lines(q){
  const g=q.groups;let h='';
  if(g.weekday.n)h+='<div class="row"><span>'+g.weekday.n+(g.weekday.n===1?' weeknight':' weeknights')+' x '+peso(g.weekday.p)+'</span><span>'+peso(g.weekday.sum)+'</span></div>';
  if(g.weekend.n)h+='<div class="row"><span>'+g.weekend.n+(g.weekend.n===1?' Fri/Sat night':' Fri/Sat nights')+' x '+peso(g.weekend.p)+'</span><span>'+peso(g.weekend.sum)+'</span></div>';
  if(g.special.n)h+='<div class="row"><span>'+g.special.n+(g.special.n===1?' special-date night':' special-date nights')+'</span><span>'+peso(g.special.sum)+'</span></div>';
  if(q.extra)h+='<div class="row"><span>'+q.extraGuests+' extra guest'+(q.extraGuests>1?'s':'')+'</span><span>'+peso(q.extra)+'</span></div>';
  return h;
}
/* availability selection state */
const A={unit:'595',ci:null,co:null,month:null,msg:'',guests:2};
function monthOf(s){const d=parse(s||today);return new Date(d.getFullYear(),d.getMonth(),1)}
function applySearchToA(){
  if(validRange(search.ci,search.co)){
    if(isFree(A.unit,search.ci,search.co)){A.ci=search.ci;A.co=search.co;A.month=monthOf(search.ci);A.msg=''}
    else{A.ci=null;A.co=null;A.month=monthOf(search.ci);A.msg='Unit '+A.unit+' is booked for those dates. Pick other days or another unit.'}
  }
  const un=unitById(A.unit);A.guests=Math.min(search.guests,un?un.max:4);
}

/* ---------- static content ---------- */
function renderStatic(){
  IMG_SLIDES=[IMG.banner,IMG.hero1,IMG.hero2,IMG.hero3];$('#logo-img').src=IMG.logo;{const fv=document.createElement('link');fv.rel='icon';fv.href=IMG.logo;document.head.appendChild(fv)}
  $('#chips').innerHTML=[['bed','Comfortable Beds'],['wifi','Free WiFi'],['pin','Central Location'],['water','Pool Access']].map(c=>'<span class="chip">'+ic(c[0])+c[1]+'</span>').join('');
  $('#trio').innerHTML=[['pin','Prime Location','Located in the heart of Manila with easy access to major attractions','Close to shopping malls, restaurants, and business districts'],['bed','Comfortable Space','Thoughtfully designed space with quality furnishings','Perfect for couples, solo travelers, or business trips'],['shield','Premium Amenities','Access to building amenities including pool and fitness center','24/7 security and convenient self check-in']].map(t=>'<div class="tri"><div class="ic">'+ic(t[0])+'</div><h3>'+t[1]+'</h3><p>'+t[2]+'</p><em>'+t[3]+'</em></div>').join('');
  $('#incl').innerHTML=['Comfortable Beds','Sofa','Smart TV','Netflix','High-Speed WiFi','Air Conditioning','Hot & Cold Shower','Toiletries','Fresh Towels','Dining Area','Refrigerator','Microwave','Electric Kettle','Basic Kitchenware','Work Desk','Wardrobe'].map(x=>'<li>'+ic('check')+esc(x)+'</li>').join('');
  $('#amen').innerHTML=[['pool','Swimming Pool','Relax and unwind in our refreshing swimming pool with stunning views.','Open daily from 6AM to 10PM'],['gym','Fitness Center','Stay fit during your stay with our well-equipped fitness center.','24/7 access for guests'],['garden','Garden & Leisure Areas','Enjoy beautifully landscaped gardens and outdoor leisure spaces.','Perfect for relaxation and fresh air']].map(a=>'<div class="am"><img src="'+IMG[a[0]]+'" alt="'+esc(a[1])+'" loading="lazy" decoding="async"><div><h3>'+a[1]+'</h3><p>'+a[2]+'</p><span>'+ic('clock')+a[3]+'</span></div></div>').join('');
  $('#near').innerHTML=['Shopping Malls - Within walking distance','Restaurants & Cafes - Numerous options nearby','Business Districts - Easy access','Cultural Attractions - Short drive away','Public Transportation - Convenient access','Medical Facilities - Nearby','Convenience Stores - Within the building'].map(x=>'<li>'+ic('pin')+esc(x)+'</li>').join('');
  $('#map-img').src=IMG.map;
  const stars=n=>'<div class="stars" aria-label="'+n+' out of 5 stars">'+ic('star').repeat(n)+'</div>';
  $('#revs').innerHTML=[['Exceptional Stay!','The unit was spotlessly clean and beautifully decorated. The location is perfect - close to everything we needed. The host was very responsive and accommodating. Will definitely stay here again!','Maria Rodriguez','MR','May 2023'],['Perfect for Business Travel','I stayed here during a business trip and it was exactly what I needed. Fast WiFi, comfortable workspace, and great amenities. The self check-in process was smooth and convenient.','James Thompson','JT','July 2023'],['Great Value for Money','This place exceeded our expectations! The pool and gym access was a huge plus. The unit had everything we needed and more. The location is very convenient with lots of restaurants and shops nearby.','Anna Lee','AL','September 2023']].map(r=>'<div class="rev">'+stars(5)+'<h4>'+r[0]+'</h4><p>&ldquo;'+r[1]+'&rdquo;</p><div class="who"><i>'+r[3]+'</i><span>'+r[2]+'<small>'+r[4]+'</small></span></div></div>').join('');
  const gl=['Kitchen','Pillows','TV','Sculpture','Feather','Utensils','Bed','Sofa'];
  $('#gal').innerHTML=gl.map((t,i)=>'<button data-photo="gal'+(i+1)+'" data-alt="'+t+'" aria-label="Enlarge photo: '+t+'"><img src="'+IMG['gal'+(i+1)]+'" alt="'+t+'" loading="lazy" decoding="async"></button>').join('');
  renderRules('gen');
}
let IMG_SLIDES=[];
const RULES={
 gen:{t:'General House Rules',i:'info',items:[['ban','No Smoking','Smoking is strictly prohibited inside the unit. A cleaning fee of \u20B12,000 will be charged for violations.'],['moon','Quiet Hours','Please observe quiet hours from 10:00 PM to 8:00 AM. Respect other residents in the building.'],['users','Guest Limit','Only registered guests are allowed to stay overnight. Maximum occupancy is strictly enforced.'],['ban','No Pets','We love animals, but pets are not allowed in the unit to maintain cleanliness and prevent allergies.'],['ban','No Parties','Parties and events are not permitted. The unit is for residential use only.'],['check','Cleanliness','Please maintain cleanliness during your stay. Dispose of trash properly in designated areas.']]},
 cio:{t:'Check-in & Check-out Policies',i:'clock',items:[['clock','Check-in Time','Check-in is from 2:00 PM onwards. Early check-in may be available upon request, subject to availability.'],['home','Self Check-in','Detailed check-in instructions will be provided before your arrival. Please follow them carefully.'],['shield','ID Verification','All guests must provide valid ID for verification. This is for security and building regulations.'],['clock','Check-out Time','Check-out is by 12:00 PM (noon). Late check-out may be available upon request, subject to availability.'],['check','Check-out Procedure','Close all windows, turn off lights and appliances, and lock the door when leaving.'],['info','Key Return','Return keys as instructed in the check-out information. Lost keys will incur a replacement fee.']]},
 saf:{t:'Safety & Security Guidelines',i:'shield',items:[['shield','Lock Up','Always lock doors and windows when leaving the unit, even for short periods.'],['users','Visitor Policy','All visitors must be registered with building security. Unregistered guests will not be allowed entry.'],['info','Fire Safety','Familiarize yourself with emergency exits and fire safety equipment. Do not tamper with smoke detectors.'],['info','Electrical Safety','Turn off all appliances when not in use. Do not overload electrical outlets.'],['info','Emergency Contacts','Emergency contact information is provided in the unit. Contact us immediately for any security concerns.'],['info','Access Cards/Keys','Do not share access cards or keys with non-registered guests. Report lost cards or keys immediately.']]},
 amu:{t:'Amenities Usage Guidelines',i:'water',items:[['water','Swimming Pool','6:00 AM - 10:00 PM. Shower before entering. No diving. Children must be supervised. No food or glass containers.'],['grid','Fitness Center','24/7 access. Use equipment properly and clean it after use. Wear athletic footwear. No children under 16 without an adult.'],['pin','Garden & Leisure Areas','6:00 AM - 10:00 PM. Keep noise reasonable, clean up after yourself, and no smoking.'],['info','Elevators & Common Areas','Keep common areas clean. Do not block elevators or hallways. Follow all posted signs.']]}
};
const TABS=[['gen','General Rules'],['cio','Check-in/Check-out'],['saf','Safety & Security'],['amu','Amenities Usage']];
function renderRules(k){
  $('#tabs').innerHTML=TABS.map(t=>'<button role="tab" data-tab="'+t[0]+'" aria-selected="'+(t[0]===k)+'">'+t[1]+'</button>').join('');
  const r=RULES[k];
  $('#rules-body').innerHTML='<h3>'+ic(r.i)+r.t+'</h3><div class="rgrid">'+r.items.map(x=>'<div class="rule"><span class="ic">'+ic(x[0])+'</span><div><h4>'+x[1]+'</h4><p>'+x[2]+'</p></div></div>').join('')+'</div>';
}

/* carousel */
let slide=0,timer=null;
function buildCarousel(){
  const car=$('#car');
  IMG_SLIDES.forEach((src,i)=>{const d=document.createElement('div');d.className='slide'+(i===0?' on contain':'');d.innerHTML=(i===0?'<img class="bgfill" src="'+src+'" alt="" aria-hidden="true">':'')+'<img src="'+src+'" alt="'+(i===0?'Manila Prime Staycation, Shore Residences Pasay near MOA. Your home, your stay, our priority.':'Manila Prime Staycation photo '+i)+'">';car.insertBefore(d,$('#dots'))});
  $('#dots').innerHTML=IMG_SLIDES.map((s,i)=>'<button data-slide="'+i+'" aria-label="Show photo '+(i+1)+'" aria-current="'+(i===0)+'"></button>').join('');
  const reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start=()=>{if(!timer&&!reduce&&!document.hidden)timer=setInterval(()=>go(slide+1),5000)};
  const stop=()=>{clearInterval(timer);timer=null};
  start();car.addEventListener('mouseenter',stop);car.addEventListener('mouseleave',start);car.addEventListener('focusin',stop);car.addEventListener('focusout',start);
  document.addEventListener('visibilitychange',()=>{document.hidden?stop():start()});
}
function go(n){
  const s=document.querySelectorAll('#car .slide');if(!s.length)return;
  slide=(n+s.length)%s.length;
  s.forEach((e,i)=>e.classList.toggle('on',i===slide));
  document.querySelectorAll('#dots button').forEach((b,i)=>b.setAttribute('aria-current',String(i===slide)));
}

/* ---------- properties ---------- */
function renderFilters(){
  const towers=[...new Set(db.units.map(x=>x.tower))];
  const sel=$('#f-tower'),cur=sel.value;
  sel.innerHTML='<option value="">All towers</option>'+towers.map(t=>'<option'+(t===cur?' selected':'')+'>'+esc(t)+'</option>').join('');
}
function renderProps(){
  const ok=validRange(search.ci,search.co);
  const freeCount=ok?db.units.filter(x=>isFree(x.id,search.ci,search.co)&&search.guests<=x.max).length:db.units.length;
  $('#stats').innerHTML=[['check',db.units.length+' Units','Ready to book'],(search.guests>4?['users','Groups','Ask us for a quote']:(LIVE?['users','Direct Booking','Request your dates online']:['users',freeCount+' Free',ok?('For '+fmt(search.ci)+' to '+fmt(search.co)):'Pick dates to check'])),['bed','Bedspace Options','Budget-friendly stays'],['grid','Expanding','More locations soon']].map(s=>'<div class="stat"><div class="ic">'+ic(s[0])+'</div><b>'+s[1]+'</b><span>'+s[2]+'</span></div>').join('');
  if(search.guests>4){$('#cnt').textContent='Groups of more than 4 guests';$('#grid').innerHTML='<div class="empty"><b style="color:var(--ink)">Booking for more than 4 guests?</b><br>Our units sleep up to 4. Send us your dates and group size and we will reply with a quote.<br><button class="pill" style="margin-top:12px" data-act="open-inq">Send a group inquiry</button></div>';return}
  const tw=$('#f-tower').value,sort=$('#f-sort').value;
  const nSaved=db.units.filter(x=>saved.has(x.id)).length,sv=$('#f-saved');
  if(!nSaved&&sv.checked)sv.checked=false;
  $('#f-saved-w').hidden=!nSaved;$('#f-saved-n').textContent=nSaved;
  let list=db.units.filter(x=>x.max>=search.guests&&(!tw||x.tower===tw)&&(!sv.checked||saved.has(x.id)));
  if(sort==='lo')list=list.slice().sort((a,b)=>a.price-b.price);
  if(sort==='hi')list=list.slice().sort((a,b)=>b.price-a.price);
  if(ok)list=list.slice().sort((a,b)=>(isFree(b.id,search.ci,search.co)?1:0)-(isFree(a.id,search.ci,search.co)?1:0));
  const nFree=ok?list.filter(x=>isFree(x.id,search.ci,search.co)).length:list.length;
  $('#cnt').textContent=ok?('Showing '+(LIVE?list.length+' units':nFree+' of '+list.length+' units free')+', '+nightsBetween(search.ci,search.co)+(nightsBetween(search.ci,search.co)===1?' night':' nights')+', '+search.guests+(search.guests===1?' guest':' guests')):('Showing '+list.length+' of '+db.units.length+' units');
  if(!list.length){$('#grid').innerHTML='<div class="empty">No unit fits '+search.guests+' guests in this tower. Try another tower or fewer guests.</div>';return}
  $('#grid').innerHTML=list.map(un=>{
    const f=ok?isFree(un.id,search.ci,search.co):true;
    const q=ok&&f?quote(un,search.ci,search.co,search.guests):null;
    const cap=un.base<un.max?('Max '+un.base+' guests, add \u20B1'+un.extra+' per extra guest (up to '+(un.max-un.base)+' more)'):('2-'+un.max+' Guests');
    return '<article class="card"><div class="ph"><img src="'+photoFor(un)+'" alt="Photos of unit '+esc(un.id)+'" loading="lazy" decoding="async">'+(MOS[un.id]?'':'<span class="lab">'+esc(un.id)+'</span>')+'<button type="button" class="heart" data-save="'+esc(un.id)+'" aria-pressed="'+(saved.has(un.id)?'true':'false')+'" aria-label="'+(saved.has(un.id)?'Remove unit ':'Save unit ')+esc(un.id)+(saved.has(un.id)?' from saved':'')+'">'+ic('heart')+'</button></div>'+
    '<div class="bd"><div class="r1"><h3>'+esc(un.id)+' '+esc(un.tower)+'</h3>'+(LIVE?'':'<span class="badge '+(f?'ok':'no')+'">'+(f?'Available':'Booked')+'</span>')+'</div>'+
    '<p>'+esc(un.desc)+'</p><ul><li>'+ic('users')+esc(cap)+'</li><li>'+ic('bed')+esc(un.beds)+'</li><li>'+ic('sofa')+esc(un.perks)+'</li></ul>'+
    '<div class="ft"><div class="pr"><strong>'+peso(un.price)+'</strong><small>per night'+(un.weekend!==un.price?', Fri/Sat '+peso(un.weekend):'')+(q?'<br>'+peso(q.total)+' total for '+q.n+(q.n===1?' night':' nights'):'')+'</small></div><div class="bt"><button class="pill out sm" data-view="'+esc(un.id)+'">View</button><button class="pill sm" data-book="'+esc(un.id)+'">Book</button></div></div></div></article>';
  }).join('');
}
function viewUnit(id){
  const un=unitById(id);if(!un)return;
  const ok=validRange(search.ci,search.co),f=ok?isFree(id,search.ci,search.co):true;
  $('#dl').innerHTML='<div class="hd"><h2 id="dlg-t">Unit '+esc(un.id)+', '+esc(un.tower)+'</h2><button class="x" data-act="close" aria-label="Close">&times;</button></div>'+
   '<div class="vw"><img src="'+photoFor(un)+'" alt="Photos of unit '+esc(un.id)+'"><div>'+(LIVE?'':'<span class="badge '+(f?'ok':'no')+'">'+(f?'Available':'Booked for your dates')+'</span>')+'<p style="color:var(--muted);margin:10px 0 0">'+esc(un.desc)+'</p>'+
   '<ul><li>'+ic('users')+'Up to '+un.max+' guests'+(un.extra?' (\u20B1'+un.extra+' per guest beyond '+un.base+', per night)':'')+'</li><li>'+ic('bed')+esc(un.beds)+'</li><li>'+ic('sofa')+esc(un.perks)+'</li><li>'+ic('wifi')+'High-speed WiFi, air conditioning, full kitchen</li></ul>'+
   '<div style="margin:12px 0"><b style="color:var(--orange);font-size:1.4rem">'+peso(un.price)+'</b> <span style="color:var(--muted)">per night'+(un.weekend!==un.price?' (Fri/Sat '+peso(un.weekend)+')':'')+'</span></div>'+
   '<button class="pill" data-book="'+esc(un.id)+'">Check dates</button></div></div>';
  if(!$('#dlg').open)$('#dlg').showModal();
}

/* ---------- availability ---------- */
function renderAUnits(){
  $('#a-unit').innerHTML=db.units.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===A.unit?' selected':'')+'>'+esc(x.id)+' '+esc(x.tower)+' - '+peso(x.price)+'</option>').join('');
}
function monthHTML(m){
  const y=m.getFullYear(),mo=m.getMonth();
  const first=new Date(y,mo,1).getDay(),dim=new Date(y,mo+1,0).getDate();
  let h='<div class="mo"><h4>'+m.toLocaleString('en-PH',{month:'long',year:'numeric'})+'</h4><div class="cg">';
  'SMTWTFS'.split('').forEach(d=>{h+='<div class="dw">'+d+'</div>'});
  for(let i=0;i<first;i++)h+='<span class="e"></span>';
  for(let d=1;d<=dim;d++){
    const day=iso(new Date(y,mo,d));
    const past=day<today,bk=!past&&occupied(A.unit,day);
    const c=[];
    if(past)c.push('pa');else if(bk)c.push('tk');
    if(A.ci&&day===A.ci)c.push('se');else if(A.co&&day===A.co)c.push('se');
    else if(A.ci&&A.co&&day>A.ci&&day<A.co)c.push('rg');
    let pr='';if(!past&&!bk){const np=nightPrice(unitById(A.unit),day);pr='<span class="dp'+(np.p>unitById(A.unit).price?' up':'')+'">'+np.p.toLocaleString('en-PH')+'</span>'}
    h+='<button type="button" data-day="'+day+'" class="'+c.join(' ')+'"'+(past?' disabled':'')+' aria-label="'+parse(day).toDateString()+(bk?', booked':(past?'':', '+peso(nightPrice(unitById(A.unit),day).p)+' per night'))+'"><span class="dn">'+d+'</span>'+pr+'</button>';
  }
  return h+'</div></div>';
}
function renderCal(){
  const m1=A.month,m2=new Date(m1.getFullYear(),m1.getMonth()+1,1);
  $('#cal').innerHTML=monthHTML(m1)+monthHTML(m2);
  const cur=monthOf(today);$('#pm').disabled=m1<=cur;
  const un=unitById(A.unit);
  const ok=A.ci&&A.co;const q=ok?quote(un,A.ci,A.co,A.guests):null;
  $('#selbox').innerHTML='<div><small>Check-in</small><b>'+(A.ci?fmtL(A.ci):'-')+'</b></div><div><small>Check-out</small><b>'+(A.co?fmtL(A.co):'-')+'</b></div><div><small>Total Nights</small><b>'+(q?q.n:'-')+'</b></div><div><small>'+(LIVE?'Estimated Cost':'Total Cost')+'</small><b class="tot">'+(q?peso(q.total):peso(0))+'</b></div><button class="pill" data-act="proceed"'+(ok?'':' disabled')+'>Proceed to Book</button>';
  $('#brk').innerHTML=q?'<div class="sum">'+lines(q)+'<div class="row tot"><span>Total for '+q.n+(q.n===1?' night':' nights')+'</span><span>'+peso(q.total)+'</span></div></div>':'';
  $('#calmsg').textContent=A.msg||(A.ci&&!A.co?'Now pick your check-out day. Stay as many nights as you like; the price adds up per night.':(!A.ci?'Pick your check-in day. Each day shows its nightly rate.':''));
  renderBooking();
}
function pickDay(day){
  A.msg='';if(day<today)return;
  if(!A.ci||(A.ci&&A.co)){
    if(occupied(A.unit,day)){A.msg='That day is booked. Pick another check-in day.';renderCal();return}
    A.ci=day;A.co=null;
  }else if(day<=A.ci){
    if(occupied(A.unit,day)){A.msg='That day is booked. Pick another check-in day.';renderCal();return}
    A.ci=day;
  }else if(isFree(A.unit,A.ci,day)){A.co=day}
  else{A.msg='Some nights in that range are already booked. Pick a shorter stay.'}
  renderCal();
}

/* ---------- booking ---------- */
function renderBooking(){
  const un=unitById(A.unit);
  $('#l-rate').textContent='Unit '+un.id+': '+peso(un.price)+' per night'+(un.weekend!==un.price?' (Fri/Sat '+peso(un.weekend)+')':'');
  const ok=A.ci&&A.co;
  const showDone=$('#bk-done').getAttribute('data-on')==='1';
  $('#bk-empty').style.display=(!ok&&!showDone)?'block':'none';
  $('#bk-form').style.display=(ok&&!showDone)?'block':'none';
  $('#bk-done').style.display=showDone?'block':'none';
  if(!ok)return;
  const g=$('#d-g');const cur=A.guests;
  let o='';for(let i=1;i<=un.max;i++)o+='<option'+(i===Math.min(cur,un.max)?' selected':'')+'>'+i+'</option>';
  g.innerHTML=o;A.guests=Math.min(cur,un.max);
  const q=quote(un,A.ci,A.co,A.guests);
  $('#bk-sum').innerHTML='<div class="row"><span>Unit '+esc(un.id)+', '+esc(un.tower)+'</span><span>'+esc(un.beds)+'</span></div><div class="row"><span>'+fmt(A.ci)+' to '+fmt(A.co)+'</span><span>'+q.n+(q.n===1?' night':' nights')+'</span></div>'+lines(q)+'<div class="row tot"><span>'+(LIVE?'Estimated total':'Total')+'</span><span>'+peso(q.total)+'</span></div>';
}
function reserve(){return reserveApi()}
let busy=false,lastSent=0;
async function reserveApi(){
  if(busy)return;
  const un=unitById(A.unit),err=$('#d-err');
  const ci=A.ci,co=A.co;
  const name=$('#d-name').value.trim(),phone=$('#d-phone').value.trim(),email=$('#d-email').value.trim();
  const guests=Number($('#d-g').value);
  let e='';
  if(!un||!ci||!co||!validRange(ci,co))e='Pick your check-in and check-out days.';
  else if(!(guests>=1&&guests<=un.max))e='Choose the number of guests.';
  else if(name.length<2||name.length>80)e='Enter your full name.';
  else if(phone.replace(/\D/g,'').length<7||phone.length>25)e='Enter a mobile number we can reach you on.';
  else if(email.length>120||!/^\S+@\S+\.\S+$/.test(email))e='Enter a valid email address, like name@example.com.';
  else if(!$('#d-rules').checked)e='Accept the house rules to continue.';
  else if(Date.now()-lastSent<COOLDOWN)e='Your request was just sent. Please wait a few seconds before sending another.';
  else if(navigator.onLine===false)e='You appear to be offline. Check your connection and try again.';
  err.textContent=e;if(e)return;
  A.guests=guests;
  const btn=document.querySelector('[data-act="reserve"]');
  busy=true;btn.disabled=true;btn.textContent='Sending...';
  let r=null;
  try{r=await api('/api/bookings',{method:'POST',body:JSON.stringify({unit:un.id,ci:ci,co:co,guests:guests,name:name,phone:phone,email:email,rules:true,botcheck:!!($('#d-bot')&&$('#d-bot').checked)})})}catch(x){r=null}
  busy=false;btn.disabled=false;btn.textContent='Send booking request';
  if(!r){err.textContent='We could not reach our server. Check your connection and try again, or message us on 0985 060 0545.';return}
  if(r.status===409){
    await refreshAvail();A.ci=null;A.co=null;
    A.msg='Sorry, those dates were just taken by another guest. Please pick different dates.';
    err.textContent=A.msg;refreshAll();$('#availability').scrollIntoView();return;
  }
  if(r.status===422){const f=(r.body&&r.body.fields)||{};err.textContent=f[Object.keys(f)[0]]||'Please check your details and try again.';return}
  if(r.status===429){err.textContent='Too many requests from this device. Please wait a few minutes and try again, or message us on 0985 060 0545.';return}
  if(r.status!==201||!r.body||!r.body.code){err.textContent='Something went wrong on our side. Please try again, or message us on 0985 060 0545.';return}
  lastSent=Date.now();
  const b=r.body,hold=b.holdHours||24;
  const d=$('#bk-done');d.setAttribute('data-on','1');
  d.innerHTML='<h3>Request received</h3><p>Thanks, '+esc(name.split(' ')[0])+'. We got your request for Unit '+esc(un.id)+', '+fmt(ci)+' to '+fmt(co)+'. <b>This is not a confirmed booking yet.</b> We are holding these dates for you for '+esc(hold)+' hours while we check and reply on '+esc(phone)+' or '+esc(email)+'.</p><div>Your reference</div><div class="code">'+esc(b.code)+'</div><div class="sum"><div class="row"><span>Guests</span><span>'+guests+'</span></div><div class="row"><span>Check-in</span><span>'+fmt(ci)+', from 2:00 PM</span></div><div class="row"><span>Check-out</span><span>'+fmt(co)+', by 12:00 noon</span></div><div class="row tot"><span>Total</span><span>'+peso(b.total)+'</span></div></div><p class="msg">Questions? Call or WhatsApp 0985 060 0545.</p><button class="pill" data-act="another">Request another stay</button>';
  A.ci=null;A.co=null;
  $('#d-name').value='';$('#d-phone').value='';$('#d-email').value='';$('#d-rules').checked=false;
  await refreshAvail();refreshAll();
}

function openInq(){
  const ok=validRange(search.ci,search.co);
  $('#dl').innerHTML='<div class="hd"><h2 id="dlg-t">Group inquiry</h2><button class="x" data-act="close" aria-label="Close">&times;</button></div>'+
  '<p style="color:var(--muted);margin:0 0 12px">Booking for more than 4 guests? Tell us your dates and group size and we will reply with a quote.</p>'+
  '<div class="form"><div class="two"><div class="fld"><label for="q-name">Full name</label><input id="q-name" autocomplete="name" maxlength="80"></div><div class="fld"><label for="q-g">Number of guests</label><input id="q-g" type="number" min="5" max="100" value="5" inputmode="numeric"></div></div>'+
  '<div class="two"><div class="fld"><label for="q-phone">Mobile number</label><input id="q-phone" type="tel" autocomplete="tel" maxlength="25"></div><div class="fld"><label for="q-email">Email</label><input id="q-email" type="email" autocomplete="email" maxlength="120"></div></div>'+
  '<div class="two"><div class="fld"><label for="q-ci">Check-in</label><input id="q-ci" type="date" min="'+today+'" value="'+(ok?search.ci:'')+'"></div><div class="fld"><label for="q-co">Check-out</label><input id="q-co" type="date" min="'+today+'" value="'+(ok?search.co:'')+'"></div></div>'+
  '<div class="fld"><label for="q-msg">Message (optional)</label><textarea id="q-msg" rows="3" maxlength="1000"></textarea></div>'+
  '<input type="checkbox" id="q-bot" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">'+
  '<div class="err" id="q-err" role="alert"></div><button class="pill" id="q-go" data-act="send-inq" style="width:100%">Send inquiry</button></div>';
  if(!$('#dlg').open)$('#dlg').showModal();
}
async function sendInq(){
  const g=id=>$('#'+id).value.trim();
  const name=g('q-name'),phone=g('q-phone'),email=g('q-email'),ci=$('#q-ci').value,co=$('#q-co').value,n=Number($('#q-g').value),msg=g('q-msg');
  const err=$('#q-err');let e='';
  if(name.length<2||name.length>80)e='Enter your full name.';
  else if(phone.replace(/\D/g,'').length<7||phone.length>25)e='Enter a mobile number we can reach you on.';
  else if(email.length>120||!/^\S+@\S+\.\S+$/.test(email))e='Enter a valid email address, like name@example.com.';
  else if(!ci||!co||co<=ci||ci<today)e='Choose a check-in date and a later check-out date.';
  else if(!(n>=5&&n<=100))e='Enter the number of guests (5 to 100).';
  else if(msg.length>1000)e='Your message is too long. Please shorten it.';
  err.textContent=e;if(e)return;
  const btn=$('#q-go');btn.disabled=true;btn.textContent='Sending...';
  let r=null;
  try{r=await api('/api/inquiries',{method:'POST',body:JSON.stringify({name:name,phone:phone,email:email,ci:ci,co:co,guests:n,message:msg,botcheck:!!$('#q-bot').checked})})}catch(x){r=null}
  if(r&&r.status===201){$('#dl').innerHTML='<div class="hd"><h2 id="dlg-t">Inquiry sent</h2><button class="x" data-act="close" aria-label="Close">&times;</button></div><p>Thanks, '+esc(name.split(' ')[0])+'. We got your group inquiry for '+fmt(ci)+' to '+fmt(co)+' and will reply to '+esc(email)+'.</p><button class="pill" data-act="close">Done</button>';return}
  btn.disabled=false;btn.textContent='Send inquiry';
  err.textContent=r&&r.status===429?'Too many inquiries from this device. Please wait a while, or call or WhatsApp 0985 060 0545.':r&&r.status===422?'Please check your details and try again.':'We could not send this from here. Please call or WhatsApp 0985 060 0545 instead.';
}

/* ---------- wiring ---------- */
function updBadge(){const m=Math.min.apply(null,db.units.map(x=>x.price));$('#pbadge').innerHTML='From <b>'+peso(m)+'</b> / night'}
function refreshAll(){updBadge();renderProps();renderCal();syncUrl();}
function syncInputs(){$('#s-ci').value=search.ci||'';$('#s-co').value=search.co||'';$('#s-g').value=String(search.guests);$('#s-ci').min=today;$('#s-co').min=search.ci||today}
function hostOff(){}
$('#s-ci').addEventListener('change',e=>{urlOn=true;search.ci=e.target.value;if(search.ci&&(!search.co||search.co<=search.ci))search.co=addDays(search.ci,1);syncInputs();applySearchToA();refreshAll()});
$('#s-co').addEventListener('change',e=>{urlOn=true;search.co=e.target.value;applySearchToA();refreshAll()});
$('#s-g').addEventListener('change',e=>{urlOn=true;search.guests=Number(e.target.value);applySearchToA();refreshAll()});
$('#f-tower').addEventListener('change',renderProps);
$('#f-sort').addEventListener('change',renderProps);
$('#f-saved').addEventListener('change',renderProps);
$('#a-unit').addEventListener('change',e=>{A.unit=e.target.value;A.ci=null;A.co=null;A.msg='';applySearchToA();renderCal()});
$('#d-g').addEventListener('change',e=>{A.guests=Number(e.target.value);renderBooking()});
$('#menu-btn').addEventListener('click',()=>{const o=$('#nav').classList.toggle('open');$('#menu-btn').setAttribute('aria-expanded',String(o))});
$('#dlg').addEventListener('click',e=>{if(e.target===$('#dlg'))$('#dlg').close()});
$('#lb').addEventListener('click',e=>{if(e.target===$('#lb'))$('#lb').close()});

function goBook(id){
  A.unit=id;A.ci=null;A.co=null;A.msg='';
  $('#bk-done').setAttribute('data-on','0');
  applySearchToA();renderAUnits();renderCal();
  if($('#dlg').open)$('#dlg').close();
  hostOff();$('#availability').scrollIntoView();
}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-act],[data-save],[data-view],[data-book],[data-day],[data-photo],[data-tab],[data-slide],[data-nav]');
  if(!t)return;
  if(t.hasAttribute('data-nav')){hostOff();$('#nav').classList.remove('open');$('#menu-btn').setAttribute('aria-expanded','false');return}
  if(t.hasAttribute('data-day')){pickDay(t.getAttribute('data-day'));return}
  if(t.hasAttribute('data-save')){toggleSaved(t.getAttribute('data-save'));return}
  if(t.hasAttribute('data-view')){viewUnit(t.getAttribute('data-view'));return}
  if(t.hasAttribute('data-book')){goBook(t.getAttribute('data-book'));return}
  if(t.hasAttribute('data-photo')){$('#lb-img').src=IMG[t.getAttribute('data-photo')];$('#lb-img').alt=t.getAttribute('data-alt')||'';$('#lb').showModal();return}
  if(t.hasAttribute('data-tab')){renderRules(t.getAttribute('data-tab'));return}
  if(t.hasAttribute('data-slide')){go(Number(t.getAttribute('data-slide')));return}
  switch(t.getAttribute('data-act')){
    case 'open-inq':e.preventDefault();openInq();break;
    case 'send-inq':sendInq();break;
    case 'close':$('#dlg').close();break;
    case 'close-lb':$('#lb').close();break;
    case 'retry-load':boot();break;
    case 'car-prev':go(slide-1);break;
    case 'car-next':go(slide+1);break;
    case 'search':urlOn=true;applySearchToA();refreshAll();$('#properties').scrollIntoView();break;
    case 'prevm':A.month=new Date(A.month.getFullYear(),A.month.getMonth()-1,1);renderCal();break;
    case 'nextm':A.month=new Date(A.month.getFullYear(),A.month.getMonth()+1,1);renderCal();break;
    case 'proceed':if(A.ci&&A.co){$('#bk-done').setAttribute('data-on','0');renderBooking();$('#booking').scrollIntoView()}break;
    case 'reserve':reserve();break;
    case 'another':$('#bk-done').setAttribute('data-on','0');$('#availability').scrollIntoView();renderCal();break;
  }
});

function liveInit(){
  document.querySelectorAll('[data-act="host-on"],[data-act="open-my"]').forEach(x=>x.remove());
  const q=s=>document.querySelector(s);
  const lg=q('.avail .legend');
  if(lg)lg.innerHTML='<span><i style="background:color-mix(in srgb,var(--ok) 9%,var(--card))"></i>Available</span><span><i style="background:color-mix(in srgb,var(--bad) 14%,var(--card))"></i>Taken or on hold</span><span><i style="background:var(--y)"></i>Selected</span><span><i style="background:transparent;opacity:.5"></i>Past Date</span>';
  const ah=q('#availability .head p');if(ah)ah.textContent='Pick your preferred dates and send a booking request. Dates held by other guests show as taken. Your request is not a confirmed booking until our team replies.';
  const bh=q('#booking .head p');if(bh)bh.textContent='Request your stay directly with us.';
  const h3=q('#bk-form h3');if(h3)h3.textContent='Request your stay';
  const rb=q('[data-act="reserve"]');
  if(rb){rb.textContent='Send booking request';rb.insertAdjacentHTML('beforebegin','<p class="hint">This is a booking request. It is confirmed only after our team replies to you.</p><input type="checkbox" id="d-bot" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">')}
}
async function api(path,opts){
  const o=Object.assign({credentials:'same-origin'},opts||{});
  if(o.body)o.headers=Object.assign({'Content-Type':'application/json'},o.headers||{});
  const ctl=new AbortController(),to=setTimeout(()=>ctl.abort(),15000);
  try{
    const r=await fetch(path,Object.assign(o,{signal:ctl.signal}));
    let body=null;try{body=await r.json()}catch(x){}
    return {status:r.status,ok:r.ok,body:body};
  }finally{clearTimeout(to)}
}
async function refreshAvail(){
  try{
    const a=await api('/api/availability?from='+today+'&to='+addDays(today,400));
    if(a.ok&&a.body&&Array.isArray(a.body.busy)){db.bookings=a.body.busy.map(b=>({unit:b.unit,ci:b.ci,co:b.co,status:b.status}));return true}
  }catch(x){}
  return false;
}
let booted=false;
async function boot(){
  $('#grid').innerHTML='<div class="empty" role="status">Loading units...</div>';$('#cnt').textContent='';
  try{
    const u=await api('/api/units');
    if(!u.ok||!u.body||!Array.isArray(u.body.units)||!u.body.units.length)throw new Error('units');
    db.units=u.body.units;db.rules=u.body.rules||[];
    if(!(await refreshAvail()))throw new Error('availability');
  }catch(x){
    $('#grid').innerHTML='<div class="empty">We could not load our units right now. Please check your connection.<br><button class="pill" style="margin-top:12px" data-act="retry-load">Try again</button><br><span style="font-size:.85rem">Or call or WhatsApp 0985 060 0545.</span></div>';
    return;
  }
  A.unit=(db.units.find(x=>x.id==='595')||db.units[0]).id;
  renderFilters();syncInputs();A.month=monthOf(search.ci);applySearchToA();renderAUnits();refreshAll();booted=true;
}
/* keep availability fresh while the page is open, and drop a selection another guest just took */
async function keepFresh(){
  if(!booted||document.hidden)return;
  if(!(await refreshAvail()))return;
  if(A.ci&&A.co&&!isFree(A.unit,A.ci,A.co)){A.ci=null;A.co=null;A.msg='Those dates were just taken by another guest. Please pick different dates.'}
  refreshAll();
}
setInterval(keepFresh,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)keepFresh()});
liveInit();
renderStatic();buildCarousel();syncInputs();
boot();
})();
