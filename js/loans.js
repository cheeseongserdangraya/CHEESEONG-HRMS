// 借支/还款记录模块
var loanRecords = [];
var editingLoanId = null;

async function fetchLoanRecords(){
  var { data, error } = await sb.from('loan_records').select('*').order('date', { ascending: false });
  if(error){ alert('读取借支记录失败:' + error.message); return; }
  loanRecords = data.map(function(row){ return rowToObj(LOAN_FIELD_MAP, row); });
}

function populateLoanEmployeeSelect(){
  var company = document.getElementById('loan-company').value;
  var sel = document.getElementById('loan-employee');
  var active = employees.filter(function(e){ return e.company===company && (e.status||'在职')==='在职' && !e.noBenefits; });
  sel.innerHTML = active.map(function(e){ return '<option value="'+e.id+'">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</option>'; }).join('');
  if(active.length===0){ sel.innerHTML = '<option value="">该公司暂无在职员工</option>'; }
  updateLoanBalancePreview();
}

function loanBalance(employeeId, excludeId){
  return round2(loanRecords.filter(function(r){ return r.employeeId===employeeId && r.id!==excludeId; })
    .reduce(function(s,r){ return s + (r.type==='borrow' ? r.amount : -r.amount); }, 0));
}

function loanRepayForMonth(employeeId, month){
  return round2(loanRecords.filter(function(r){ return r.employeeId===employeeId && r.type==='repay' && (r.date||'').slice(0,7)===month; })
    .reduce(function(s,r){ return s + r.amount; }, 0));
}

function updateLoanBalancePreview(){
  var employeeId = document.getElementById('loan-employee').value;
  var el = document.getElementById('loan-preview');
  if(!employeeId){ el.innerHTML = '<span style="color:var(--text-muted);">请先选择员工</span>'; return; }
  var balance = loanBalance(employeeId, editingLoanId);
  el.innerHTML = '该员工目前欠款余额:<b style="color:'+(balance>0?'var(--danger)':'var(--success)')+';">'+fmt(balance)+'</b>';
}

