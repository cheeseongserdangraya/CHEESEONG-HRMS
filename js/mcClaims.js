// 医药费报销模块
var mcClaims = [];
var MC_ANNUAL_CAP = 500;
var MC_RATE = 0.5;

async function fetchMcClaims(){
  var { data, error } = await sb.from('mc_claims').select('*').order('date', { ascending: false });
  if(error){ alert('读取医药报销记录失败:' + error.message); return; }
  mcClaims = data.map(function(row){ return rowToObj(MC_FIELD_MAP, row); });
}

function populateMcEmployeeSelect(){
  var company = document.getElementById('mc-company').value;
  var sel = document.getElementById('mc-employee');
  var active = employees.filter(function(e){ return e.company===company && (e.status||'在职')==='在职'; });
  sel.innerHTML = active.map(function(e){ return '<option value="'+e.id+'">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</option>'; }).join('');
  if(active.length===0){ sel.innerHTML = '<option value="">该公司暂无在职员工</option>'; }
  updateMcBalancePreview();
}

function mcYearUsed(employeeId, year, excludeId){
  return mcClaims.filter(function(c){ return c.employeeId===employeeId && (c.date||'').slice(0,4)===year && c.id!==excludeId; })
    .reduce(function(s,c){ return s + c.claimAmount; }, 0);
}

function updateMcBalancePreview(){
  var employeeId = document.getElementById('mc-employee').value;
  var date = document.getElementById('mc-date').value;
  var bill = Number(document.getElementById('mc-bill').value)||0;
  var el = document.getElementById('mc-preview');
  if(!employeeId || !date){ el.innerHTML = '<span style="color:var(--text-muted);">请先选择员工和日期</span>'; return; }
  var year = date.slice(0,4);
  var used = mcYearUsed(employeeId, year);
  var remaining = round2(MC_ANNUAL_CAP - used);
  var wantClaim = round2(bill * MC_RATE);
  var actualClaim = Math.max(0, Math.min(wantClaim, remaining));
  var capped = wantClaim > remaining;
  el.innerHTML = '该员工 '+year+' 年已报销:<b>'+fmt(used)+'</b> / RM'+MC_ANNUAL_CAP+' &nbsp;|&nbsp; 剩余额度:<b>'+fmt(remaining)+'</b><br/>'
    + '本次可报销(50%):<b style="color:var(--accent);">'+fmt(actualClaim)+'</b>'
    + (capped ? ' <span style="color:var(--danger);">(已超过年度上限,自动封顶)</span>' : '');
}

async function addMcClaim(){
  if(!isAdmin()) return;
  var employeeId = document.getElementById('mc-employee').value;
  var bill = Number(document.getElementById('mc-bill').value)||0;
  var date = document.getElementById('mc-date').value;
  if(!employeeId){ document.getElementById('mc-msg').textContent = '请先新增员工资料'; return; }
  if(!date){ document.getElementById('mc-msg').textContent = '请选择日期'; return; }
  if(bill<=0){ document.getElementById('mc-msg').textContent = '请输入医药费金额'; return; }
  var year = date.slice(0,4);
  var used = mcYearUsed(employeeId, year);
  var remaining = round2(MC_ANNUAL_CAP - used);
  var wantClaim = round2(bill * MC_RATE);
  var actualClaim = Math.max(0, round2(Math.min(wantClaim, remaining)));

  var data = {
    employeeId: employeeId,
    company: document.getElementById('mc-company').value,
    date: date,
    billAmount: bill,
    claimAmount: actualClaim,
    clinic: document.getElementById('mc-clinic').value.trim(),
    receipt: document.getElementById('mc-receipt').value.trim(),
    notes: document.getElementById('mc-notes').value.trim()
  };
  var { data: inserted, error } = await sb.from('mc_claims').insert(objToRow(MC_FIELD_MAP, data)).select().single();
  if(error){ document.getElementById('mc-msg').textContent = '新增失败:' + error.message; return; }
  mcClaims.push(rowToObj(MC_FIELD_MAP, inserted));

  ['mc-bill','mc-clinic','mc-receipt','mc-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('mc-msg').textContent = wantClaim>actualClaim ? '已新增(已按年度上限封顶为'+fmt(actualClaim)+')' : '已新增';
  setTimeout(function(){ document.getElementById('mc-msg').textContent=''; }, 2500);
  updateMcBalancePreview();
  renderMcList();
}

async function delMcClaim(id){
  if(!isAdmin()) return;
  if(!confirm('确定删除这笔记录吗?')) return;
  var { error } = await sb.from('mc_claims').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  mcClaims = mcClaims.filter(function(c){ return c.id!==id; });
  renderMcList();
}

function renderMcList(){
  var fc = document.getElementById('mc-filter-company').value;
  var fy = document.getElementById('mc-filter-year').value;
  var list = mcClaims.filter(function(c){
    var okC = fc==='全部' || c.company===fc;
    var okY = !fy || (c.date||'').indexOf(fy)===0;
    return okC && okY;
  });
  var container = document.getElementById('mc-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无 MC / 报销记录</div>'; return; }

  var byEmployee = {};
  var order = [];
  list.forEach(function(c){
    var emp = employees.find(function(e){ return e.id===c.employeeId; });
    var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
    if(!byEmployee[c.employeeId]){ byEmployee[c.employeeId] = { name:name, company:c.company, claims:[] }; order.push(c.employeeId); }
    byEmployee[c.employeeId].claims.push(c);
  });
  order.sort(function(a,b){ return byEmployee[a].name.localeCompare(byEmployee[b].name); });

  var html = '';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    var total = g.claims.reduce(function(s,c){ return s+c.claimAmount; }, 0);
    g.claims.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    html += '<div class="card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<p style="font-weight:600;font-size:14px;margin:0;">'+esc(g.name)+' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">'+esc(g.company)+'</span></p>'
      + '<p style="font-weight:700;font-size:15px;margin:0;color:var(--accent);">已报销合计 '+fmt(total)+(fy?' / RM'+MC_ANNUAL_CAP+' (剩余'+fmt(round2(MC_ANNUAL_CAP-total))+')':'')+'</p>'
      + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">日期</th><th style="text-align:left;padding:4px 6px;">诊所</th><th style="text-align:right;padding:4px 6px;">收据金额</th><th style="text-align:right;padding:4px 6px;">报销(50%)</th><th style="text-align:left;padding:4px 6px;">收据</th><th style="text-align:left;padding:4px 6px;">备注</th><th style="padding:4px 6px;"></th></tr>';
    g.claims.forEach(function(c){
      html += '<tr style="border-top:1px solid var(--border);">'
        + '<td style="padding:6px;">'+esc(c.date)+'</td>'
        + '<td style="padding:6px;">'+esc(c.clinic||'-')+'</td>'
        + '<td style="padding:6px;text-align:right;">'+fmt(c.billAmount)+'</td>'
        + '<td style="padding:6px;text-align:right;font-weight:500;">'+fmt(c.claimAmount)+'</td>'
        + '<td style="padding:6px;">'+(c.receipt?'<a href="'+esc(c.receipt)+'" target="_blank">查看收据↗</a>':'<span style="color:var(--text-muted);">未上传</span>')+'</td>'
        + '<td style="padding:6px;color:var(--text-secondary);">'+esc(c.notes||'-')+'</td>'
        + '<td style="padding:6px;">'+(isAdmin() ? '<button class="secondary small" onclick="delMcClaim(\''+c.id+'\')">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  container.innerHTML = html;
}
