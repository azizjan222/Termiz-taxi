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
</style>
</head>
<body>
<div class="container-fluid">
<div class="row">
<nav class="col-md-2 sidebar p-0">
<div class="p-3 text-white fw-bold">Sarix Go Admin</div>
<a href="/admin/">Dashboard</a>
<a href="/admin/drivers">Haydovchilar</a>
<a href="/admin/passengers">Yo'lovchilar</a>
<a href="/admin/orders">Buyurtmalar</a>
<a href="/admin/push">Push xabar</a>
<a href="/admin/routes">Yo'nalishlar</a>
<a href="/admin/settings">Sozlamalar</a>
<hr class="text-secondary">
<a href="/admin/logout">Chiqish</a>
</nav>
<main class="col-md-10 main-content">
{content}
</main>
</div>
</div>
<script src="{bootstrap_js}"></script>
<script>function esc(s){{if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}}</script>
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
document.getElementById('s-drivers').textContent=d.drivers_count;
document.getElementById('s-passengers').textContent=d.passengers_count;
document.getElementById('s-orders').textContent=d.orders_count;
document.getElementById('s-active').textContent=d.active_orders;
document.getElementById('s-online').textContent=d.online_drivers;
document.getElementById('s-rev-today').textContent=d.revenue_today.toLocaleString()+' sum';
document.getElementById('s-rev-month').textContent=d.revenue_month.toLocaleString()+' sum';
}).catch(e=>console.error(e));
fetch('/admin/api/top-drivers').then(r=>r.json()).then(data=>{
const tb=document.querySelector('#top-drivers-table tbody');
tb.innerHTML='';
(Array.isArray(data)?data:[]).forEach((d,i)=>{
const online=d.is_online?'<span class="badge bg-info">Online</span>':'<span class="badge bg-secondary">Oflayn</span>';
tb.innerHTML+=`<tr><td>${i+1}</td><td>${esc((d.first_name||'')+' '+(d.last_name||''))}</td><td>${esc(d.phone||'')}</td><td>${d.total_orders||0}</td><td>${(d.rating||5).toFixed(1)}</td><td>${online}</td></tr>`;
});
}).catch(e=>console.error(e));
</script>"""

DRIVERS_HTML = """<h2>Haydovchilar</h2>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="driver-filter" onchange="renderDrivers()">
<option value="all">Barchasi</option>
<option value="online">Onlayn</option>
<option value="verified">Tasdiqlangan</option>
<option value="pending">Kutilmoqda</option>
</select>
<span class="ms-2 text-muted" id="driver-count"></span>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="drivers-table">
<thead><tr><th>ID</th><th>Ism</th><th>Telefon</th><th>Mashina</th><th>Raqam</th><th>Balans</th><th>Zakaslar</th><th>Holat</th><th>Amallar</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

DRIVERS_JS = """<script>
let allDrivers=[];
function loadDrivers(){
fetch('/admin/api/drivers').then(r=>r.json()).then(data=>{allDrivers=Array.isArray(data)?data:[];renderDrivers();});
}
function renderDrivers(){
const f=document.getElementById('driver-filter').value;
let data=allDrivers;
if(f==='online')data=allDrivers.filter(d=>d.is_online);
else if(f==='verified')data=allDrivers.filter(d=>d.is_verified);
else if(f==='pending')data=allDrivers.filter(d=>!d.is_verified&&d.documents_submitted);
document.getElementById('driver-count').textContent=data.length+' ta';
const tb=document.querySelector('#drivers-table tbody');
tb.innerHTML='';
data.forEach(d=>{
const status=d.is_verified?'<span class="badge bg-success">Tasdiqlangan</span>':
(d.documents_submitted?'<span class="badge bg-warning">Kutilmoqda</span>':'<span class="badge bg-secondary">Tasdiqlanmagan</span>');
const online=d.is_online?'<span class="badge bg-info">Online</span>':'';
tb.innerHTML+=`<tr>
<td>${d.id}</td><td>${esc(d.first_name||'')} ${esc(d.last_name||'')}</td><td>${esc(d.phone)}</td>
<td>${esc(d.car_model||'-')}</td><td>${esc(d.car_number||'-')}</td><td>${d.balance.toLocaleString()}</td>
<td>${d.total_orders||0}</td>
<td>${status} ${online}</td>
<td>
${!d.is_verified?`<button class="btn btn-sm btn-success" onclick="verifyDriver(${d.id})">Tasdiqlash</button>`:''}
${d.is_verified?`<button class="btn btn-sm btn-danger" onclick="rejectDriver(${d.id})">Rad etish</button>`:''}
<button class="btn btn-sm btn-outline-primary" onclick="pushDriver(${d.id})">Push</button>
<a class="btn btn-sm btn-outline-secondary" href="/admin/api/drivers/${d.id}/pdf" target="_blank" rel="noopener">PDF</a>
</td></tr>`;
});
}
function verifyDriver(id){fetch('/admin/api/drivers/'+id+'/verify',{method:'POST'}).then(()=>loadDrivers());}
function rejectDriver(id){fetch('/admin/api/drivers/'+id+'/reject',{method:'POST'}).then(()=>loadDrivers());}
function pushDriver(id){
const msg=prompt('Xabar matni:');
if(msg)fetch('/admin/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target:'specific',recipient_id:id,recipient_type:'driver',message:msg})}).then(r=>r.json()).then(d=>alert(d.detail||'Yuborildi'));
}
loadDrivers();
</script>"""

