// 打卡比对模块:文件预览(纯前端,不存 Supabase) + 迟到/OT 记录(存 Supabase)
var attWorkbook = null;
var otRecords = [];
var lateRecords = [];
var editingOtId = null;
var editingLateId = null;

async function fetchAttendanceRecords(){
  var [lateRes, otRes] = await Promise.all([
    sb.from('attendance_late').select('*').order('date', { ascending: false }),
    sb.from('attendance_ot').select('*').order('date', { ascending: false })
  ]);
  if(lateRes.error){ alert('读取迟到记录失败:' + lateRes.error.message); } else {
    lateRecords = lateRes.data.map(function(row){ return rowToObj(ATT_FIELD_MAP, row); });
  }
  if(otRes.error){ alert('读取OT记录失败:' + otRes.error.message); } else {
    otRecords = otRes.data.map(function(row){ return rowToObj(ATT_FIELD_MAP, row); });
  }
}

function handleAttFile(event){
  var file = event.target.files[0];
  if(!file) return;
  var reader = new FileReader();
  reader.onload = function(e){
    try{
      var data = new Uint8Array(e.target.result);
      attWorkbook = XLSX.read(data, {type:'array'});
      renderAttSheetTabs();
    }catch(err){
      document.getElementById('att-preview').innerHTML = '<div class="empty-state">读取失败,这个文件格式可能不支持,请确认是 .xlsx 或 .xls 文件</div>';
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderAttSheetTabs(){
  var tabsEl = document.getElementById('att-sheet-tabs');
  if(!attWorkbook || attWorkbook.SheetNames.length===0){ tabsEl.style.display='none'; return; }
  tabsEl.style.display = 'flex';
  tabsEl.style.gap = '6px';
  tabsEl.style.flexWrap = 'wrap';
  tabsEl.innerHTML = attWorkbook.SheetNames.map(function(name, idx){
    return '<button type="button" class="secondary small att-sheet-btn" data-idx="'+idx+'">'+esc(name)+'</button>';
  }).join('');
  tabsEl.querySelectorAll('.att-sheet-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ showAttSheet(Number(btn.getAttribute('data-idx'))); });
  });
  showAttSheet(0);
}

function showAttSheet(idx){
  var name = attWorkbook.SheetNames[idx];
  var sheet = attWorkbook.Sheets[name];
  var json = XLSX.utils.sheet_to_json(sheet, {header:1, defval:''});
  var html = '<table style="border-collapse:collapse;font-size:12px;white-space:nowrap;">';
  json.slice(0,200).forEach(function(row, ri){
    html += '<tr>' + row.map(function(cell){
      return (ri===0 ? '<th style="border:1px solid var(--border);padding:4px 8px;background:var(--surface-2);position:sticky;top:0;">' : '<td style="border:1px solid var(--border);padding:4px 8px;">') + esc(String(cell)) + (ri===0?'</th>':'</td>');
    }).join('') + '</tr>';
  });
  html += '</table>';
  if(json.length>200) html += '<p style="font-size:12px;color:var(--text-muted);padding:6px;">只显示前200行</p>';
  document.getElementById('att-preview').innerHTML = html;
}

// ---- OT 记录 ----
function populateOtEmployeeSelect(){
  var company = document.getElementById('ot-company').value;
  var sel = document.getElementById('ot-employee');
  var active = employees.filter(function(e){ return e.company===company && (e.status||'在职')==='在职' && !e.noBenefits; });
  sel.innerHTML = active.map(function(e){ return '<option value="'+e.id+'">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</option>'; }).join('');
  if(active.length===0){ sel.innerHTML = '<option value="">该公司暂无在职员工</option>'; }
}

function otCountForMonth(employeeId, month){
  return otRecords.filter(function(r){ return r.employeeId===employeeId && (r.date||'').slice(0,7)===month; }).length;
}

async function addOtRecord(){
  if(!isAdmin()) return;
  var employeeId = document.getElementById('ot-employee').value;
  var date = document.getElementById('ot-date').value;
  if(!employeeId){ document.getElementById('ot-msg').textContent = '请先新增员工资料'; return; }
  if(!date){ document.getElementById('ot-msg').textContent = '请选择日期'; return; }
  var data = {
    employeeId: employeeId,
    company: document.getElementById('ot-company').value,
    date: date,
    time: document.getElementById('ot-time').value.trim(),
    notes: document.getElementById('ot-notes').value.trim()
  };
  if(editingOtId){
    var { error } = await sb.from('attendance_ot').update(objToRow(ATT_FIELD_MAP, data)).eq('id', editingOtId);
    if(error){ document.getElementById('ot-msg').textContent = '保存失败:' + error.message; return; }
    var idx = otRecords.findIndex(function(r){ return r.id===editingOtId; });
    data.id = editingOtId;
    otRecords[idx] = data;
    document.getElementById('ot-msg').textContent = '已更新';
    stopOtEdit();
  } else {
    var { data: inserted, error: err2 } = await sb.from('attendance_ot').insert(objToRow(ATT_FIELD_MAP, data)).select().single();
    if(err2){ document.getElementById('ot-msg').textContent = '新增失败:' + err2.message; return; }
    otRecords.push(rowToObj(ATT_FIELD_MAP, inserted));
    ['ot-time','ot-notes'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('ot-msg').textContent = '已新增';
  }
  setTimeout(function(){ document.getElementById('ot-msg').textContent=''; }, 1500);
  renderOtList();
}

function startOtEdit(r){
  editingOtId = r.id;
  document.getElementById('ot-company').value = r.company;
  populateOtEmployeeSelect();
  document.getElementById('ot-employee').value = r.employeeId;
  document.getElementById('ot-date').value = r.date;
  document.getElementById('ot-time').value = r.time;
  document.getElementById('ot-notes').value = r.notes;
  document.getElementById('btn-ot-submit').textContent = '保存修改';
  document.getElementById('btn-ot-cancel').style.display = 'inline-block';
  window.scrollTo({top:0, behavior:'smooth'});
}
function stopOtEdit(){
  editingOtId = null;
  ['ot-time','ot-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('btn-ot-submit').textContent = '+ 新增OT记录';
  document.getElementById('btn-ot-cancel').style.display = 'none';
}

async function delOtRecord(id){
  if(!isAdmin()) return;
  var { error } = await sb.from('attendance_ot').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  otRecords = otRecords.filter(function(r){ return r.id!==id; });
  if(editingOtId===id) stopOtEdit();
  renderOtList();
}

function renderOtList(){
  var fc = document.getElementById('ot-filter-company').value;
  var fm = document.getElementById('ot-filter-month').value;
  var list = otRecords.filter(function(r){
    var okC = fc==='全部' || r.company===fc;
    var okM = !fm || (r.date||'').slice(0,7)===fm;
    return okC && okM;
  });
  var container = document.getElementById('ot-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无OT记录</div>'; return; }

  var byEmployee = {};
  var order = [];
  list.forEach(function(r){
    var emp = employees.find(function(e){ return e.id===r.employeeId; });
    var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
    if(!byEmployee[r.employeeId]){ byEmployee[r.employeeId] = { name:name, company:r.company, records:[] }; order.push(r.employeeId); }
    byEmployee[r.employeeId].records.push(r);
  });
  order.sort(function(a,b){ return byEmployee[a].name.localeCompare(byEmployee[b].name); });

  var html = '';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    g.records.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    html += '<div class="card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<p style="font-weight:600;font-size:14px;margin:0;">🕘 '+esc(g.name)+' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">'+esc(g.company)+'</span></p>'
      + '<p style="font-weight:700;font-size:14px;margin:0;color:var(--accent);">共 '+g.records.length+' 天</p>'
      + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">日期</th><th style="text-align:left;padding:4px 6px;">打卡时间</th><th style="text-align:left;padding:4px 6px;">备注</th><th style="padding:4px 6px;"></th></tr>';
    g.records.forEach(function(r){
      html += '<tr style="border-top:1px solid var(--border);" data-ot-id="'+r.id+'">'
        + '<td style="padding:6px;">'+esc(r.date)+'</td>'
        + '<td style="padding:6px;color:var(--accent);font-weight:500;">'+esc(r.time||'-')+'</td>'
        + '<td style="padding:6px;color:var(--text-secondary);">'+esc(r.notes||'-')+'</td>'
        + '<td style="padding:6px;white-space:nowrap;">'+(isAdmin() ? '<button type="button" class="secondary small ot-edit-btn">编辑</button> <button type="button" class="secondary small ot-del-btn">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.ot-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.closest('tr').getAttribute('data-ot-id');
      var r = otRecords.find(function(x){ return x.id===id; });
      if(r) startOtEdit(r);
    });
  });
  container.querySelectorAll('.ot-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      delOtRecord(btn.closest('tr').getAttribute('data-ot-id'));
    });
  });
}

