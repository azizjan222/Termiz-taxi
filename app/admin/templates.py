"""HTML templates for admin panel (plain Python strings with .format())."""

BOOTSTRAP_CSS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css"
BOOTSTRAP_JS = "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"

BASE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title} - Sarix Go Admin</title>
<link rel="stylesheet" href="{bootstrap_css}">
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }}
.sidebar {{ min-height: 100vh; background: #212529; }}
.sidebar a {{ color: #adb5bd; text-decoration: none; padding: 10px 20px; display: block; }}
.sidebar a:hover, .sidebar a.active {{ color: #fff; background: #343a40; }}
.main-content {{ padding: 20px; }}
.stat-card {{ border-radius: 10px; padding: 20px; color: #fff; }}
.logout-button {{ color: #adb5bd; background: transparent; border: 0; padding: 10px 20px; width: 100%; text-align: left; }}
.logout-button:hover {{ color: #fff; background: #343a40; }}
</style>
</head>
<body>
<div class="container-fluid">
<div class="row">
<nav class="col-md-2 sidebar p-0">
<div class="p-3 text-white fw-bold">Sarix Go Admin</div>
{nav}
<hr class="text-secondary">
<form method="POST" action="/admin/logout" id="logout-form">
<input type="hidden" name="csrf_token" value="{csrf_token}">
<button type="submit" class="logout-button">Chiqish</button>
</form>
</nav>
<main class="col-md-10 main-content">
{content}
</main>
</div>
</div>
<script src="{bootstrap_js}"></script>
<script>
function adminCookie(name){{
  const prefix=name+'=';
  const part=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix));
  return part?decodeURIComponent(part.slice(prefix.length)):'';
}}
const originalFetch=window.fetch.bind(window);
window.fetch=function(input,init){{
  const opts=Object.assign({{}},init||{{}});
  const method=String(opts.method||(input instanceof Request?input.method:'GET')).toUpperCase();
  const url=new URL(input instanceof Request?input.url:String(input),window.location.href);
  const sameOrigin=url.origin===window.location.origin;
  if(!['GET','HEAD','OPTIONS'].includes(method)&&sameOrigin){{
    const headers=new Headers(opts.headers||(input instanceof Request?input.headers:undefined));
    headers.set('X-CSRF-Token',adminCookie('admin_csrf'));
    opts.headers=headers;
  }}
  // An expired session answers every API call with 401 JSON. Each page then tried to
  // iterate that error object, threw, and left the table stuck on "..." with no hint that
  // the admin had simply been logged out. Send them back to the login form instead.
  return originalFetch(input,opts).then(function(res){{
    if(res.status===401&&sameOrigin&&url.pathname.indexOf('/admin/')===0){{
      window.location.href='/admin/login';
    }}
    return res;
  }});
}};
document.addEventListener('DOMContentLoaded',()=>{{
  // The token is rendered server-side; this only refreshes it if the cookie was rotated
  // after the page was served. Logout must not depend on JS running at all.
  const field=document.querySelector('#logout-form input[name="csrf_token"]');
  const cookie=adminCookie('admin_csrf');
  if(field&&cookie)field.value=cookie;
}});
// `if(!s)` also swallowed 0 and false, so any numeric column routed through esc()
// rendered blank for a legitimate zero.
// Single quote and backtick are escaped too: every attribute here is double-quoted today,
// so they were not strictly needed — but that made the escaper silently useless the moment
// anyone wrote value='${{esc(x)}}'.
function esc(s){{if(s===null||s===undefined)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/`/g,'&#96;');}}
// Every timestamp from the API is now an explicit UTC instant (…+00:00). Render it in
// Tashkent time, not the raw ISO string: the panel used to print UTC with microseconds,
// i.e. 5 hours behind, with nothing saying so.
function fmtDt(v){{
  if(!v)return '';
  const d=new Date(v);
  if(isNaN(d.getTime()))return String(v).replace('T',' ').split('.')[0];
  const p=new Intl.DateTimeFormat('ru-RU',{{timeZone:'Asia/Tashkent',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}}).formatToParts(d);
  const g=t=>(p.find(x=>x.type===t)||{{}}).value||'';
  return `${{g('year')}}-${{g('month')}}-${{g('day')}} ${{g('hour')}}:${{g('minute')}}`;
}}
// Money/quantity formatter shared by every page.
function fmtNum(n){{return (Number(n)||0).toLocaleString('ru-RU').replace(/\\u00a0/g,' ');}}
// A rating only means something once somebody has rated. `d.rating||5` reported an
// unrated driver as a perfect 5.
function fmtRating(rating,count){{return (count>0&&rating!=null)?Number(rating).toFixed(1):'—';}}
// Shared pager. Every list endpoint now returns {{items,total,page,per_page}} instead of
// the whole table: loading every driver and every user into the browser and filtering in JS
// was fine at a few hundred rows and unusable at ten thousand.
function renderPager(elId,d,onGo){{
  const el=document.getElementById(elId);
  if(!el)return;
  const total=Number(d.total)||0, per=Number(d.per_page)||50, page=Number(d.page)||1;
  const pages=Math.max(1,Math.ceil(total/per));
  if(total===0){{el.innerHTML='';return;}}
  const from=(page-1)*per+1, to=Math.min(page*per,total);
  el.innerHTML=`<div class="d-flex align-items-center gap-2">
    <button class="btn btn-sm btn-outline-secondary" ${{page<=1?'disabled':''}} data-go="${{page-1}}">‹ Oldingi</button>
    <span class="text-muted small">${{from}}–${{to}} / ${{total}} (${{page}}/${{pages}}-sahifa)</span>
    <button class="btn btn-sm btn-outline-secondary" ${{page>=pages?'disabled':''}} data-go="${{page+1}}">Keyingi ›</button>
  </div>`;
  el.querySelectorAll('button[data-go]').forEach(b=>{{
    b.onclick=()=>onGo(Number(b.getAttribute('data-go')));
  }});
}}
// Debounce so typing in a search box does not fire a request per keystroke.
function debounce(fn,ms){{let t;return function(){{clearTimeout(t);t=setTimeout(fn,ms||350);}};}}
// Shared error banner: every page used to fail silently in the console.
function adminError(msg){{
  const main=document.querySelector('.main-content');
  if(!main)return;
  let box=document.getElementById('admin-error-box');
  if(!box){{
    box=document.createElement('div');
    box.id='admin-error-box';
    box.className='alert alert-danger';
    main.prepend(box);
  }}
  box.textContent=msg||'Ma\\'lumotni yuklashda xatolik. Sahifani yangilang.';
}}
</script>
{extra_js}
</body>
</html>"""

LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Login - Sarix Go Admin</title>
<link rel="stylesheet" href="{bootstrap_css}">
</head>
<body class="bg-light">
<div class="container">
<div class="row justify-content-center mt-5">
<div class="col-md-4">
<div class="card shadow">
<div class="card-body p-4">
<h4 class="text-center mb-4">Sarix Go Admin</h4>
{error}
<form method="POST" action="/admin/login">
<input type="hidden" name="csrf_token" value="{csrf_token}">
<div class="mb-3">
<label class="form-label">Login</label>
<input type="text" name="username" class="form-control" required autofocus>
</div>
<div class="mb-3">
<label class="form-label">Parol</label>
<input type="password" name="password" class="form-control" required>
</div>
<button type="submit" class="btn btn-primary w-100">Kirish</button>
</form>
</div>
</div>
</div>
</div>
</div>
</body>
</html>"""

DASHBOARD_HTML = """<h2>Dashboard</h2>
<div class="row g-3 mb-4" id="stats-row">
<div class="col-md-3"><div class="stat-card bg-primary"><h6>Haydovchilar</h6><h3 id="s-drivers">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-success"><h6>Yo'lovchilar</h6><h3 id="s-passengers">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-info"><h6>Buyurtmalar</h6><h3 id="s-orders">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-warning"><h6>Faol buyurtmalar</h6><h3 id="s-active">...</h3></div></div>
</div>
<div class="row g-3 mb-4">
<div class="col-md-3"><div class="stat-card bg-dark"><h6>Online haydovchilar</h6><h3 id="s-online">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-secondary"><h6>Bugungi daromad</h6><h3 id="s-rev-today">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-danger"><h6>Oylik daromad</h6><h3 id="s-rev-month">...</h3></div></div>
</div>
<h4 class="mt-4">Top 10 haydovchilar (zakaslar bo'yicha)</h4>
<div class="table-responsive">
<table class="table table-sm table-striped" id="top-drivers-table">
<thead><tr><th>#</th><th>Ism</th><th>Telefon</th><th>Zakaslar</th><th>Reyting</th><th>Holat</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

DASHBOARD_JS = """<script>
fetch('/admin/api/stats').then(r=>r.json()).then(d=>{
if(!d||d.error||d.drivers_count===undefined){adminError(d&&d.error?d.error:'Statistikani yuklab bo\\'lmadi');return;}
document.getElementById('s-drivers').textContent=d.drivers_count;
document.getElementById('s-passengers').textContent=d.passengers_count;
document.getElementById('s-orders').textContent=d.orders_count;
document.getElementById('s-active').textContent=d.active_orders;
document.getElementById('s-online').textContent=d.online_drivers;
document.getElementById('s-rev-today').textContent=fmtNum(d.revenue_today)+" so'm";
document.getElementById('s-rev-month').textContent=fmtNum(d.revenue_month)+" so'm";
}).catch(e=>{console.error(e);adminError('Statistikani yuklab bo\\'lmadi');});
fetch('/admin/api/top-drivers').then(r=>r.json()).then(data=>{
const tb=document.querySelector('#top-drivers-table tbody');
tb.innerHTML='';
if(!(Array.isArray(data)&&data.length))tb.innerHTML='<tr><td colspan="6" class="text-muted">Ma\\'lumot yo\\'q</td></tr>';
(Array.isArray(data)?data:[]).forEach((d,i)=>{
const online=d.is_online?'<span class="badge bg-info">Online</span>':'<span class="badge bg-secondary">Oflayn</span>';
const flags=(d.is_blocked?'<span class="badge bg-danger">🚫</span> ':'')+(d.is_verified?'':'<span class="badge bg-warning">tasdiqlanmagan</span> ');
tb.innerHTML+=`<tr><td>${i+1}</td><td>${flags}${esc((d.first_name||'')+' '+(d.last_name||''))}</td><td>${esc(d.phone||'')}</td><td>${fmtNum(d.total_orders)}</td><td>${fmtRating(d.rating,d.rating_count)}</td><td>${online}</td></tr>`;
});
}).catch(e=>{console.error(e);adminError('Top haydovchilarni yuklab bo\\'lmadi');});
</script>"""

STATISTICS_HTML = """<h2>📊 Statistika</h2>
<p class="text-muted">Foydalanuvchilar o'sishi, faollik va hududlar bo'yicha tahlil</p>

<h5 class="mt-3">🆕 Yangi foydalanuvchilar (yo'lovchilar) — ro'yxatdan o'tganlar</h5>
<div class="row g-3 mb-3">
<div class="col-md-3"><div class="stat-card bg-primary"><h6>So'nggi 24 soat</h6><h3 id="nu-day">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-info"><h6>So'nggi 7 kun</h6><h3 id="nu-week">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-success"><h6>So'nggi 30 kun</h6><h3 id="nu-month">...</h3></div></div>
<div class="col-md-3"><div class="stat-card bg-dark"><h6>So'nggi 1 yil</h6><h3 id="nu-year">...</h3></div></div>
</div>
<p class="text-muted small">Jami yo'lovchilar: <b id="nu-total">...</b> · Jami haydovchilar: <b id="nd-total">...</b></p>

<h5 class="mt-4">🔥 Faol foydalanuvchilar — ilovadan haqiqatda foydalanganlar</h5>
<div class="row g-3 mb-3">
<div class="col-md-3"><div class="stat-card bg-primary"><h6>Kunlik faol (DAU)</h6><h3 id="au-day">...</h3><small>so'nggi 24 soat</small></div></div>
<div class="col-md-3"><div class="stat-card bg-info"><h6>Haftalik faol (WAU)</h6><h3 id="au-week">...</h3><small>so'nggi 7 kun</small></div></div>
<div class="col-md-3"><div class="stat-card bg-success"><h6>Oylik faol (MAU)</h6><h3 id="au-month">...</h3><small>so'nggi 30 kun</small></div></div>
<div class="col-md-3"><div class="stat-card bg-dark"><h6>Yillik faol</h6><h3 id="au-year">...</h3><small>so'nggi 1 yil</small></div></div>
</div>
<p class="text-muted small">Faol haydovchilar — kunlik: <b id="ad-day">...</b> · haftalik: <b id="ad-week">...</b> · oylik: <b id="ad-month">...</b></p>

<div class="row">
<div class="col-md-8">
<div class="card mb-3"><div class="card-body">
<h6>📈 Kunlik yangi foydalanuvchilar (so'nggi 30 kun)</h6>
<canvas id="chart-daily" height="110"></canvas>
</div></div>
</div>
<div class="col-md-4">
<div class="card mb-3"><div class="card-body">
<h6>🧩 Buyurtma holatlari</h6>
<canvas id="chart-status" height="220"></canvas>
</div></div>
</div>
</div>

<div class="row">
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>📅 Oylik o'sish (so'nggi 12 oy)</h6>
<canvas id="chart-monthly" height="170"></canvas>
</div></div>
</div>
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>🕐 Faollik soatlari — qaysi soatda ko'p buyurtma berilgan</h6>
<canvas id="chart-hours" height="170"></canvas>
</div></div>
</div>
</div>

<div class="row">
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>🗓️ Hafta kunlari bo'yicha faollik — eng band kun</h6>
<canvas id="chart-weekday" height="170"></canvas>
</div></div>
</div>
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>💎 Mijozlar sodiqligi</h6>
<canvas id="chart-loyalty" height="170"></canvas>
<p class="text-muted small mt-2 mb-0">Takroriy mijozlar = bir martadan ko'p buyurtma berganlar. Bu ko'rsatkich qanchalik yuqori bo'lsa, ilova shunchalik "yopishqoq" (sodiqlik kuchli).</p>
</div></div>
</div>
</div>

<h5 class="mt-2">💰 Moliyaviy va sodiqlik ko'rsatkichlari</h5>
<div class="row g-3 mb-4">
<div class="col-md-3"><div class="stat-card bg-success"><h6>Umumiy aylanma (GMV)</h6><h3 id="fin-gmv">...</h3><small>yakunlangan buyurtmalar</small></div></div>
<div class="col-md-3"><div class="stat-card bg-primary"><h6>O'rtacha buyurtma summasi</h6><h3 id="fin-aov">...</h3><small>so'm</small></div></div>
<div class="col-md-3"><div class="stat-card bg-info"><h6>Takroriy mijozlar</h6><h3 id="fin-repeat">...</h3><small id="fin-repeat-rate"></small></div></div>
<div class="col-md-3"><div class="stat-card bg-dark"><h6>Jami unikal mijozlar</h6><h3 id="fin-distinct">...</h3><small>buyurtma berganlar</small></div></div>
</div>

<div class="row">
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>🏙️ Eng faol tumanlar/shaharlar (jo'nash joyi bo'yicha)</h6>
<canvas id="chart-districts" height="200"></canvas>
<table class="table table-sm mt-3" id="districts-table"><thead><tr><th>#</th><th>Tuman / Shahar</th><th>Buyurtmalar</th></tr></thead><tbody></tbody></table>
</div></div>
</div>
<div class="col-md-6">
<div class="card mb-3"><div class="card-body">
<h6>🛣️ Top yo'nalishlar</h6>
<table class="table table-sm" id="routes-stat-table"><thead><tr><th>#</th><th>Yo'nalish</th><th>Soni</th></tr></thead><tbody></tbody></table>
<h6 class="mt-3">🚕 Xizmat turlari</h6>
<canvas id="chart-services" height="140"></canvas>
</div></div>
</div>
</div>

<div class="row g-3 mb-4">
<div class="col-md-3"><div class="stat-card bg-success"><h6>Yakunlangan buyurtmalar</h6><h3 id="sum-completed">...</h3><small id="sum-completion-rate"></small></div></div>
<div class="col-md-3"><div class="stat-card bg-danger"><h6>Bekor qilingan</h6><h3 id="sum-cancelled">...</h3><small id="sum-cancel-rate"></small></div></div>
<div class="col-md-3"><div class="stat-card bg-warning"><h6>O'rtacha haydovchi reytingi</h6><h3 id="sum-rating">...</h3><small id="sum-rating-note">5 yulduzdan</small></div></div>
<div class="col-md-3"><div class="stat-card bg-secondary"><h6>Yangi haydovchilar (30 kun)</h6><h3 id="sum-new-drivers">...</h3></div></div>
</div>"""

STATISTICS_JS = """<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<script>
const _fmt=n=>(Number(n)||0).toLocaleString();
const STATUS_LABELS={completed:'Yakunlangan',cancelled:'Bekor qilingan',new:'Yangi',accepted:'Qabul qilingan',in_progress:'Jarayonda',expired:'Muddati o\\'tgan',unknown:'Nomalum'};
const SERVICE_LABELS={taxi:'Taksi',parcel:'Pochta',full_car:'To\\'liq mashina'};
const PALETTE=['#0d6efd','#198754','#dc3545','#ffc107','#0dcaf0','#6610f2','#fd7e14','#20c997','#6c757d','#d63384'];
let _charts={};
function _mkChart(id,cfg){
  const el=document.getElementById(id);
  if(!el||typeof Chart==='undefined')return;
  if(_charts[id])_charts[id].destroy();
  _charts[id]=new Chart(el,cfg);
}
fetch('/admin/api/statistics').then(r=>r.json()).then(d=>{
  // Guard the shape before touching nested fields: on an error payload the very first
  // `d.new_users.day` threw, every card stayed on "..." and the only trace was in the
  // browser console.
  if(!d||d.error||!d.new_users){adminError(d&&d.error?d.error:'Statistikani yuklab bo\\'lmadi');return;}
  // ----- New users cards -----
  document.getElementById('nu-day').textContent=_fmt(d.new_users.day);
  document.getElementById('nu-week').textContent=_fmt(d.new_users.week);
  document.getElementById('nu-month').textContent=_fmt(d.new_users.month);
  document.getElementById('nu-year').textContent=_fmt(d.new_users.year);
  document.getElementById('nu-total').textContent=_fmt(d.new_users.total);
  document.getElementById('nd-total').textContent=_fmt(d.new_drivers.total);
  // ----- Active users cards -----
  document.getElementById('au-day').textContent=_fmt(d.active.dau);
  document.getElementById('au-week').textContent=_fmt(d.active.wau);
  document.getElementById('au-month').textContent=_fmt(d.active.mau);
  document.getElementById('au-year').textContent=_fmt(d.active.yau);
  document.getElementById('ad-day').textContent=_fmt(d.active.driver_dau);
  document.getElementById('ad-week').textContent=_fmt(d.active.driver_wau);
  document.getElementById('ad-month').textContent=_fmt(d.active.driver_mau);
  // ----- Summary cards -----
  document.getElementById('sum-completed').textContent=_fmt(d.completed_orders);
  document.getElementById('sum-completion-rate').textContent='Konversiya: '+(d.completion_rate??0)+'%';
  document.getElementById('sum-cancelled').textContent=_fmt(d.cancelled_orders);
  document.getElementById('sum-cancel-rate').textContent=(d.cancellation_rate??0)+'% bekor';
  // Averaged over rated drivers only — the old number averaged the 5.0 default too.
  document.getElementById('sum-rating').textContent=d.rated_drivers>0?Number(d.avg_driver_rating||0).toFixed(2):'—';
  const ratedNote=document.getElementById('sum-rating-note');
  if(ratedNote)ratedNote.textContent=d.rated_drivers>0?(_fmt(d.rated_drivers)+' ta baholangan haydovchi'):'hali baholanmagan';
  document.getElementById('sum-new-drivers').textContent=_fmt(d.new_drivers.month);

  // ----- Daily new users (line) -----
  // `||[]` on every series: a partial payload used to throw here and leave the rest of
  // the page frozen on "...".
  d.daily_new_users=d.daily_new_users||[];d.monthly_new_users=d.monthly_new_users||[];d.orders_by_hour=d.orders_by_hour||[];
  _mkChart('chart-daily',{type:'line',data:{labels:d.daily_new_users.map(x=>String(x.date||'').slice(5)),datasets:[{label:'Yangi foydalanuvchilar',data:d.daily_new_users.map(x=>x.count),borderColor:'#0d6efd',backgroundColor:'rgba(13,110,253,.15)',fill:true,tension:.3,pointRadius:2}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});

  // ----- Monthly growth (bar) -----
  _mkChart('chart-monthly',{type:'bar',data:{labels:d.monthly_new_users.map(x=>x.month),datasets:[{label:'Yangi foydalanuvchilar',data:d.monthly_new_users.map(x=>x.count),backgroundColor:'#198754'}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});

  // ----- Hours (bar) -----
  _mkChart('chart-hours',{type:'bar',data:{labels:d.orders_by_hour.map(x=>x.hour+':00'),datasets:[{label:'Buyurtmalar',data:d.orders_by_hour.map(x=>x.count),backgroundColor:'#fd7e14'}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});

  // ----- Weekday activity (bar) -----
  _mkChart('chart-weekday',{type:'bar',data:{labels:(d.orders_by_weekday||[]).map(x=>x.day),datasets:[{label:'Buyurtmalar',data:(d.orders_by_weekday||[]).map(x=>x.count),backgroundColor:'#20c997'}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}}});

  // ----- Loyalty (doughnut: repeat vs one-time) -----
  _mkChart('chart-loyalty',{type:'doughnut',data:{labels:['Takroriy mijozlar','Bir martalik'],datasets:[{data:[d.repeat_customers||0,d.one_time_customers||0],backgroundColor:['#198754','#adb5bd']}]},options:{plugins:{legend:{position:'bottom'}}}});

  // ----- Financial / loyalty cards -----
  document.getElementById('fin-gmv').textContent=_fmt(d.total_gmv)+" so'm";
  document.getElementById('fin-aov').textContent=_fmt(d.avg_order_value);
  document.getElementById('fin-repeat').textContent=_fmt(d.repeat_customers);
  document.getElementById('fin-repeat-rate').textContent='Sodiqlik: '+(d.repeat_rate||0)+'%';
  document.getElementById('fin-distinct').textContent=_fmt(d.distinct_customers);

  // ----- Status (doughnut) -----
  const stK=Object.keys(d.order_status||{});
  _mkChart('chart-status',{type:'doughnut',data:{labels:stK.map(k=>STATUS_LABELS[k]||k),datasets:[{data:stK.map(k=>d.order_status[k]),backgroundColor:PALETTE}]},options:{plugins:{legend:{position:'bottom'}}}});

  // ----- Services (doughnut) -----
  const svK=Object.keys(d.service_types||{});
  _mkChart('chart-services',{type:'doughnut',data:{labels:svK.map(k=>SERVICE_LABELS[k]||k),datasets:[{data:svK.map(k=>d.service_types[k]),backgroundColor:PALETTE}]},options:{plugins:{legend:{position:'bottom'}}}});

  // ----- Districts (horizontal bar + table) -----
  d.districts=d.districts||[];d.top_routes=d.top_routes||[];
  _mkChart('chart-districts',{type:'bar',data:{labels:d.districts.map(x=>x.name),datasets:[{label:'Buyurtmalar',data:d.districts.map(x=>x.count),backgroundColor:'#6610f2'}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}}}}});
  const dtb=document.querySelector('#districts-table tbody');dtb.innerHTML='';
  if(!d.districts.length)dtb.innerHTML='<tr><td colspan="3" class="text-muted">Hozircha ma\\'lumot yo\\'q</td></tr>';
  d.districts.forEach((x,i)=>{dtb.innerHTML+=`<tr><td>${i+1}</td><td>${esc(x.name)}</td><td>${_fmt(x.count)}</td></tr>`;});

  // ----- Top routes (table) -----
  const rtb=document.querySelector('#routes-stat-table tbody');rtb.innerHTML='';
  if(!d.top_routes.length)rtb.innerHTML='<tr><td colspan="3" class="text-muted">Hozircha ma\\'lumot yo\\'q</td></tr>';
  d.top_routes.forEach((x,i)=>{rtb.innerHTML+=`<tr><td>${i+1}</td><td>${esc(x.route)}</td><td>${_fmt(x.count)}</td></tr>`;});
}).catch(e=>{console.error(e);adminError('Statistikani yuklab bo\\'lmadi');});
</script>"""

DRIVERS_HTML = """<h2>Haydovchilar</h2>
<div class="mb-3">
<button class="btn btn-primary" type="button" data-bs-toggle="collapse" data-bs-target="#new-driver-form">➕ Yangi haydovchi</button>
</div>
<div class="collapse mb-3" id="new-driver-form">
<div class="card card-body">
<h5>Yangi haydovchi qo'shish</h5>
<div class="row g-2">
<div class="col-md-3"><input class="form-control" id="nd-phone" placeholder="Telefon * (+998...)"></div>
<div class="col-md-3"><input class="form-control" id="nd-first" placeholder="Ism"></div>
<div class="col-md-3"><input class="form-control" id="nd-last" placeholder="Familiya"></div>
<div class="col-md-3"><input class="form-control" id="nd-pinfl" placeholder="JSHSHIR (14 raqam)"></div>
<div class="col-md-3"><input class="form-control" id="nd-carnum" placeholder="Mashina raqami"></div>
<div class="col-md-3"><input class="form-control" id="nd-model" placeholder="Modeli" list="car-models-list"></div>
<div class="col-md-3"><input class="form-control" id="nd-year" placeholder="Yili (masalan 2018)"></div>
<div class="col-md-3"><input class="form-control" id="nd-tgid" placeholder="Telegram ID (ixtiyoriy)"></div>
</div>
<datalist id="car-models-list"></datalist>
<div class="mt-2">
<button class="btn btn-success" onclick="createDriver()">Saqlash</button>
<span class="ms-2" id="nd-result"></span>
</div>
<small class="text-muted mt-1">Haydovchi <b>hujjat yubormagan</b> holatida yaratiladi va
"Hujjat yubormagan" filtrida ko'rinadi. U ilovada hujjatlarni yuklagach "Kutilmoqda"ga o'tadi —
shundan keyin tasdiqlashingiz mumkin.</small>
</div>
</div>
<div class="mb-3">
<input type="text" class="form-control w-auto d-inline" id="driver-search" placeholder="Ism, telefon yoki mashina raqami..." style="min-width:280px">
<select class="form-select w-auto d-inline" id="driver-filter" onchange="reloadDrivers()">
<option value="all">Barchasi</option>
<option value="online">Onlayn</option>
<option value="verified">Tasdiqlangan</option>
<option value="pending">Kutilmoqda (hujjat yuborgan)</option>
<option value="nodocs">Hujjat yubormagan</option>
<option value="blocked">Bloklangan</option>
</select>
<span class="ms-2 text-muted" id="driver-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="drivers-table">
<thead><tr><th>ID</th><th>Ism</th><th>Telefon</th><th>Mashina</th><th>Raqam</th><th>Balans</th><th>Zakaslar</th><th>Holat</th><th>Amallar</th></tr></thead>
<tbody></tbody>
</table>
</div>
<div id="drivers-pager" class="mt-2"></div>
<!-- Driver details modal -->
<div class="modal fade" id="driver-detail-modal" tabindex="-1">
<div class="modal-dialog modal-lg">
<div class="modal-content">
<div class="modal-header"><h5 class="modal-title">Haydovchi ma'lumotlari</h5>
<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
<div class="modal-body" id="driver-detail-body">Yuklanmoqda...</div>
</div>
</div>
</div>
<!-- Driver edit modal -->
<div class="modal fade" id="driver-edit-modal" tabindex="-1">
<div class="modal-dialog modal-lg">
<div class="modal-content">
<div class="modal-header"><h5 class="modal-title">Ma'lumotni tahrirlash</h5>
<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
<div class="modal-body" id="driver-edit-body">Yuklanmoqda...</div>
<div class="modal-footer">
<div id="driver-edit-result" class="me-auto"></div>
<button class="btn btn-primary" onclick="saveDriverEdit()">Saqlash</button>
</div>
</div>
</div>
</div>"""

DRIVERS_JS = """<script>
let allDrivers=[];
let driverPage=1;
function loadDrivers(page){
driverPage=page||driverPage;
const f=document.getElementById('driver-filter').value;
const qEl=document.getElementById('driver-search');
const q=qEl?qEl.value.trim():'';
fetch('/admin/api/drivers?page='+driverPage+'&filter='+encodeURIComponent(f)+'&q='+encodeURIComponent(q))
.then(r=>r.json()).then(d=>{
if(!d||d.error||!Array.isArray(d.items)){adminError(d&&d.error?d.error:'Haydovchilarni yuklab bo\\'lmadi');return;}
allDrivers=d.items;
document.getElementById('driver-count').textContent=fmtNum(d.total)+' ta';
renderDrivers();
renderPager('drivers-pager',d,loadDrivers);
}).catch(()=>adminError('Haydovchilarni yuklab bo\\'lmadi'));
}
// Changing a filter or search term must go back to page 1, otherwise the request asks for
// page 7 of a result set that now has two pages and the table looks empty.
function reloadDrivers(){loadDrivers(1);}
// A document can be recorded on the driver row while the file itself is unreachable (a
// legacy Telegram file_id with no bot attached to this process). The <img> then rendered
// as a broken-image icon with no explanation.
function imgFallback(el){
el.style.display='none';
const note=document.createElement('div');
note.className='text-danger small';
note.textContent='Rasm yuklanmadi';
el.parentNode.appendChild(note);
}
// Populate the car-model datalist (same list as the bot/app) for the new-driver form.
fetch('/api/car-models').then(r=>r.json()).then(d=>{
const dl=document.getElementById('car-models-list');
if(dl&&d&&Array.isArray(d.models)){dl.innerHTML=d.models.map(m=>`<option value="${esc(m)}">`).join('');}
}).catch(()=>{});
// Filtering, searching and paging are done by the server now — see renderPager().
function renderDrivers(){
const tb=document.querySelector('#drivers-table tbody');
const data=allDrivers;
tb.innerHTML='';
if(!data.length)tb.innerHTML='<tr><td colspan="9" class="text-muted">Haydovchi topilmadi</td></tr>';
data.forEach(d=>{
const status=d.is_verified?'<span class="badge bg-success">Tasdiqlangan</span>':
(d.documents_submitted?'<span class="badge bg-warning">Kutilmoqda</span>':'<span class="badge bg-secondary">Tasdiqlanmagan</span>');
const online=d.is_online?'<span class="badge bg-info">Online</span>':'';
tb.innerHTML+=`<tr>
<td>${d.id}</td><td>${esc(d.first_name||'')} ${esc(d.last_name||'')} ${d.is_blocked?'<span class="badge bg-danger">🚫 Bloklangan</span>':''}</td><td>${esc(d.phone)}</td>
<td>${esc(d.car_model||'-')}</td><td>${esc(d.car_number||'-')}</td><td>${(d.balance||0).toLocaleString()}</td>
<td>${d.total_orders||0}</td>
<td>${status} ${online}</td>
<td>
<button class="btn btn-sm btn-outline-dark" onclick="showDriver(${d.id})">Batafsil</button>
<button class="btn btn-sm btn-outline-secondary" onclick="editDriver(${d.id})">✏️</button>
${!d.is_verified?`<button class="btn btn-sm btn-success" onclick="verifyDriver(${d.id})">Tasdiqlash</button>`:''}
${d.is_verified?`<button class="btn btn-sm btn-danger" onclick="rejectDriver(${d.id})">Rad etish</button>`:''}
<button class="btn btn-sm btn-outline-success" onclick="topUpDriver(${d.id})">Balans +</button>
<button class="btn btn-sm btn-outline-primary" onclick="pushDriver(${d.id})">Push</button>
${d.is_blocked
  ? `<button class="btn btn-sm btn-success" onclick="unblockDriver(${d.id})">Blokdan chiqarish</button>`
  : `<button class="btn btn-sm btn-outline-danger" onclick="blockDriver(${d.id})">Bloklash</button>`}
<a class="btn btn-sm btn-outline-secondary" href="/admin/api/drivers/${d.id}/pdf" target="_blank" rel="noopener">PDF</a>
</td></tr>`;
});
}
function row(label,val){return `<tr><th style="width:40%">${esc(label)}</th><td>${esc(val==null||val===''?'-':String(val))}</td></tr>`;}
function showDriver(id){
const modalEl=document.getElementById('driver-detail-modal');
const body=document.getElementById('driver-detail-body');
body.innerHTML='Yuklanmoqda...';
const modal=new bootstrap.Modal(modalEl);modal.show();
fetch('/admin/api/drivers/'+id).then(r=>r.json()).then(d=>{
if(d.error){body.innerHTML='<div class="alert alert-danger">'+esc(d.error)+'</div>';return;}
let photos='';
// The back sides were stored and printed into the PDF but had no viewer here.
const kinds=[['license','Guvohnoma (old)',d.has_license],['license_back','Guvohnoma (orqa)',d.has_license_back],['tech_passport','Texpasport (old)',d.has_tech_passport],['tech_passport_back','Texpasport (orqa)',d.has_tech_passport_back],['car','Mashina surati',d.has_car_photo]];
kinds.forEach(([k,label,has])=>{
if(has){photos+=`<div class="col-md-4 text-center mb-3"><div class="small text-muted">${esc(label)}</div>`+
`<a href="/admin/api/drivers/${id}/photo/${k}" target="_blank" rel="noopener"><img src="/admin/api/drivers/${id}/photo/${k}" style="max-width:100%;max-height:160px;border:1px solid #ddd;border-radius:6px" loading="lazy" onerror="imgFallback(this)"></a></div>`;}
else{photos+=`<div class="col-md-4 text-center mb-3"><div class="small text-muted">${esc(label)}</div><div class="text-muted">Yuborilmagan</div></div>`;}
});
body.innerHTML=`<table class="table table-sm table-bordered">
${row('ID',d.id)}${row('Telegram ID',d.telegram_id)}${row('Ism',d.first_name)}${row('Familiya',d.last_name)}
${row('JSHSHIR',d.pinfl)}${row('Telefon',d.phone)}${row('Aloqa telefoni',d.contact_phone)}
${row('Mashina modeli',d.car_model)}${row('Mashina raqami',d.car_number)}
${row('Yili',d.car_year)}${row('Rangi',d.car_color)}${row('O\\'rindiqlar',d.seats)}
${row('Balans',fmtNum(d.balance)+" so'm")}${row('Reyting',fmtRating(d.rating,d.rating_count)+' ('+fmtNum(d.rating_count)+' baho)')}
${row('Zakaslar',d.total_orders)}${row('Tasdiqlangan',d.is_verified?'Ha':'Yo\\'q')}${row('Hujjatlar yuborilgan',d.documents_submitted?'Ha':'Yo\\'q')}
${row('Online',d.is_online?'Ha':'Yo\\'q')}${row('Bloklangan',d.is_blocked?'Ha':'Yo\\'q')}
${row('Obuna tugashi',fmtDt(d.subscription_until))}${row('Ro\\'yxatdan o\\'tgan',fmtDt(d.created_at))}
${row('Oxirgi faollik',fmtDt(d.last_active))}
</table>
<h6>Hujjatlar</h6><div class="row">${photos}</div>
<a class="btn btn-sm btn-outline-secondary mt-2" href="/admin/api/drivers/${id}/pdf" target="_blank" rel="noopener">📄 PDF yuklab olish</a>`;
}).catch(()=>{body.innerHTML='<div class="alert alert-danger">Xatolik</div>';});
}
function createDriver(){
const body={
phone:document.getElementById('nd-phone').value.trim(),
first_name:document.getElementById('nd-first').value.trim(),
last_name:document.getElementById('nd-last').value.trim(),
pinfl:document.getElementById('nd-pinfl').value.trim(),
car_number:document.getElementById('nd-carnum').value.trim(),
car_model:document.getElementById('nd-model').value.trim(),
car_year:document.getElementById('nd-year').value.trim(),
telegram_id:document.getElementById('nd-tgid').value.trim()
};
if(!body.phone){alert('Telefon raqam kerak');return;}
const res=document.getElementById('nd-result');
res.textContent='...';
fetch('/admin/api/drivers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
.then(r=>r.json().then(d=>({ok:r.ok,d}))).then(({ok,d})=>{
res.innerHTML='<span class="text-'+(ok?'success':'danger')+'">'+esc(d.detail||d.error||'')+'</span>';
if(ok){['nd-phone','nd-first','nd-last','nd-pinfl','nd-carnum','nd-model','nd-year','nd-tgid'].forEach(i=>document.getElementById(i).value='');loadDrivers();}
}).catch(()=>{res.innerHTML='<span class="text-danger">Xato</span>';});
}
// Both used to ignore the response completely: approving a driver with incomplete
// documents returns 400 with the list of what is missing, and the admin saw nothing
// happen at all.
function verifyDriver(id){
fetch('/admin/api/drivers/'+id+'/verify',{method:'POST'}).then(r=>r.json()).then(d=>{
if(d.error)alert(d.error);
loadDrivers();
}).catch(()=>alert('Xatolik'));
}
function rejectDriver(id){
if(!confirm('Haydovchini rad etamizmi? Tasdiq va hujjatlar holati bekor qilinadi.'))return;
fetch('/admin/api/drivers/'+id+'/reject',{method:'POST'}).then(r=>r.json()).then(d=>{
if(d.error)alert(d.error);
loadDrivers();
}).catch(()=>alert('Xatolik'));
}
const _topUpInFlight={};
function topUpDriver(id){
// Guard against a double-click / second tab: the idempotency key below is minted per
// call, so two clicks used to mint two different keys and the server -- correctly --
// treated them as two separate logical top-ups and credited BOTH.
if(_topUpInFlight[id]){alert('Iltimos kutib turing...');return;}
const raw=prompt("Qancha so'm qo'shilsin? (manfiy = ayirish)");
if(raw===null)return;
// parseInt("50 000") === 50. Every amount in this panel is rendered space-grouped, so an
// admin copying "50 000" credited 50 so'm and the alert reported success. Strip the
// separators the UI itself produces, then demand a clean integer.
const normalized=String(raw).replace(/[\\s\\u00a0’']/g,'').replace(/,/g,'');
if(!/^-?\\d+$/.test(normalized)){alert("Noto'g'ri summa. Faqat raqam kiriting, masalan: 50000");return;}
const amount=parseInt(normalized,10);
if(!Number.isSafeInteger(amount)||amount===0){alert("Noto'g'ri summa");return;}
const pretty=amount.toLocaleString('ru-RU').replace(/\\u00a0/g,' ');
if(!confirm((amount>0?'Qo\\'shilsin: +':'Ayirilsin: ')+pretty+" so'm\\n\\nTasdiqlaysizmi?"))return;
const idempotency_key=(globalThis.crypto&&globalThis.crypto.randomUUID)?globalThis.crypto.randomUUID():`admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
_topUpInFlight[id]=true;
fetch('/admin/api/drivers/'+id+'/balance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,idempotency_key})}).then(r=>r.json()).then(d=>{alert(d.detail||d.error||'Bajarildi');loadDrivers();}).catch(()=>alert('Xato')).finally(()=>{delete _topUpInFlight[id];});
}
function pushDriver(id){
const msg=prompt('Xabar matni:');
if(msg)fetch('/admin/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'specific',recipient_id:id,recipient_type:'driver',message:msg})}).then(r=>r.json()).then(d=>alert(d.detail||d.error||'Yuborildi')).catch(()=>alert('Xatolik'));
}
function blockDriver(id){
  if(!confirm('Haydovchini bloklashni tasdiqlaysizmi? U zakas ola olmaydi va ilovaga kira olmaydi.'))return;
  fetch('/admin/api/drivers/'+id+'/block',{method:'POST'})
    .then(r=>r.json()).then(d=>{alert(d.detail||d.error||'OK');loadDrivers();})
    .catch(()=>alert('Xatolik'));
}
function unblockDriver(id){
  if(!confirm('Haydovchini blokdan chiqaramizmi?'))return;
  fetch('/admin/api/drivers/'+id+'/unblock',{method:'POST'})
    .then(r=>r.json()).then(d=>{alert(d.detail||d.error||'OK');loadDrivers();})
    .catch(()=>alert('Xatolik'));
}
// Edit form: until now a typo in a phone or car number entered here could only be fixed
// in the database.
const EDIT_FIELDS=[['ed-first','first_name','Ism'],['ed-last','last_name','Familiya'],['ed-phone','phone','Telefon'],['ed-contact','contact_phone','Aloqa telefoni'],['ed-pinfl','pinfl','JSHSHIR'],['ed-model','car_model','Mashina modeli'],['ed-carnum','car_number','Mashina raqami'],['ed-color','car_color','Rangi'],['ed-year','car_year','Yili'],['ed-seats','seats',"O'rindiqlar"],['ed-tgid','telegram_id','Telegram ID']];
let editingDriverId=null;
function editDriver(id){
editingDriverId=id;
const body=document.getElementById('driver-edit-body');
body.innerHTML='Yuklanmoqda...';
new bootstrap.Modal(document.getElementById('driver-edit-modal')).show();
fetch('/admin/api/drivers/'+id).then(r=>r.json()).then(d=>{
if(d.error){body.innerHTML='<div class="alert alert-danger">'+esc(d.error)+'</div>';return;}
body.innerHTML='<div class="row g-2">'+EDIT_FIELDS.map(([elId,key,label])=>
`<div class="col-md-6"><label class="form-label small mb-0">${esc(label)}</label>
<input class="form-control form-control-sm" id="${elId}" value="${esc(d[key]==null?'':d[key])}"></div>`
).join('')+'</div><div class="form-text mt-2">Bo\\'sh qoldirilgan maydon tozalanadi. Telefon va Telegram ID takrorlanmasligi tekshiriladi.</div>';
}).catch(()=>{body.innerHTML='<div class="alert alert-danger">Xatolik</div>';});
}
function saveDriverEdit(){
if(!editingDriverId)return;
const out=document.getElementById('driver-edit-result');
const body={};
for(const [elId,key] of EDIT_FIELDS){
const el=document.getElementById(elId);
if(!el)continue;
const raw=String(el.value).trim();
if(key==='seats'){if(raw===''){continue;}if(!/^\\d+$/.test(raw)){out.innerHTML='<div class="alert alert-danger mb-0">O\\'rindiqlar soni butun son bo\\'lishi kerak</div>';return;}body[key]=parseInt(raw,10);continue;}
if(key==='telegram_id'){if(raw===''){continue;}if(!/^\\d+$/.test(raw)){out.innerHTML='<div class="alert alert-danger mb-0">Telegram ID raqam bo\\'lishi kerak</div>';return;}body[key]=raw;continue;}
body[key]=raw;
}
out.innerHTML='<div class="text-muted">Saqlanmoqda...</div>';
fetch('/admin/api/drivers/'+editingDriverId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
.then(r=>r.json()).then(d=>{
out.innerHTML='<div class="alert alert-'+(d.error?'danger':'success')+' mb-0">'+esc(d.detail||d.error||'Saqlandi')+'</div>';
if(!d.error)loadDrivers();
}).catch(()=>{out.innerHTML='<div class="alert alert-danger mb-0">Saqlashda xatolik</div>';});
}
const driverSearchEl=document.getElementById('driver-search');
if(driverSearchEl)driverSearchEl.addEventListener('input',debounce(reloadDrivers,400));
loadDrivers(1);
</script>"""

PASSENGERS_HTML = """<h2>Yo'lovchilar</h2>
<div class="mb-3">
<input type="text" class="form-control w-auto d-inline" id="passenger-search" placeholder="Ism yoki telefon bo'yicha qidirish..." style="min-width:280px">
<select class="form-select w-auto d-inline" id="passenger-filter" onchange="reloadPassengers()">
<option value="all">Barchasi</option>
<option value="active">Faol</option>
<option value="blocked">Bloklangan</option>
</select>
<span class="ms-2 text-muted" id="passenger-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="passengers-table">
<thead><tr><th>ID</th><th>Ism</th><th>Telefon</th><th>Til</th><th>Bonus</th><th>Reyting</th><th>Holat</th><th>Ro'yxatdan o'tgan</th><th>Amal</th></tr></thead>
<tbody></tbody>
</table>
</div>
<div id="passengers-pager" class="mt-2"></div>"""

PASSENGERS_JS = """<script>
let allPassengers=[];
// Search, filter and paging are server-side now (see /admin/api/passengers).
function renderPassengers(){
const data=allPassengers;
const tb=document.querySelector('#passengers-table tbody');
tb.innerHTML='';
if(!data.length){tb.innerHTML='<tr><td colspan="9" class="text-muted">Yo\\'lovchi yo\\'q</td></tr>';}
data.forEach(u=>{
// `is_blocked` was returned by the API but had no column, so a blocked passenger looked
// identical to an active one.
const state=u.is_blocked?'<span class="badge bg-danger">🚫 Bloklangan</span>':'<span class="badge bg-success">Faol</span>';
const act=u.is_blocked
  ?`<button class="btn btn-sm btn-success" onclick="unblockPassenger(${u.id})">Blokdan chiqarish</button>`
  :`<button class="btn btn-sm btn-outline-danger" onclick="blockPassenger(${u.id})">Bloklash</button>`;
const LANGS={uz:"O'zbek",ru:'Rus',en:'Ingliz'};
tb.innerHTML+=`<tr><td>${Number(u.id)}</td><td>${esc(u.first_name||'')} ${esc(u.last_name||'')}</td><td>${esc(u.phone)}</td><td>${esc(LANGS[u.language]||u.language||"O'zbek")}</td><td>${fmtNum(u.bonus_balance)}</td><td>${Number(u.rating||0)>0?Number(u.rating).toFixed(1):'—'}</td><td>${state}</td><td class="small">${esc(fmtDt(u.created_at))}</td><td>${act}</td></tr>`;
});
}
let passengerPage=1;
function loadPassengers(page){
passengerPage=page||passengerPage;
const qEl=document.getElementById('passenger-search');
const q=qEl?qEl.value.trim():'';
const fEl=document.getElementById('passenger-filter');
const f=fEl?fEl.value:'all';
fetch('/admin/api/passengers?page='+passengerPage+'&q='+encodeURIComponent(q)+'&filter='+encodeURIComponent(f))
.then(r=>r.json()).then(d=>{
if(!d||d.error||!Array.isArray(d.items)){adminError(d&&d.error?d.error:'Yo\\'lovchilarni yuklab bo\\'lmadi');return;}
allPassengers=d.items;
const cnt=document.getElementById('passenger-count');
if(cnt)cnt.textContent=fmtNum(d.total)+' ta';
renderPassengers();
renderPager('passengers-pager',d,loadPassengers);
}).catch(()=>adminError('Yo\\'lovchilarni yuklab bo\\'lmadi'));
}
function reloadPassengers(){loadPassengers(1);}
function blockPassenger(id){
if(!confirm('Yo\\'lovchini bloklaysizmi? U ilovaga kira olmaydi va buyurtma bera olmaydi.'))return;
fetch('/admin/api/passengers/'+id+'/block',{method:'POST'}).then(r=>r.json()).then(d=>{alert(d.detail||d.error||'OK');loadPassengers();}).catch(()=>alert('Xatolik'));
}
function unblockPassenger(id){
if(!confirm('Yo\\'lovchini blokdan chiqaramizmi?'))return;
fetch('/admin/api/passengers/'+id+'/unblock',{method:'POST'}).then(r=>r.json()).then(d=>{alert(d.detail||d.error||'OK');loadPassengers();}).catch(()=>alert('Xatolik'));
}
const passengerSearchEl=document.getElementById('passenger-search');
if(passengerSearchEl)passengerSearchEl.addEventListener('input',debounce(reloadPassengers,400));
loadPassengers(1);
</script>"""

ORDERS_HTML = """<h2>Buyurtmalar</h2>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="status-filter" onchange="reloadOrders()">
<option value="all">Barchasi</option>
<option value="active">Faol (yangi/qabul/jarayonda)</option>
<option value="new">Yangi</option>
<option value="accepted">Qabul qilingan</option>
<option value="in_progress">Jarayonda</option>
<option value="completed">Yakunlangan</option>
<option value="cancelled">Bekor qilingan</option>
<option value="expired">Muddati o'tgan (hech kim olmagan)</option>
</select>
<input type="text" class="form-control w-auto d-inline" id="order-search" placeholder="Telefon, ism yoki shahar..." style="min-width:260px">
<span class="ms-2 text-muted" id="order-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="orders-table">
<thead><tr><th>ID</th><th>Yo'lovchi</th><th>Telefon</th><th>Yo'nalish</th><th>Xizmat</th><th>Narx</th><th>Komissiya</th><th>Holat</th><th>Haydovchi</th><th>Sana</th></tr></thead>
<tbody></tbody>
</table>
</div>
<div id="orders-pager" class="mt-2"></div>"""

ORDERS_JS = """<script>
// The table used to print the raw English snake_case status, and both `in_progress` and
// `expired` fell through to the same grey badge — an active ride looked like a dead one.
const ORDER_STATUS={'new':{l:'Yangi',c:'bg-primary'},'accepted':{l:'Qabul qilingan',c:'bg-info'},'in_progress':{l:'Jarayonda',c:'bg-warning text-dark'},'completed':{l:'Yakunlangan',c:'bg-success'},'cancelled':{l:'Bekor qilingan',c:'bg-danger'},'expired':{l:"Muddati o'tgan",c:'bg-dark'}};
const SERVICE_NAMES={taxi:'Taksi',parcel:'Pochta',full_car:"To'liq mashina"};
const CANCELLED_BY={passenger:"yo'lovchi",driver:'haydovchi',system:'tizim',admin:'admin'};
let orderPage=1;
function reloadOrders(){loadOrders(1);}
function loadOrders(page){
orderPage=page||orderPage;
const st=document.getElementById('status-filter').value;
const qEl=document.getElementById('order-search');
const q=qEl?qEl.value.trim():'';
fetch('/admin/api/orders?status='+encodeURIComponent(st)+'&page='+orderPage+'&q='+encodeURIComponent(q))
.then(r=>r.json()).then(payload=>{
const tb=document.querySelector('#orders-table tbody');
tb.innerHTML='';
if(!payload||payload.error||!Array.isArray(payload.items)){adminError(payload&&payload.error?payload.error:'Buyurtmalarni yuklab bo\\'lmadi');return;}
const data=payload.items;
const cnt=document.getElementById('order-count');
if(cnt)cnt.textContent=fmtNum(payload.total)+' ta';
if(!data.length){tb.innerHTML='<tr><td colspan="10" class="text-muted">Buyurtma yo\\'q</td></tr>';}
data.forEach(o=>{
const st=ORDER_STATUS[o.status]||{l:o.status,c:'bg-secondary'};
const comm=(o.commission_effective||0);
const commHtml=comm>0?fmtNum(comm):'<span class="text-muted">0</span>';
let driverHtml='<span class="text-muted">-</span>';
if(o.driver_name||o.driver_phone){
const carPart=o.driver_car_number?' · '+esc(o.driver_car_number):'';
driverHtml=`<div>${esc(o.driver_name||'-')}${carPart}</div>`+
`<div class="text-muted small">${esc(o.driver_phone||'')}</div>`+
(o.accepted_at?`<div class="text-muted small">${esc(fmtDt(o.accepted_at))}</div>`:'');
}
// Who ended it and why — a passenger cancellation and a system reap both used to read
// simply "cancelled".
let stHtml=`<span class="badge ${st.c}">${esc(st.l)}</span>`;
if(o.cancelled_by||o.cancel_reason){
const by=CANCELLED_BY[o.cancelled_by]||o.cancelled_by||'';
stHtml+=`<div class="text-muted small">${esc(by)}${o.cancel_reason?': '+esc(o.cancel_reason):''}</div>`;
}
const svc=esc(SERVICE_NAMES[o.service_type]||o.service_type||'-')+(o.person_count?` <span class="text-muted">· ${o.person_count} kishi</span>`:'');
tb.innerHTML+=`<tr><td>${o.id}</td><td>${esc(o.passenger_name||'-')}</td><td>${esc(o.passenger_phone)}</td><td>${esc(o.from_city)} - ${esc(o.to_city)}</td><td class="small">${svc}</td><td>${fmtNum(o.price)}</td><td>${commHtml}</td><td>${stHtml}</td><td>${driverHtml}</td><td class="small">${esc(fmtDt(o.created_at))}</td></tr>`;
});
renderPager('orders-pager',payload,loadOrders);
}).catch(()=>adminError('Buyurtmalarni yuklab bo\\'lmadi'));
}
const orderSearchEl=document.getElementById('order-search');
if(orderSearchEl)orderSearchEl.addEventListener('input',debounce(reloadOrders,400));
loadOrders(1);
</script>"""

PUSH_LOG_HTML = """<h2>Push diagnostika</h2>
<p class="text-muted">Nega bildirishnoma yetmayotganini aniqlash uchun. Push faqat
<b>tasdiqlangan + online + token ro'yxatdan o'tgan</b> haydovchiga boradi.</p>
<div class="row g-3 mb-3">
<div class="col-md-3"><div class="card"><div class="card-body">
<div class="text-muted small">Online haydovchilar</div>
<div class="fs-3" id="pl-online">-</div></div></div></div>
<div class="col-md-3"><div class="card"><div class="card-body">
<div class="text-muted small">Online + token bor</div>
<div class="fs-3" id="pl-online-token">-</div>
<div class="small" id="pl-unreachable"></div></div></div></div>
<div class="col-md-3"><div class="card"><div class="card-body">
<div class="text-muted small">24 soatda qabul qilingan</div>
<div class="fs-3" id="pl-sent">-</div>
<div class="small text-muted">Expo oldi (yetkazildi degani emas)</div></div></div></div>
<div class="col-md-3"><div class="card"><div class="card-body">
<div class="text-muted small">Yetkazildi / xato</div>
<div class="fs-3"><span class="text-success" id="pl-delivered">-</span>
<span class="text-muted">/</span><span class="text-danger" id="pl-failed">-</span></div></div></div></div>
</div>
<div class="mb-3">
<button class="btn btn-outline-primary btn-sm" id="pl-check" onclick="checkReceipts()">
Yetkazilganini Expo dan tekshirish</button>
<span class="ms-2 small" id="pl-check-result"></span>
</div>
<div id="pl-diagnosis"></div>
<div id="pl-notoken-wrap" style="display:none">
<h5 class="mt-4">Online, lekin push bora olmaydigan haydovchilar</h5>
<p class="text-muted small mb-2">Bu haydovchilar zakasni faqat ilova ochiq turganda ko'radi.
Ilovani ochib, bildirishnoma ruxsatini berishlari kerak — yoki ilovaning yangi versiyasini o'rnatishlari.</p>
<div class="table-responsive mb-4">
<table class="table table-sm table-bordered" id="pl-notoken">
<thead><tr><th>ID</th><th>Ism</th><th>Telefon</th><th>Mashina</th></tr></thead><tbody></tbody></table>
</div>
</div>
<h5 class="mt-4">Eng ko'p uchragan xatolar (7 kun)</h5>
<div class="table-responsive mb-4">
<table class="table table-sm" id="pl-errors"><thead><tr><th>Xato</th><th>Soni</th></tr></thead><tbody></tbody></table>
</div>
<h5>Oxirgi push'lar</h5>
<p class="text-muted small mb-2">Oxirgi 200 ta yozuv ko'rsatiladi.</p>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="pl-status" onchange="loadPushLog()">
<option value="all">Barchasi</option>
<option value="failed">Faqat xatolar</option>
<option value="sent">Faqat yuborilganlar</option>
<option value="delivered">Faqat yetkazilganlar</option>
</select>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="pl-table">
<thead><tr><th>ID</th><th>Sana</th><th>Kimga</th><th>Turi</th><th>Sarlavha</th><th>Holat</th><th>Xato</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

PUSH_LOG_JS = """<script>
// Human labels instead of raw keys/statuses in the table.
const PUSH_STATUS={sent:'Yuborildi',delivered:'Yetkazildi',failed:'Xato'};
const PUSH_TYPES={admin:'Admin xabari',new_order:'Yangi zakas',order_accepted:'Zakas qabul qilindi',order_cancelled:'Zakas bekor qilindi',balance:'Balans',promo:'Aksiya'};
const PUSH_RECIPIENTS={driver:'Haydovchi',user:"Yo'lovchi"};
function loadPushLog(){
const st=document.getElementById('pl-status').value;
fetch('/admin/api/push-log?status='+st).then(r=>r.json()).then(d=>{
if(!d||d.error||!d.summary){adminError(d&&d.error?d.error:'Push diagnostikani yuklab bo\\'lmadi');return;}
const s=d.summary||{};
// Coalesce: on a partial payload these printed "undefined" in the cards and the
// subtraction below produced NaN, which then drove the diagnosis text.
const online=s.drivers_online||0, onlineToken=s.drivers_online_with_token||0;
document.getElementById('pl-online').textContent=online;
document.getElementById('pl-online-token').textContent=onlineToken;
const unreachable=(online-onlineToken);
document.getElementById('pl-unreachable').innerHTML=unreachable>0
?'<span class="text-danger">'+unreachable+' ta token yo\\'q</span>':'<span class="text-success">hammasida token bor</span>';
document.getElementById('pl-sent').textContent=(s.last_24h||{}).sent||0;
document.getElementById('pl-delivered').textContent=(s.last_24h||{}).delivered||0;
document.getElementById('pl-failed').textContent=(s.last_24h||{}).failed||0;

// Turn the numbers into a plain-language verdict, so the cause does not have to be
// inferred from four separate counters.
//
// Tokenless drivers are checked BEFORE the send counters on purpose. Judging by the
// counters alone said "push yuborish ishlayapti" while 3 of 5 online drivers could not
// receive anything — technically true and completely misleading, because a driver with no
// token is never counted as a failure: no send is even attempted for them.
const sent=(s.last_24h||{}).sent||0, failed=(s.last_24h||{}).failed||0;
const delivered=(s.last_24h||{}).delivered||0;
let msg='', cls='info';
if(sent>0 && delivered===0 && failed===0){
msg='Expo '+sent+' ta push ni QABUL QILDI, lekin yetkazilganini hech biri tasdiqlamagan. Bu telefonga yetgan degani EMAS. Yuqoridagi tugmani bosib Expo dan tekshiring.';cls='warning';
}else if(failed>0 && delivered===0){
// Checked before the tokenless drivers on purpose: "nothing is being delivered at all"
// outranks "some drivers are unreachable", and reporting the smaller problem first hid
// the bigger one entirely.
msg='Yetkazilgan push YO\\'Q — '+failed+' tasi rad etilgan. Pastdagi xato matnini o\\'qing. MismatchSenderId bo\\'lsa, ilovadagi google-services.json Expo dagi FCM kalitidan BOSHQA Firebase loyihasiga tegishli; DeviceNotRegistered bo\\'lsa token eskirgan.';cls='danger';
}else if(online>0 && onlineToken===0){
msg='Online haydovchilarning HECH BIRIDA push token yo\\'q, ya\\'ni ilova yopiqda zakas hech kimga bormaydi. Ilova tokenni ro\\'yxatdan o\\'tkaza olmayapti — bildirishnoma ruxsati yoki eski ilova versiyasi.';cls='danger';
}else if(unreachable>0){
msg=unreachable+' ta online haydovchiga push BORA OLMAYDI (token yo\\'q). Ular zakasni faqat ilova ochiq turganda ko\\'radi — yopiqda o\\'tkazib yuboradi. Pastdagi ro\\'yxatdan kimligini ko\\'ring.'+(failed>0?' Bundan tashqari ba\\'zi push xato bilan qaytgan.':'');cls='warning';
}else if(failed>0){
msg='Bir qismi xato bilan qaytdi — pastdagi jadvalda sababini ko\\'ring.';cls='warning';
}else if(delivered>0){
msg=delivered+' ta push telefonga YETKAZILGANI Expo tomonidan tasdiqlangan. Shunga qaramay ko\\'rinmayotgan bo\\'lsa, muammo qurilma tomonida (batareya optimizatsiyasi, bildirishnoma o\\'chirilgan).';cls='success';
}else if(sent>0){
msg='Push xatosiz yuborilyapti. Yetkazilganini aniqlash uchun yuqoridagi tugmani bosing.';cls='info';
}else{
msg='24 soat ichida umuman push yuborilmagan. Zakas yaratilganda online haydovchi bo\\'lmagan bo\\'lishi mumkin.';cls='secondary';
}
document.getElementById('pl-diagnosis').innerHTML='<div class="alert alert-'+cls+'">'+esc(msg)+'</div>';

const nt=d.online_without_token||[];
document.getElementById('pl-notoken-wrap').style.display=nt.length?'':'none';
const ntb=document.querySelector('#pl-notoken tbody');ntb.innerHTML='';
nt.forEach(x=>{ntb.innerHTML+=`<tr><td>${x.id}</td><td>${esc(x.name||'-')}</td><td>${esc(x.phone||'')}</td><td>${esc(x.car_number||'')}</td></tr>`;});

const et=document.querySelector('#pl-errors tbody');et.innerHTML='';
(s.top_errors||[]).forEach(e=>{et.innerHTML+=`<tr><td><code>${esc(e.error)}</code></td><td>${e.count}</td></tr>`;});
if(!(s.top_errors||[]).length)et.innerHTML='<tr><td colspan="2" class="text-muted">Xato yo\\'q</td></tr>';

const tb=document.querySelector('#pl-table tbody');tb.innerHTML='';
(d.rows||[]).forEach(r=>{
const badge=r.status==='delivered'?'bg-success':(r.status==='sent'?'bg-primary':(r.status==='failed'?'bg-danger':'bg-secondary'));
const who=r.recipient_name?esc(r.recipient_name):(esc(PUSH_RECIPIENTS[r.recipient_type]||r.recipient_type||'')+' #'+Number(r.recipient_id||0));
tb.innerHTML+=`<tr><td>${Number(r.id)}</td><td class="small">${esc(fmtDt(r.created_at))}</td><td>${who}</td><td>${esc(PUSH_TYPES[r.type]||r.type||'-')}</td><td>${esc(r.title||'')}</td><td><span class="badge ${badge}">${esc(PUSH_STATUS[r.status]||r.status||'?')}</span></td><td class="small text-danger">${esc(r.error||'')}</td></tr>`;
});
if(!(d.rows||[]).length)tb.innerHTML='<tr><td colspan="7" class="text-muted">Yozuv yo\\'q</td></tr>';
}).catch(()=>adminError('Push diagnostikani yuklab bo\\'lmadi'));
}
function checkReceipts(){
const btn=document.getElementById('pl-check'), out=document.getElementById('pl-check-result');
btn.disabled=true;out.textContent='Tekshirilyapti...';
fetch('/admin/api/push-receipts',{method:'POST'}).then(r=>r.json()).then(d=>{
btn.disabled=false;
if(d.error){out.innerHTML='<span class="text-danger">'+esc(d.error)+'</span>';return;}
out.innerHTML='<span class="text-muted">'+fmtNum(d.checked)+' ta tekshirildi: '+fmtNum(d.delivered)+' yetkazildi, '+fmtNum(d.failed)+' xato, '+fmtNum(d.pending)+' hali navbatda</span>';
loadPushLog();
}).catch(e=>{btn.disabled=false;out.innerHTML='<span class="text-danger">'+esc(String(e))+'</span>';});
}
loadPushLog();
</script>"""

PUSH_HTML = """<h2>Push xabar yuborish</h2>
<div class="card" style="max-width:500px;">
<div class="card-body">
<div class="mb-3">
<label class="form-label">Kimga</label>
<select class="form-select" id="push-target" onchange="toggleRecipient()">
<option value="all">Barchaga</option>
<option value="drivers">Haydovchilarga</option>
<option value="passengers">Yo'lovchilarga</option>
<option value="specific">Aniq foydalanuvchiga</option>
</select>
</div>
<div class="mb-3 d-none" id="recipient-row">
<label class="form-label">ID (foydalanuvchi yoki haydovchi)</label>
<input type="number" class="form-control" id="push-recipient">
<select class="form-select mt-1" id="push-rtype">
<option value="driver">Haydovchi</option>
<option value="user">Yo'lovchi</option>
</select>
</div>
<div class="mb-3">
<label class="form-label">Xabar matni</label>
<textarea class="form-control" id="push-message" rows="3"></textarea>
</div>
<div class="form-check mb-3">
<input class="form-check-input" type="checkbox" id="push-telegram" checked>
<label class="form-check-label" for="push-telegram">
Ilova o'rnatmaganlarga Telegram bot orqali yuborish
</label>
<div class="form-text">Push token faqat mobil ilovani ochgan foydalanuvchilarda bo'ladi.
Botdan ro'yxatdan o'tganlarga xabar Telegram orqali boradi.</div>
</div>
<button class="btn btn-primary" id="push-btn" onclick="sendPush()">Yuborish</button>
<div id="push-result" class="mt-2"></div>
</div>
</div>"""

PUSH_JS = """<script>
function toggleRecipient(){
const v=document.getElementById('push-target').value;
document.getElementById('recipient-row').classList.toggle('d-none',v!=='specific');
}
function pushStatsHtml(s){
if(!s)return '';
let h='<hr class="my-2"><div class="small">';
// fmtNum() everywhere: these came straight from the response and printed "undefined"
// whenever a field was absent.
h+='<div>Qabul qiluvchilar: <b>'+fmtNum(s.recipients)+'</b></div>';
h+='<div>Push token bor: <b>'+fmtNum(s.with_token)+'</b> — yuborildi: <b>'+fmtNum(s.push_sent)+'</b>'+(s.push_failed?', xato: <b>'+fmtNum(s.push_failed)+'</b>':'')+'</div>';
if(s.telegram_queued)h+='<div>Telegram: <b>'+fmtNum(s.telegram_queued)+'</b> ta xabar fonda yuborilmoqda</div>';
else if(s.telegram_attempted)h+='<div>Telegram: <b>'+fmtNum(s.telegram_sent)+'</b> yuborildi'+(s.telegram_failed?', <b>'+fmtNum(s.telegram_failed)+'</b> xato':'')+' ('+fmtNum(s.telegram_attempted)+' ta urinish)</div>';
if(s.unreached)h+='<div class="text-warning">Darhol yetib bormadi: <b>'+fmtNum(s.unreached)+'</b></div>';
if(s.inbox_saved)h+='<div class="text-success">Xabar ilovada saqlandi — hamma ilovani ochganda ko\\'radi</div>';
if(s.errors&&s.errors.length){
h+='<div class="mt-2">Sabablari:<ul class="mb-0">';
s.errors.forEach(function(e){h+='<li>'+esc(e.error)+' — '+e.count+' ta</li>';});
h+='</ul></div>';
}
return h+'</div>';
}
function sendPush(){
const target=document.getElementById('push-target').value;
const message=document.getElementById('push-message').value;
const recipient_id=parseInt(document.getElementById('push-recipient').value)||null;
const recipient_type=document.getElementById('push-rtype').value;
const telegram=document.getElementById('push-telegram').checked;
const btn=document.getElementById('push-btn');
const box=document.getElementById('push-result');
if(!message.trim()){box.innerHTML='<div class="alert alert-danger">Xabar matni bo\\'sh</div>';return;}
// A broadcast can take a while (Telegram is rate-limited), so disable the button
// instead of letting an impatient click send the same message twice.
btn.disabled=true;btn.textContent='Yuborilmoqda...';
box.innerHTML='<div class="alert alert-secondary">Yuborilmoqda, kuting...</div>';
fetch('/admin/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,message,recipient_id,recipient_type,telegram})})
.then(r=>r.json()).then(d=>{
const level=d.error?'danger':(d.level||'success');
box.innerHTML='<div class="alert alert-'+level+'">'+esc(d.detail||d.error||'Yuborildi')+pushStatsHtml(d.stats)+'</div>';
}).catch(e=>{box.innerHTML='<div class="alert alert-danger">Xato: '+esc(String(e))+'</div>';})
.finally(()=>{btn.disabled=false;btn.textContent='Yuborish';});
}
</script>"""

ROUTES_HTML = """<h2>Yo'nalishlar va narxlar</h2>
<div class="table-responsive">
<table class="table table-striped table-sm" id="routes-table">
<thead><tr><th>ID</th><th>Qayerdan</th><th>Qayerga</th><th>Narx (1 kishi)</th><th>To'liq mashina</th><th>Pochta</th><th>Faol</th><th>Amal</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

ROUTES_JS = """<script>
function loadRoutes(){
fetch('/admin/api/routes').then(r=>r.json()).then(payload=>{
const tb=document.querySelector('#routes-table tbody');
tb.innerHTML='';
const data=Array.isArray(payload)?payload:[];
if(!Array.isArray(payload))adminError(payload&&payload.error?payload.error:'Yo\\'nalishlarni yuklab bo\\'lmadi');
if(!data.length)tb.innerHTML='<tr><td colspan="8" class="text-muted">Yo\\'nalish yo\\'q</td></tr>';
data.forEach(rt=>{
// `is_active` was returned by the API but had neither a column nor a control, so a
// route taken out of service looked identical to a live one.
tb.innerHTML+=`<tr${rt.is_active?'':' class="table-secondary"'}>
<td>${Number(rt.id)}</td><td>${esc(rt.from_city)}</td><td>${esc(rt.to_city)}</td>
<td><input type="number" class="form-control form-control-sm" value="${Number(rt.price_per_person)||0}" id="pp-${Number(rt.id)}" style="width:100px"></td>
<td><input type="number" class="form-control form-control-sm" value="${Number(rt.full_car_price)||0}" id="fc-${Number(rt.id)}" style="width:100px"></td>
<td><input type="number" class="form-control form-control-sm" value="${Number(rt.parcel_price)||0}" id="pr-${Number(rt.id)}" style="width:100px"></td>
<td><input type="checkbox" class="form-check-input" id="ac-${Number(rt.id)}" ${rt.is_active?'checked':''}></td>
<td><button class="btn btn-sm btn-success" onclick="saveRoute(${Number(rt.id)})">Saqlash</button></td>
</tr>`;
});
}).catch(()=>adminError('Yo\\'nalishlarni yuklab bo\\'lmadi'));
}
function saveRoute(id){
const body={};
// An empty field made parseInt return NaN, which JSON.stringify turns into null.
for(const [prefix,key] of [['pp-','price_per_person'],['fc-','full_car_price'],['pr-','parcel_price']]){
const raw=String(document.getElementById(prefix+id).value).trim();
if(!/^\\d+$/.test(raw)){alert('Narxlar butun son bo\\'lishi kerak (bo\\'sh qoldirmang)');return;}
body[key]=parseInt(raw,10);
}
const ac=document.getElementById('ac-'+id);
if(ac)body.is_active=ac.checked;
fetch('/admin/api/routes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(d=>{if(d.ok){loadRoutes();alert('Saqlandi');}else alert(d.error||'Xato');}).catch(()=>alert('Saqlashda xatolik'));
}
loadRoutes();
</script>"""

SETTINGS_HTML = """<h2>Sozlamalar</h2>
<p class="text-muted">Bu qiymatlar darhol kuchga kiradi — ilova va bot ularni bazadan
o'qiydi. Bo'sh qoldirmang.</p>
<div class="row">
<div class="col-lg-6">
<div class="card mb-3"><div class="card-body">
<h6 class="mb-3">💰 Komissiya va balans</h6>
<div class="mb-3">
<label class="form-label">Komissiya (%) — har bir zakazdan</label>
<input type="number" class="form-control" id="set-commission">
</div>
<div class="mb-3">
<label class="form-label">Minimal balans (so'm)</label>
<input type="number" class="form-control" id="set-min-balance">
<div class="form-text">Haydovchi zakas olishi uchun kerakli eng kam balans.</div>
</div>
</div></div>

<div class="card mb-3"><div class="card-body">
<h6 class="mb-3">🎁 Bepul sinov</h6>
<div class="mb-3">
<label class="form-label">Bepul sinov muddati (kun)</label>
<input type="number" class="form-control" id="set-trial-days">
</div>
<div class="mb-3">
<label class="form-label">Bepul haydovchilar limiti</label>
<input type="number" class="form-control" id="set-trial-limit">
<div class="form-text">Hozirgacha berilgan: <b id="set-trial-used">-</b> ta</div>
</div>
</div></div>

<div class="card mb-3 border-warning"><div class="card-body">
<h6 class="mb-3">🛠 Texnik xizmat rejimi</h6>
<div class="form-check">
<input class="form-check-input" type="checkbox" id="set-maintenance">
<label class="form-check-label" for="set-maintenance">
Texnik xizmat rejimi yoqilgan
</label>
</div>
<div class="form-text text-danger">Yoqilsa bot foydalanuvchilarga xizmat vaqtincha
to'xtatilgani haqida xabar beradi. Ehtiyot bo'ling.</div>
</div></div>
</div>

<div class="col-lg-6">
<div class="card mb-3"><div class="card-body">
<h6 class="mb-3">⭐ Sodiqlik (loyalty)</h6>
<div class="mb-3">
<label class="form-label">Bir safar uchun ball</label>
<input type="number" class="form-control" id="set-loyalty-points">
</div>
<div class="mb-3">
<label class="form-label">Bonusga aylanish chegarasi (ball)</label>
<input type="number" class="form-control" id="set-loyalty-threshold">
</div>
<div class="mb-3">
<label class="form-label">Chegaraga yetganda beriladigan bonus (so'm)</label>
<input type="number" class="form-control" id="set-loyalty-reward">
</div>
<div class="mb-3">
<label class="form-label">Bir safarga ishlatilishi mumkin bo'lgan maksimal bonus (so'm)</label>
<input type="number" class="form-control" id="set-bonus-max">
</div>
</div></div>

<div class="card mb-3"><div class="card-body">
<h6 class="mb-3">👥 Taklif (referral)</h6>
<div class="mb-3">
<label class="form-label">Taklif qilgan uchun bonus (so'm)</label>
<input type="number" class="form-control" id="set-ref-referrer">
</div>
<div class="mb-3">
<label class="form-label">Taklif qilingan uchun bonus (so'm)</label>
<input type="number" class="form-control" id="set-ref-new">
</div>
<div class="mb-3">
<label class="form-label">Taklif qilingan necha safarda bonus oladi</label>
<input type="number" class="form-control" id="set-ref-rides">
</div>
<div class="mb-3">
<label class="form-label">Bir foydalanuvchi uchun maksimal taklif soni (0 = cheksiz)</label>
<input type="number" class="form-control" id="set-ref-max">
</div>
</div></div>
</div>
</div>
<button class="btn btn-primary" onclick="saveSettings()">Saqlash</button>
<div id="settings-result" class="mt-2"></div>"""

SETTINGS_JS = """<script>
// Every key the backend reads live. The page used to expose only the first four, so the
// eight loyalty/referral values — which decide how much bonus money is paid out — could
// be changed only with direct database access.
const SETTING_FIELDS=[
['set-commission','commission_percent'],
['set-trial-days','free_trial_days'],
['set-trial-limit','free_trial_limit'],
['set-min-balance','min_balance'],
['set-loyalty-points','loyalty_points_per_ride'],
['set-loyalty-threshold','loyalty_reward_threshold'],
['set-loyalty-reward','loyalty_reward_bonus'],
['set-bonus-max','bonus_max_per_ride'],
['set-ref-referrer','referral_referrer_bonus'],
['set-ref-new','referral_new_user_bonus'],
['set-ref-rides','referral_new_user_max_rides'],
['set-ref-max','referral_max_rewarded']
];
function loadSettings(){
fetch('/admin/api/settings').then(r=>r.json()).then(d=>{
if(!d||d.error){adminError(d&&d.error?d.error:'Sozlamalarni yuklab bo\\'lmadi');return;}
// `??`, not `||`: 0 is a legal value for these settings, and `||` displayed a saved
// 0% commission as 10% — then the next Save wrote that 10% back.
SETTING_FIELDS.forEach(([id,key])=>{const el=document.getElementById(id);if(el)el.value=d[key]??'';});
const used=document.getElementById('set-trial-used');
if(used)used.textContent=fmtNum(d.free_trial_granted_count);
const mt=document.getElementById('set-maintenance');
if(mt)mt.checked=!!d.maintenance_mode;
}).catch(()=>adminError('Sozlamalarni yuklab bo\\'lmadi'));
}
function saveSettings(){
const out=document.getElementById('settings-result');
const body={};
for(const [id,key] of SETTING_FIELDS){
const el=document.getElementById(id);
if(!el)continue;
const raw=String(el.value).trim();
// Validate here instead of shipping NaN -> JSON null to the server.
if(!/^\\d+$/.test(raw)){out.innerHTML='<div class="alert alert-danger">"'+esc(el.previousElementSibling?el.previousElementSibling.textContent:key)+'" butun son bo\\'lishi kerak (bo\\'sh qoldirmang)</div>';el.focus();return;}
body[key]=parseInt(raw,10);
}
const mt=document.getElementById('set-maintenance');
if(mt){
if(mt.checked&&!confirm('Texnik xizmat rejimini YOQMOQCHIMISIZ? Bot foydalanuvchilarga xizmat to\\'xtatilgani haqida xabar beradi.'))return;
body.maintenance_mode=mt.checked;
}
fetch('/admin/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(d=>{
out.innerHTML='<div class="alert alert-'+(d.error?'danger':'success')+'">'+esc(d.detail||d.error||'Saqlandi')+'</div>';
if(!d.error)loadSettings();
}).catch(()=>{out.innerHTML='<div class="alert alert-danger">Saqlashda xatolik</div>';});
}
loadSettings();
</script>"""


# Sidebar entries, in display order. Kept as data so the current page can be highlighted
# (the stylesheet always had a `.sidebar a.active` rule, but nothing ever set the class).
NAV_ITEMS = (
    ("/admin/", "Dashboard"),
    ("/admin/statistics", "📊 Statistika"),
    ("/admin/drivers", "Haydovchilar"),
    ("/admin/passengers", "Yo'lovchilar"),
    ("/admin/orders", "Buyurtmalar"),
    ("/admin/push", "Push xabar"),
    ("/admin/push-log", "🔔 Push diagnostika"),
    ("/admin/routes", "Yo'nalishlar"),
    ("/admin/payments", "💳 To'lovlar"),
    ("/admin/settings", "Sozlamalar"),
    ("/admin/audit", "🧾 Audit jurnali"),
)


def render_nav(active=""):
    """Build the sidebar, marking `active` (a path from NAV_ITEMS) as current."""
    links = []
    for href, label in NAV_ITEMS:
        cls = ' class="active"' if href == active else ""
        links.append(f'<a href="{href}"{cls}>{label}</a>')
    return "\n".join(links)


def render_page(title, content, extra_js="", active="", csrf_token=""):
    """Render a page using the base template.

    `csrf_token` is rendered into the logout form server-side: it used to be filled only
    by an inline DOMContentLoaded handler, so with that script blocked logout was a
    permanent 403.
    """
    from html import escape

    return BASE_HTML.format(
        title=title,
        content=content,
        nav=render_nav(active),
        csrf_token=escape(csrf_token or "", quote=True),
        bootstrap_css=BOOTSTRAP_CSS,
        bootstrap_js=BOOTSTRAP_JS,
        extra_js=extra_js,
    )


AUDIT_HTML = """<h2>🧾 Audit jurnali</h2>
<p class="text-muted">Panelda bajarilgan har bir muhim amal shu yerda yozib boriladi:
kim, qachon, qaysi IP dan. Bu jurnal faqat o'qish uchun — o'zgartirilmaydi va o'chirilmaydi.</p>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="audit-action" onchange="loadAudit()">
<option value="">Barcha amallar</option>
<option value="auth.">Kirish / chiqish</option>
<option value="driver.">Haydovchi amallari</option>
<option value="driver.balance_adjust">Balans o'zgarishi</option>
<option value="user.">Yo'lovchi amallari</option>
<option value="route.">Narx o'zgarishi</option>
<option value="settings.">Sozlama o'zgarishi</option>
<option value="push.">Push xabarlar</option>
</select>
<select class="form-select w-auto d-inline ms-1" id="audit-limit" onchange="loadAudit()">
<option value="200">Oxirgi 200</option>
<option value="500">Oxirgi 500</option>
<option value="50">Oxirgi 50</option>
</select>
<span class="ms-2 text-muted" id="audit-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="audit-table">
<thead><tr><th>ID</th><th>Sana</th><th>Kim</th><th>Amal</th><th>Obyekt</th><th>IP</th><th>Tafsilot</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

AUDIT_JS = """<script>
const AUDIT_LABELS={'auth.login_success':'Kirdi','auth.login_failure':'Kirish xato','auth.logout':'Chiqdi','auth.rate_limited':'Cheklandi','driver.verify':'Haydovchi tasdiqlandi','driver.reject':'Haydovchi rad etildi','driver.block':'Haydovchi bloklandi','driver.unblock':'Haydovchi blokdan chiqdi','driver.create':'Haydovchi qo\\'shildi','driver.balance_adjust':'Balans o\\'zgardi','user.block':'Yo\\'lovchi bloklandi','user.unblock':'Yo\\'lovchi blokdan chiqdi','route.update':'Narx o\\'zgardi','settings.update':'Sozlama o\\'zgardi','push.send':'Push yuborildi'};
// Turn the stored JSON detail blob into something readable instead of dumping it raw.
function auditDetails(raw){
if(!raw)return '';
let o;
try{o=JSON.parse(raw);}catch(e){return esc(String(raw));}
if(!o||typeof o!=='object')return esc(String(raw));
const label={amount:'summa',balance_after:'yangi balans',idempotency_key:'kalit',phone:'telefon',username:'login',recipients:'qabul qiluvchilar',sent_count:'yuborildi',push_sent:'push',telegram_sent:'telegram',unreached:'yetmadi',announcement_id:'xabar ID',before:'oldin',after:'keyin',changes:"o'zgarishlar",recipient_type:'turi',is_verified:'tasdiqlangan',telegram_queued:'telegram navbatda'};
const parts=[];
for(const [k,v] of Object.entries(o)){
if(v===null||v===''||(typeof v==='object'&&!Object.keys(v||{}).length))continue;
const name=label[k]||k;
const val=(typeof v==='object')?JSON.stringify(v):String(v);
parts.push(esc(name)+': '+esc(typeof v==='number'?fmtNum(v):val));
}
return parts.join(' · ');
}
function loadAudit(){
const act=document.getElementById('audit-action').value;
const lim=document.getElementById('audit-limit').value;
fetch('/admin/api/audit?action='+encodeURIComponent(act)+'&limit='+encodeURIComponent(lim)).then(r=>r.json()).then(payload=>{
const tb=document.querySelector('#audit-table tbody');
tb.innerHTML='';
const data=Array.isArray(payload)?payload:[];
if(!Array.isArray(payload))adminError(payload&&payload.error?payload.error:'Jurnalni yuklab bo\\'lmadi');
document.getElementById('audit-count').textContent=data.length+' ta yozuv'+(data.length>=Number(lim)?' (eng yangilari — cheklov '+lim+')':'');
if(!data.length)tb.innerHTML='<tr><td colspan="7" class="text-muted">Yozuv yo\\'q</td></tr>';
data.forEach(r=>{
const label=AUDIT_LABELS[r.action]||r.action;
const money=r.action==='driver.balance_adjust';
const target=r.target_type?esc(r.target_type)+(r.target_id?' #'+esc(r.target_id):''):'-';
tb.innerHTML+=`<tr${money?' class="table-warning"':''}><td>${Number(r.id)}</td><td class="small">${esc(fmtDt(r.created_at))}</td><td>${esc(r.admin_username||'')}</td><td>${esc(label)}</td><td>${target}</td><td class="small">${esc(r.remote_ip||'-')}</td><td class="small text-muted" style="max-width:380px;word-break:break-word">${auditDetails(r.details)}</td></tr>`;
});
}).catch(()=>adminError('Jurnalni yuklab bo\\'lmadi'));
}
loadAudit();
</script>"""

PAYMENTS_HTML = """<h2>💳 To'lovlar (balans to'ldirish)</h2>
<p class="text-muted">Haydovchilar yuborgan kvitansiyalar. Tasdiqlansa balans avtomatik
to'ldiriladi va birinchi to'lov uchun <b>+50% bonus</b> beriladi (bir marta).
Tasdiqlash bot orqali ham mumkin — ikkalasi bir xil himoyalangan yo'ldan o'tadi,
ya'ni ikki marta pul tushishi mumkin emas.</p>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="pay-status" onchange="loadPayments(1)">
<option value="pending">Kutilmoqda</option>
<option value="approved">Tasdiqlangan</option>
<option value="rejected">Rad etilgan</option>
<option value="cancelled">Muddati o'tgan</option>
<option value="all">Barchasi</option>
</select>
<span class="ms-2 badge bg-warning text-dark" id="pay-pending-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm align-middle" id="payments-table">
<thead><tr><th>ID</th><th>Haydovchi</th><th>Summa</th><th>Turi</th><th>Holat</th><th>Kvitansiya</th><th>Sana</th><th>Amal</th></tr></thead>
<tbody></tbody>
</table>
</div>
<div id="payments-pager" class="mt-2"></div>
<div class="modal fade" id="receipt-modal" tabindex="-1">
<div class="modal-dialog modal-lg modal-dialog-centered">
<div class="modal-content">
<div class="modal-header"><h5 class="modal-title">Kvitansiya</h5>
<button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
<div class="modal-body text-center" id="receipt-body">Yuklanmoqda...</div>
</div>
</div>
</div>"""

PAYMENTS_JS = """<script>
const PAY_STATUS={pending:{l:'Kutilmoqda',c:'bg-warning text-dark'},processing:{l:'Ishlanmoqda',c:'bg-info'},approved:{l:'Tasdiqlangan',c:'bg-success'},rejected:{l:'Rad etilgan',c:'bg-danger'},cancelled:{l:"Muddati o'tgan",c:'bg-secondary'}};
const PAY_PROVIDER={manual_app:'Ilova',manual_bot:'Telegram',click:'Click'};
let payPage=1;
function loadPayments(page){
payPage=page||payPage;
const st=document.getElementById('pay-status').value;
fetch('/admin/api/payments?status='+encodeURIComponent(st)+'&page='+payPage).then(r=>r.json()).then(d=>{
if(!d||d.error||!Array.isArray(d.items)){adminError(d&&d.error?d.error:'To\\'lovlarni yuklab bo\\'lmadi');return;}
const badge=document.getElementById('pay-pending-count');
badge.textContent=d.pending_total?d.pending_total+' ta kutilmoqda':'';
badge.style.display=d.pending_total?'':'none';
const tb=document.querySelector('#payments-table tbody');
tb.innerHTML='';
if(!d.items.length)tb.innerHTML='<tr><td colspan="8" class="text-muted">To\\'lov yo\\'q</td></tr>';
d.items.forEach(p=>{
const st=PAY_STATUS[p.status]||{l:p.status,c:'bg-secondary'};
const who=`<div>${esc(p.driver_name||('#'+Number(p.driver_id)))}${p.driver_blocked?' <span class="badge bg-danger">🚫</span>':''}</div>`+
`<div class="text-muted small">${esc(p.driver_phone||'')} · balans: ${fmtNum(p.driver_balance)}</div>`;
const bonusNote=p.status==='pending'&&p.first_bonus_pending?'<div class="text-success small">+50% bonus beriladi</div>':
(p.bonus_amount?`<div class="text-success small">+${fmtNum(p.bonus_amount)} bonus</div>`:'');
const receipt=p.has_receipt?`<button class="btn btn-sm btn-outline-secondary" onclick="showReceipt(${Number(p.id)})">Ko'rish</button>`:'<span class="text-muted">yo\\'q</span>';
const act=p.status==='pending'
  ?`<button class="btn btn-sm btn-success" onclick="approvePayment(${Number(p.id)},${Number(p.amount)})">Tasdiqlash</button>
    <button class="btn btn-sm btn-outline-danger" onclick="rejectPayment(${Number(p.id)})">Rad etish</button>`
  :`<span class="text-muted small">${esc(fmtDt(p.processed_at))}</span>`;
tb.innerHTML+=`<tr><td>${Number(p.id)}</td><td>${who}</td><td><b>${fmtNum(p.amount)}</b> so'm${bonusNote}</td><td class="small">${esc(PAY_PROVIDER[p.provider]||p.provider)}</td><td><span class="badge ${st.c}">${esc(st.l)}</span></td><td>${receipt}</td><td class="small">${esc(fmtDt(p.created_at))}</td><td>${act}</td></tr>`;
});
renderPager('payments-pager',d,loadPayments);
}).catch(()=>adminError('To\\'lovlarni yuklab bo\\'lmadi'));
}
function showReceipt(id){
const body=document.getElementById('receipt-body');
body.innerHTML='Yuklanmoqda...';
new bootstrap.Modal(document.getElementById('receipt-modal')).show();
const img=new Image();
img.style.maxWidth='100%';
img.onload=()=>{body.innerHTML='';body.appendChild(img);};
img.onerror=()=>{body.innerHTML='<div class="alert alert-warning mb-0">Kvitansiyani yuklab bo\\'lmadi. Telegram orqali yuborilgan bo\\'lsa, bot ulanmagan bo\\'lishi mumkin.</div>';};
img.src='/admin/api/payments/'+id+'/receipt';
}
const _payInFlight={};
function approvePayment(id,amount){
if(_payInFlight[id]){alert('Iltimos kutib turing...');return;}
if(!confirm('To\\'lovni tasdiqlaysizmi?\\n\\n'+fmtNum(amount)+" so'm haydovchi balansiga qo'shiladi.\\nBu amalni bekor qilish mumkin emas."))return;
_payInFlight[id]=true;
fetch('/admin/api/payments/'+id+'/approve',{method:'POST'}).then(r=>r.json()).then(d=>{
alert(d.detail||d.error||'OK');loadPayments();
}).catch(()=>alert('Xatolik')).finally(()=>{delete _payInFlight[id];});
}
function rejectPayment(id){
if(_payInFlight[id]){alert('Iltimos kutib turing...');return;}
if(!confirm('To\\'lovni rad etamizmi? Haydovchiga xabar boradi.'))return;
_payInFlight[id]=true;
fetch('/admin/api/payments/'+id+'/reject',{method:'POST'}).then(r=>r.json()).then(d=>{
alert(d.detail||d.error||'OK');loadPayments();
}).catch(()=>alert('Xatolik')).finally(()=>{delete _payInFlight[id];});
}
loadPayments(1);
</script>"""

CSRF_ERROR_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sessiya eskirgan - Sarix Go Admin</title>
<link rel="stylesheet" href="{bootstrap_css}">
</head>
<body class="bg-light">
<div class="container">
<div class="row justify-content-center mt-5">
<div class="col-md-5">
<div class="card shadow"><div class="card-body p-4 text-center">
<h5 class="mb-3">Sessiya eskirgan</h5>
<p class="text-muted">Xavfsizlik tekshiruvi (CSRF) o'tmadi. Bu ko'pincha sahifa uzoq vaqt
ochiq qolganda yoki ikkita oynada bir vaqtda ishlaganda bo'ladi.</p>
<a class="btn btn-primary" href="/admin/login">Qaytadan kirish</a>
</div></div>
</div>
</div>
</div>
</body>
</html>"""


def render_csrf_error():
    """Styled page for a failed CSRF check.

    This used to be `web.Response(text="CSRF validation failed")` — a bare plain-text
    dead end with no way back to the login form.
    """
    return CSRF_ERROR_HTML.format(bootstrap_css=BOOTSTRAP_CSS)


def render_login(error="", csrf_token=""):
    """Render the login page."""
    from html import escape

    error_html = ""
    if error:
        error_html = '<div class="alert alert-danger">{}</div>'.format(escape(error))
    return LOGIN_HTML.format(
        bootstrap_css=BOOTSTRAP_CSS,
        error=error_html,
        csrf_token=escape(csrf_token, quote=True),
    )