PASSENGERS_HTML = """<h2>Yo'lovchilar</h2>
<div class="table-responsive">
<table class="table table-striped table-sm" id="passengers-table">
<thead><tr><th>ID</th><th>Ism</th><th>Telefon</th><th>Til</th><th>Bonus</th><th>Reyting</th><th>Ro'yxatdan o'tgan</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

PASSENGERS_JS = """<script>
fetch('/admin/api/passengers').then(r=>r.json()).then(data=>{
const tb=document.querySelector('#passengers-table tbody');
tb.innerHTML='';
data.forEach(u=>{
tb.innerHTML+=`<tr><td>${u.id}</td><td>${esc(u.first_name||'')} ${esc(u.last_name||'')}</td><td>${esc(u.phone)}</td><td>${esc(u.language||'uz')}</td><td>${u.bonus_balance}</td><td>${u.rating}</td><td>${esc(u.created_at||'')}</td></tr>`;
});
});
</script>"""

ORDERS_HTML = """<h2>Buyurtmalar</h2>
<div class="mb-3">
<select class="form-select w-auto d-inline" id="status-filter" onchange="loadOrders()">
<option value="all">Barchasi</option>
<option value="active">Faol (yangi/qabul/jarayonda)</option>
<option value="new">Yangi</option>
<option value="accepted">Qabul qilingan</option>
<option value="in_progress">Jarayonda</option>
<option value="completed">Yakunlangan</option>
<option value="cancelled">Bekor qilingan</option>
</select>
</div>
<div class="table-responsive">
<table class="table table-striped table-sm" id="orders-table">
<thead><tr><th>ID</th><th>Yo'lovchi</th><th>Telefon</th><th>Yo'nalish</th><th>Narx</th><th>Holat</th><th>Sana</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

ORDERS_JS = """<script>
function loadOrders(){
const st=document.getElementById('status-filter').value;
fetch('/admin/api/orders?status='+st).then(r=>r.json()).then(data=>{
const tb=document.querySelector('#orders-table tbody');
tb.innerHTML='';
data.forEach(o=>{
const badge={'new':'bg-primary','accepted':'bg-info','completed':'bg-success','cancelled':'bg-danger'}[o.status]||'bg-secondary';
tb.innerHTML+=`<tr><td>${o.id}</td><td>${esc(o.passenger_name||'-')}</td><td>${esc(o.passenger_phone)}</td><td>${esc(o.from_city)} - ${esc(o.to_city)}</td><td>${o.price.toLocaleString()}</td><td><span class="badge ${badge}">${esc(o.status)}</span></td><td>${esc(o.created_at||'')}</td></tr>`;
});
});
}
loadOrders();
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
<button class="btn btn-primary" onclick="sendPush()">Yuborish</button>
<div id="push-result" class="mt-2"></div>
</div>
</div>"""

PUSH_JS = """<script>
function toggleRecipient(){
const v=document.getElementById('push-target').value;
document.getElementById('recipient-row').classList.toggle('d-none',v!=='specific');
}
function sendPush(){
const target=document.getElementById('push-target').value;
const message=document.getElementById('push-message').value;
const recipient_id=parseInt(document.getElementById('push-recipient').value)||null;
const recipient_type=document.getElementById('push-rtype').value;
fetch('/admin/api/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({target,message,recipient_id,recipient_type})})
.then(r=>r.json()).then(d=>{
document.getElementById('push-result').innerHTML='<div class="alert alert-'+(d.error?'danger':'success')+'">'+esc(d.detail||d.error||'Yuborildi')+'</div>';
}).catch(e=>{document.getElementById('push-result').innerHTML='<div class="alert alert-danger">Xato</div>';});
}
</script>"""

