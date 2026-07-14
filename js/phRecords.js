// PH假期换钱/换假期记录模块
var phRecords = [];
var phSelected = {}; // employeeId -> 'cash' | 'leave' | null(已勾选但还没选)

async function fetchPhRecords(){
  var { data, error } = await sb.from('ph_records').select('*').order('batch_month', { ascending: false });
  if(error){ alert('读取PH假期记录失败:' + error.message); return; }
  phRecords = data.map(function(row){ return rowToObj(PH_FIELD_MAP, row); });
}

// PH假期额度不套用公式,单纯是「记录里选换假期的天数总和」
function phLeaveAccrued(employeeId){
  return round2(phRecords.filter(function(r){ return r.employeeId===employeeId && r.choice==='leave'; })
    .reduce(function(s,r){ return s + (Number(r.days)||0); }, 0));
}
function phLeaveUsedAllTime(employeeId, excludeId){
  return round2(leaveRecords.filter(function(r){ return r.employeeId===employeeId && r.type==='PH假期' && r.id!==excludeId; })
    .reduce(function(s,r){ return s + r.days; }, 0));
}
function phLeaveRemaining(employeeId, excludeId){
  return round2(phLeaveAccrued(employeeId) - phLeaveUsedAllTime(employeeId, excludeId));
}

var PH_COMPANY_ORDER = {'FIRSTONE':0, 'CS FIRSTONE':1, 'TONGPOPO':2};

function renderPhChecklist(){
  var fc = document.getElementById('ph-checklist-company').value;
  var list = employees.filter(function(e){
    var okC = fc==='全部' || e.company===fc;
    return okC && (e.status||'在职')==='在职';
  });
  var container = document.getElementById('ph-checklist');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无在职员工</div>'; return; }

  var byCompany = {};
  var order = [];
  list.forEach(function(e){
    var c = e.company || '未指定公司';
    if(!byCompany[c]){ byCompany[c] = []; order.push(c); }
    byCompany[c].push(e);
  });
  order.sort(function(a,b){
    var ca = PH_COMPANY_ORDER[a]!==undefined ? PH_COMPANY_ORDER[a] : 99;
    var cb = PH_COMPANY_ORDER[b]!==undefined ? PH_COMPANY_ORDER[b] : 99;
    return ca-cb;
  });
  order.forEach(function(c){ byCompany[c].sort(function(a,b){ return (a.nameEn||'').localeCompare(b.nameEn||''); }); });

  var html = '';
  order.forEach(function(c){
    html += '<div style="padding:8px 16px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border);">'+esc(c)+'</div>';
    byCompany[c].forEach(function(e){
      var checked = phSelected.hasOwnProperty(e.id) ? 'checked' : '';
      html += '<label class="emp-row-head" style="cursor:pointer;">'
        + '<input type="checkbox" data-emp="'+e.id+'" '+checked+' onchange="togglePhSelect(this)" style="width:auto;margin-right:10px;" />'
        + '<div style="flex:1;">'+esc(e.nameEn)+(e.nameCn?' <span class="cn">'+esc(e.nameCn)+'</span>':'')+'</div>'
        + '</label>';
    });
  });
  container.innerHTML = html;
}

function togglePhSelect(cb){
  var empId = cb.getAttribute('data-emp');
  if(cb.checked){ if(!phSelected.hasOwnProperty(empId)) phSelected[empId] = null; }
  else { delete phSelected[empId]; }
  renderPhSelectedTable();
}