// ---- 迟到记录 ----
function populateLateEmployeeSelect(){
  var company = document.getElementById('late-company').value;
  var sel = document.getElementById('late-employee');
  var active = employees.filter(function(e){ return e.company===company && (e.status||'在职')==='在职' && !e.noBenefits; });
  sel.innerHTML = active.map(function(e){ return '<option value="'+e.id+'">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</option>'; }).join('');
  if(active.length===0){ sel.innerHTML = '<option value="">该公司暂无在职员工</option>'; }
}

function lateCountForMonth(employeeId, month){
  return lateRecords.filter(function(r){ return r.employeeId===employeeId && (r.date||'').slice(0,7)===month; }).length;
}

async function addLateRecord(){
  if(!isAdmin()) return;
  var employeeId = document.getElementById('late-employee').value;
  var date = document.getElementById('late-date').value;
  if(!employeeId){ document.getElementById('late-msg').textContent = '请先新增员工资料'; return; }
  if(!date){ document.getElementById('late-msg').textContent = '请选择日期'; return; }
  var data = {
    employeeId: employeeId,
    company: document.getElementById('late-company').value,
    date: date,
    time: document.getElementById('late-time').value.trim(),
    notes: document.getElementById('late-notes').value.trim()
  };
  if(editingLateId){
    var { error } = await sb.from('attendance_late').update(objToRow(ATT_FIELD_MAP, data)).eq('id', editingLateId);
    if(error){ document.getElementById('late-msg').textContent = '保存失败:' + error.message; return; }
    var idx = lateRecords.findIndex(function(r){ return r.id===editingLateId; });
    data.id = editingLateId;
    lateRecords[idx] = data;
    document.getElementById('late-msg').textContent = '已更新';
    stopLateEdit();
  } else {
    var { data: inserted, error: err2 } = await sb.from('attendance_late').insert(objToRow(ATT_FIELD_MAP, data)).select().single();
    if(err2){ document.getElementById('late-msg').textContent = '新增失败:' + err2.message; return; }
    lateRecords.push(rowToObj(ATT_FIELD_MAP, inserted));
    ['late-time','late-notes'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('late-msg').textContent = '已新增';
  }
  setTimeout(function(){ document.getElementById('late-msg').textContent=''; }, 1500);
  renderLateList();
}

function startLateEdit(r){
  editingLateId = r.id;
  document.getElementById('late-company').value = r.company;
  populateLateEmployeeSelect();
  document.getElementById('late-employee').value = r.employeeId;
  document.getElementById('late-date').value = r.date;
  document.getElementById('late-time').value = r.time;
  document.getElementById('late-notes').value = r.notes;
  document.getElementById('btn-late-submit').textContent = '保存修改';
  document.getElementById('btn-late-cancel').style.display = 'inline-block';
  window.scrollTo({top:0, behavior:'smooth'});
}
function stopLateEdit(){
  editingLateId = null;
  ['late-time','late-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('btn-late-submit').textContent = '+ 新增迟到记录';
  document.getElementById('btn-late-cancel').style.display = 'none';
}

async function delLateRecord(id){
  if(!isAdmin()) return;
  var { error } = await sb.from('attendance_late').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  lateRecords = lateRecords.filter(function(r){ return r.id!==id; });
  if(editingLateId===id) stopLateEdit();
  renderLateList();
}

function renderLateList(){
  var fc = document.getElementById('late-filter-company').value;
  var fm = document.getElementById('late-filter-month').value;
  var list = lateRecords.filter(function(r){
    var okC = fc==='全部' || r.company===fc;
    var okM = !fm || (r.date||'').slice(0,7)===fm;
    return okC && okM;
  });
  var container = document.getElementById('late-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无迟到记录</div>'; return; }

  var byEmployee = {};
  var order = [];
  list.forEach(function(r){
    var emp = employees.find(function(e){ return e.id===r.employeeId; });
    var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
    if(!byEmployee[r.employeeId]){ byEmployee[r.employeeId] = { name:name, company:r.company, records:[] }; order.push(r.employeeId); }
    byEmployee[r.employeeId].records.push(r);
  });
  order.sort(function(a,b){ return byEmployee[a].name.localeCompare(byEmployee[b].name); });

  var html = '';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    g.records.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    html += '<div class="card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<p style="font-weight:600;font-size:14px;margin:0;">⏰ '+esc(g.name)+' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">'+esc(g.company)+'</span></p>'
      + '<p style="font-weight:700;font-size:14px;margin:0;color:var(--warning);">共 '+g.records.length+' 次</p>'
      + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">日期</th><th style="text-align:left;padding:4px 6px;">打卡时间</th><th style="text-align:left;padding:4px 6px;">备注</th><th style="padding:4px 6px;"></th></tr>';
    g.records.forEach(function(r){
      html += '<tr style="border-top:1px solid var(--border);" data-late-id="'+r.id+'">'
        + '<td style="padding:6px;">'+esc(r.date)+'</td>'
        + '<td style="padding:6px;color:var(--danger);font-weight:500;">'+esc(r.time||'-')+'</td>'
        + '<td style="padding:6px;color:var(--text-secondary);">'+esc(r.notes||'-')+'</td>'
        + '<td style="padding:6px;white-space:nowrap;">'+(isAdmin() ? '<button type="button" class="secondary small late-edit-btn">编辑</button> <button type="button" class="secondary small late-del-btn">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.late-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.closest('tr').getAttribute('data-late-id');
      var r = lateRecords.find(function(x){ return x.id===id; });
      if(r) startLateEdit(r);
    });
  });
  container.querySelectorAll('.late-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      delLateRecord(btn.closest('tr').getAttribute('data-late-id'));
    });
  });
}