ROUTES_HTML = """<h2>Yo'nalishlar va narxlar</h2>
<div class="table-responsive">
<table class="table table-striped table-sm" id="routes-table">
<thead><tr><th>ID</th><th>Qayerdan</th><th>Qayerga</th><th>Narx (1 kishi)</th><th>To'liq mashina</th><th>Pochta</th><th>Amal</th></tr></thead>
<tbody></tbody>
</table>
</div>"""

ROUTES_JS = """<script>
function loadRoutes(){
fetch('/admin/api/routes').then(r=>r.json()).then(data=>{
const tb=document.querySelector('#routes-table tbody');
tb.innerHTML='';
data.forEach(rt=>{
tb.innerHTML+=`<tr>
<td>${rt.id}</td><td>${esc(rt.from_city)}</td><td>${esc(rt.to_city)}</td>
<td><input type="number" class="form-control form-control-sm" value="${rt.price_per_person}" id="pp-${rt.id}" style="width:100px"></td>
<td><input type="number" class="form-control form-control-sm" value="${rt.full_car_price}" id="fc-${rt.id}" style="width:100px"></td>
<td><input type="number" class="form-control form-control-sm" value="${rt.parcel_price}" id="pr-${rt.id}" style="width:100px"></td>
<td><button class="btn btn-sm btn-success" onclick="saveRoute(${rt.id})">Saqlash</button></td>
</tr>`;
});
});
}
function saveRoute(id){
const body={price_per_person:parseInt(document.getElementById('pp-'+id).value),full_car_price:parseInt(document.getElementById('fc-'+id).value),parcel_price:parseInt(document.getElementById('pr-'+id).value)};
fetch('/admin/api/routes/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(d=>{if(d.ok)alert('Saqlandi');else alert(d.error||'Xato');});
}
loadRoutes();
</script>"""

SETTINGS_HTML = """<h2>Sozlamalar</h2>
<div class="card" style="max-width:500px;">
<div class="card-body">
<div class="mb-3">
<label class="form-label">Komissiya (%) - har bir zakazdan</label>
<input type="number" class="form-control" id="set-commission">
</div>
<div class="mb-3">
<label class="form-label">Bepul sinov muddati (kun)</label>
<input type="number" class="form-control" id="set-trial-days">
</div>
<div class="mb-3">
<label class="form-label">Bepul haydovchilar limiti</label>
<input type="number" class="form-control" id="set-trial-limit">
</div>
<div class="mb-3">
<label class="form-label">Minimal balans (sum)</label>
<input type="number" class="form-control" id="set-min-balance">
</div>
<button class="btn btn-primary" onclick="saveSettings()">Saqlash</button>
<div id="settings-result" class="mt-2"></div>
</div>
</div>"""

SETTINGS_JS = """<script>
fetch('/admin/api/settings').then(r=>r.json()).then(d=>{
document.getElementById('set-commission').value=d.commission_percent||10;
document.getElementById('set-trial-days').value=d.free_trial_days||30;
document.getElementById('set-trial-limit').value=d.free_trial_limit||100;
document.getElementById('set-min-balance').value=d.min_balance||20000;
});
function saveSettings(){
const body={commission_percent:parseInt(document.getElementById('set-commission').value),free_trial_days:parseInt(document.getElementById('set-trial-days').value),free_trial_limit:parseInt(document.getElementById('set-trial-limit').value),min_balance:parseInt(document.getElementById('set-min-balance').value)};
fetch('/admin/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(d=>{
document.getElementById('settings-result').innerHTML='<div class="alert alert-'+(d.error?'danger':'success')+'">'+esc(d.detail||d.error||'Saqlandi')+'</div>';
});
}
</script>"""


def render_page(title, content, extra_js=""):
    """Render a page using the base template."""
    return BASE_HTML.format(
        title=title,
        content=content,
        bootstrap_css=BOOTSTRAP_CSS,
        bootstrap_js=BOOTSTRAP_JS,
        extra_js=extra_js,
    )


def render_login(error=""):
    """Render the login page."""
    error_html = ""
    if error:
        error_html = '<div class="alert alert-danger">{}</div>'.format(error)
    return LOGIN_HTML.format(bootstrap_css=BOOTSTRAP_CSS, error=error_html)