async function addLoanRecord(){
  if(!isAdmin()) return;
  var employeeId = document.getElementById('loan-employee').value;
  var type = document.getElementById('loan-type').value;
  var amount = Number(document.getElementById('loan-amount').value)||0;
  var date = document.getElementById('loan-date').value;
  if(!employeeId){ document.getElementById('loan-msg').textContent = '请先新增员工资料'; return; }
  if(!date){ document.getElementById('loan-msg').textContent = '请选择日期'; return; }
  if(amount<=0){ document.getElementById('loan-msg').textContent = '请输入金额'; return; }
  var data = {
    employeeId: employeeId,
    company: document.getElementById('loan-company').value,
    type: type,
    date: date,
    amount: amount,
    notes: document.getElementById('loan-notes').value.trim()
  };
  if(editingLoanId){
    var { error } = await sb.from('loan_records').update(objToRow(LOAN_FIELD_MAP, data)).eq('id', editingLoanId);
    if(error){ document.getElementById('loan-msg').textContent = '保存失败:' + error.message; return; }
    var idx = loanRecords.findIndex(function(r){ return r.id===editingLoanId; });
    data.id = editingLoanId;
    loanRecords[idx] = data;
    document.getElementById('loan-msg').textContent = '已更新';
    stopLoanEdit();
  } else {
    var { data: inserted, error: err2 } = await sb.from('loan_records').insert(objToRow(LOAN_FIELD_MAP, data)).select().single();
    if(err2){ document.getElementById('loan-msg').textContent = '新增失败:' + err2.message; return; }
    loanRecords.push(rowToObj(LOAN_FIELD_MAP, inserted));
    document.getElementById('loan-msg').textContent = '已新增';
  }
  ['loan-amount','loan-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  setTimeout(function(){ document.getElementById('loan-msg').textContent=''; }, 1500);
  updateLoanBalancePreview();
  renderLoanList();
}

function startLoanEdit(r){
  editingLoanId = r.id;
  document.getElementById('loan-company').value = r.company;
  populateLoanEmployeeSelect();
  document.getElementById('loan-employee').value = r.employeeId;
  document.getElementById('loan-type').value = r.type;
  document.getElementById('loan-date').value = r.date;
  document.getElementById('loan-amount').value = r.amount;
  document.getElementById('loan-notes').value = r.notes||'';
  document.querySelector('#panel-loan .card p.section-label').textContent = '编辑 借支/还款记录';
  document.getElementById('btn-loan-submit').textContent = '保存修改';
  document.getElementById('btn-loan-cancel').style.display = 'inline-block';
  updateLoanBalancePreview();
  window.scrollTo({top:0, behavior:'smooth'});
}
function stopLoanEdit(){
  editingLoanId = null;
  document.querySelector('#panel-loan .card p.section-label').textContent = '新增 借支 / 还款记录';
  document.getElementById('btn-loan-submit').textContent = '+ 新增记录';
  document.getElementById('btn-loan-cancel').style.display = 'none';
  document.getElementById('loan-amount').value = '';
  document.getElementById('loan-notes').value = '';
}

async function delLoanRecord(id){
  if(!isAdmin()) return;
  if(!confirm('确定删除这笔记录吗?')) return;
  var { error } = await sb.from('loan_records').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  loanRecords = loanRecords.filter(function(r){ return r.id!==id; });
  if(editingLoanId===id) stopLoanEdit();
  renderLoanList();
}

function renderLoanList(){
  var fc = document.getElementById('loan-filter-company').value;
  var fs = document.getElementById('loan-filter-status').value;
  var fm = document.getElementById('loan-filter-month').value;
  var byEmployee = {};
  var order = [];
  loanRecords.forEach(function(r){
    if(fc!=='全部' && r.company!==fc) return;
    if(fm && (r.date||'').slice(0,7)!==fm) return;
    var emp = employees.find(function(e){ return e.id===r.employeeId; });
    var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
    if(!byEmployee[r.employeeId]){ byEmployee[r.employeeId] = { name:name, company:r.company, records:[] }; order.push(r.employeeId); }
    byEmployee[r.employeeId].records.push(r);
  });
  order = order.filter(function(empId){
    var balance = loanBalance(empId); // 尚欠/已还清是看全时段余额,不受月份筛选影响
    if(fs==='欠款') return balance>0;
    if(fs==='已还清') return balance<=0;
    return true;
  });
  order.sort(function(a,b){ return byEmployee[a].name.localeCompare(byEmployee[b].name); });

  renderLoanSummary(order, byEmployee);

  var container = document.getElementById('loan-list');
  if(order.length===0){ container.innerHTML = '<div class="empty-state">暂无借支记录</div>'; return; }

  var html = '<details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-secondary);padding:8px 0;">📋 查看明细(点开才看得到)</summary>';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    var balance = loanBalance(empId);
    g.records.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    html += '<div class="card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">'
      + '<p style="font-weight:600;font-size:14px;margin:0;">'+esc(g.name)+' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">'+esc(g.company)+'</span></p>'
      + '<p style="font-weight:700;font-size:15px;margin:0;color:'+(balance>0?'var(--danger)':'var(--success)')+';">'+(balance>0?'尚欠 '+fmt(balance):'已还清')+'</p>'
      + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">日期</th><th style="text-align:left;padding:4px 6px;">类型</th><th style="text-align:right;padding:4px 6px;">金额</th><th style="text-align:left;padding:4px 6px;">备注</th><th style="padding:4px 6px;"></th></tr>';
    g.records.forEach(function(r){
      html += '<tr style="border-top:1px solid var(--border);" data-loan-id="'+r.id+'">'
        + '<td style="padding:6px;">'+esc(r.date)+'</td>'
        + '<td style="padding:6px;color:'+(r.type==='borrow'?'var(--danger)':'var(--success)')+';">'+(r.type==='borrow'?'借出':'还款')+'</td>'
        + '<td style="padding:6px;text-align:right;font-weight:500;">'+(r.type==='borrow'?'+':'-')+fmt(r.amount)+'</td>'
        + '<td style="padding:6px;color:var(--text-secondary);">'+esc(r.notes||'-')+'</td>'
        + '<td style="padding:6px;white-space:nowrap;">'+(isAdmin() ? '<button type="button" class="secondary small loan-edit-btn">编辑</button> <button type="button" class="secondary small loan-del-btn">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  html += '</details>';
  container.innerHTML = html;

  container.querySelectorAll('.loan-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.closest('tr').getAttribute('data-loan-id');
      var r = loanRecords.find(function(x){ return x.id===id; });
      if(r) startLoanEdit(r);
    });
  });
  container.querySelectorAll('.loan-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.closest('tr').getAttribute('data-loan-id');
      delLoanRecord(id);
    });
  });
}

function renderLoanSummary(order, byEmployee){
  var container = document.getElementById('loan-summary');
  if(order.length===0){ container.innerHTML = ''; return; }

  var html = '<p class="section-label" style="font-size:14px;color:var(--text);font-weight:600;">📊 汇总(依目前筛选的公司/员工/月份加总)</p>';
  html += '<table class="pay-table"><tr><th>公司</th><th>姓名</th><th>借出合计</th><th>还款合计</th></tr>';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    var borrowTotal = round2(g.records.filter(function(r){ return r.type==='borrow'; }).reduce(function(s,r){ return s+r.amount; }, 0));
    var repayTotal = round2(g.records.filter(function(r){ return r.type==='repay'; }).reduce(function(s,r){ return s+r.amount; }, 0));
    html += '<tr>'
      + '<td>'+esc(g.company)+'</td>'
      + '<td style="font-weight:500;white-space:nowrap;">'+esc(g.name)+'</td>'
      + '<td style="color:var(--danger);font-weight:500;">'+fmt(borrowTotal)+'</td>'
      + '<td style="color:var(--success);font-weight:500;">'+fmt(repayTotal)+'</td>'
      + '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;
}