function renderPhSelectedTable(){
  var ids = Object.keys(phSelected);
  var container = document.getElementById('ph-selected-table');
  if(ids.length===0){ container.innerHTML = '<div class="empty-state">还没有勾选员工</div>'; return; }
  var rows = ids.map(function(id){ return employees.find(function(e){ return e.id===id; }); }).filter(Boolean);
  rows.sort(function(a,b){
    var ca = PH_COMPANY_ORDER[a.company]!==undefined ? PH_COMPANY_ORDER[a.company] : 99;
    var cb = PH_COMPANY_ORDER[b.company]!==undefined ? PH_COMPANY_ORDER[b.company] : 99;
    if(ca!==cb) return ca-cb;
    return (a.nameEn||'').localeCompare(b.nameEn||'');
  });

  var html = '<table class="pay-table"><tr><th>公司</th><th>姓名</th><th>换钱</th><th>换假期</th></tr>';
  rows.forEach(function(e){
    var choice = phSelected[e.id];
    html += '<tr>'
      + '<td>'+esc(e.company)+'</td>'
      + '<td style="font-weight:500;white-space:nowrap;">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</td>'
      + '<td><input type="checkbox" data-emp="'+e.id+'" data-choice="cash" '+(choice==='cash'?'checked':'')+' onchange="setPhChoice(this)" style="width:auto;" /></td>'
      + '<td><input type="checkbox" data-emp="'+e.id+'" data-choice="leave" '+(choice==='leave'?'checked':'')+' onchange="setPhChoice(this)" style="width:auto;" /></td>'
      + '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;
}

function setPhChoice(cb){
  var empId = cb.getAttribute('data-emp');
  var choice = cb.getAttribute('data-choice');
  if(cb.checked){ phSelected[empId] = choice; }
  else if(phSelected[empId]===choice){ phSelected[empId] = null; }
  renderPhSelectedTable();
}

async function savePhBatch(){
  if(!isAdmin()) return;
  var batchMonth = document.getElementById('ph-batch-month').value;
  var days = Number(document.getElementById('ph-days').value)||1;
  var description = document.getElementById('ph-description').value.trim();
  var msgEl = document.getElementById('ph-msg');
  msgEl.textContent = '';
  if(!batchMonth){ msgEl.textContent = '请选择这批PH对应的年月'; return; }
  var ids = Object.keys(phSelected);
  if(ids.length===0){ msgEl.textContent = '请先在上面勾选员工'; return; }
  var missing = ids.filter(function(id){ return !phSelected[id]; });
  if(missing.length>0){ msgEl.textContent = '还有 '+missing.length+' 位员工没选换钱或换假期,请选完再保存'; return; }

  var rows = ids.map(function(id){
    var e = employees.find(function(x){ return x.id===id; });
    return objToRow(PH_FIELD_MAP, {
      employeeId: id, company: e ? e.company : '', batchMonth: batchMonth,
      description: description, days: days, choice: phSelected[id]
    });
  });
  var { data: inserted, error } = await sb.from('ph_records').insert(rows).select();
  if(error){ msgEl.textContent = '保存失败:' + error.message; return; }
  phRecords = phRecords.concat(inserted.map(function(row){ return rowToObj(PH_FIELD_MAP, row); }));
  phSelected = {};
  document.getElementById('ph-description').value = '';
  renderPhChecklist();
  renderPhSelectedTable();
  renderPhHistory();
  msgEl.textContent = '已保存 ' + ids.length + ' 笔';
  setTimeout(function(){ msgEl.textContent=''; }, 2500);
}

function renderPhHistory(){
  var fc = document.getElementById('ph-history-company').value;
  var fm = document.getElementById('ph-history-month').value;
  var list = phRecords.filter(function(r){
    var okC = fc==='全部' || r.company===fc;
    var okM = !fm || r.batchMonth===fm;
    return okC && okM;
  });

  renderPhHistorySummary(list);

  var container = document.getElementById('ph-history-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无记录</div>'; return; }

  function empSortKey(id){
    var e = employees.find(function(x){ return x.id===id; });
    var c = e ? (PH_COMPANY_ORDER[e.company]!==undefined ? PH_COMPANY_ORDER[e.company] : 99) : 99;
    var n = e ? (e.nameEn||'') : '';
    return { c:c, n:n };
  }

  var byBatch = {};
  var order = [];
  list.forEach(function(r){
    var key = r.batchMonth + '|' + (r.description||'');
    if(!byBatch[key]){ byBatch[key] = { batchMonth:r.batchMonth, description:r.description, records:[] }; order.push(key); }
    byBatch[key].records.push(r);
  });
  order.sort(function(a,b){ return byBatch[b].batchMonth.localeCompare(byBatch[a].batchMonth); });

  var html = '<details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-secondary);padding:8px 0;">📋 查看明细(照批次列出,点开才看得到)</summary>';
  order.forEach(function(key){
    var g = byBatch[key];
    g.records.sort(function(a,b){
      var ka = empSortKey(a.employeeId), kb = empSortKey(b.employeeId);
      if(ka.c!==kb.c) return ka.c-kb.c;
      return ka.n.localeCompare(kb.n);
    });
    html += '<div class="card">';
    html += '<p style="font-weight:600;font-size:14px;margin:0 0 10px;">'+esc(g.batchMonth)+(g.description?' · '+esc(g.description):'')+'</p>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">公司</th><th style="text-align:left;padding:4px 6px;">姓名</th><th style="text-align:left;padding:4px 6px;">选择</th><th style="text-align:right;padding:4px 6px;">天数</th><th style="padding:4px 6px;"></th></tr>';
    g.records.forEach(function(r){
      var emp = employees.find(function(e){ return e.id===r.employeeId; });
      var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
      html += '<tr style="border-top:1px solid var(--border);">'
        + '<td style="padding:6px;">'+esc(r.company)+'</td>'
        + '<td style="padding:6px;">'+esc(name)+'</td>'
        + '<td style="padding:6px;color:'+(r.choice==='cash'?'var(--accent)':'var(--success)')+';font-weight:500;">'+(r.choice==='cash'?'换钱':'换假期')+'</td>'
        + '<td style="padding:6px;text-align:right;">'+r.days+'</td>'
        + '<td style="padding:6px;">'+(isAdmin() ? '<button class="secondary small" onclick="delPhRecord(\''+r.id+'\')">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  html += '</details>';
  container.innerHTML = html;
}

function renderPhHistorySummary(list){
  var container = document.getElementById('ph-history-summary');
  if(list.length===0){ container.innerHTML = ''; return; }

  var byEmp = {};
  var order = [];
  list.forEach(function(r){
    if(!byEmp[r.employeeId]){ byEmp[r.employeeId] = { cash:0, leave:0 }; order.push(r.employeeId); }
    byEmp[r.employeeId][r.choice==='cash' ? 'cash' : 'leave'] += Number(r.days)||0;
  });
  order.sort(function(a,b){
    var ea = employees.find(function(e){ return e.id===a; });
    var eb = employees.find(function(e){ return e.id===b; });
    var ca = ea ? (PH_COMPANY_ORDER[ea.company]!==undefined ? PH_COMPANY_ORDER[ea.company] : 99) : 99;
    var cb = eb ? (PH_COMPANY_ORDER[eb.company]!==undefined ? PH_COMPANY_ORDER[eb.company] : 99) : 99;
    if(ca!==cb) return ca-cb;
    return (ea?ea.nameEn||'':'').localeCompare(eb?eb.nameEn||'':'');
  });

  var html = '<p class="section-label" style="font-size:14px;color:var(--text);font-weight:600;">📊 汇总(依目前筛选的公司/年月加总)</p>';
  html += '<table class="pay-table"><tr><th>公司</th><th>姓名</th><th>换钱合计</th><th>换假期合计</th></tr>';
  order.forEach(function(id){
    var e = employees.find(function(x){ return x.id===id; });
    var s = byEmp[id];
    html += '<tr>'
      + '<td>'+esc(e?e.company:'-')+'</td>'
      + '<td style="font-weight:500;white-space:nowrap;">'+(e ? esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'') : '(已删除员工)')+'</td>'
      + '<td style="color:var(--accent);font-weight:500;">'+round2(s.cash)+' 天</td>'
      + '<td style="color:var(--success);font-weight:500;">'+round2(s.leave)+' 天</td>'
      + '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;
}

async function delPhRecord(id){
  if(!isAdmin()) return;
  if(!confirm('确定删除这笔记录吗?')) return;
  var { error } = await sb.from('ph_records').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  phRecords = phRecords.filter(function(r){ return r.id!==id; });
  renderPhHistory();
}
