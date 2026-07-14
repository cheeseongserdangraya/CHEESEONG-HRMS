// 员工资料模块
var employees = [];
var expanded = {};
var editingId = null;

async function fetchEmployees(){
  var { data, error } = await sb.from('employees').select('*').order('created_at', { ascending: true });
  if(error){ alert('读取员工资料失败:' + error.message); return; }
  employees = data.map(function(row){ return rowToObj(EMP_FIELD_MAP, row); });
}

function toggleSalaryFields(){
  var isHourly = document.getElementById('f-emptype').value === '兼职';
  document.getElementById('salary-fields-monthly').style.display = isHourly ? 'none' : 'grid';
  document.getElementById('salary-fields-hourly').style.display = isHourly ? 'grid' : 'none';
}

function clearForm(){
  Object.keys(EMP_FIELD_MAP).forEach(function(k){
    if(k==='status') return;
    var el = document.getElementById(fmapId(k));
    if(el) el.value = (k==='gender'?'男': k==='nationality'?'本地': k==='company'?'FIRSTONE': k==='employeeType'?'正式员工': k==='hasPayslip'?'有Payslip': k==='paymentMethod'?'银行转账':'');
  });
  toggleSalaryFields();
}

// camelKey -> DOM id (照搬原本 HTML 的 id 命名)
var EMP_DOM_ID = {
  nric:'f-nric', icFile:'f-icfile', nameEn:'f-nameen', nameCn:'f-namecn',
  gender:'f-gender', nationality:'f-nat', email:'f-email', contact:'f-contact',
  address:'f-address', company:'f-company', department:'f-dept', position:'f-position',
  joinDate:'f-join', employeeType:'f-emptype', hasPayslip:'f-payslip', paymentMethod:'f-paymethod',
  basicSalary:'f-salary', allowance:'f-allowance', hourlyRate:'f-hourlyrate', annualLeave:'f-annualleave',
  emergencyName:'f-emname', emergencyNumber:'f-emnum', emergencyRel:'f-emrel',
  bankName:'f-bankname', accountHolder:'f-holder', bankAccountNumber:'f-bankacc',
  kwspNumber:'f-kwsp', pcbNumber:'f-pcb'
};
function fmapId(k){ return EMP_DOM_ID[k]; }

function startEdit(e){
  editingId = e.id;
  Object.keys(EMP_DOM_ID).forEach(function(k){
    var el = document.getElementById(fmapId(k));
    if(el) el.value = e[k]!==undefined && e[k]!==null ? e[k] : '';
  });
  document.getElementById('form-title').textContent = '编辑员工资料 - ' + (e.nameEn||e.nameCn);
  document.getElementById('btn-add').textContent = '保存修改';
  document.getElementById('btn-cancel-edit').style.display = 'inline-block';
  toggleSalaryFields();
  window.scrollTo({top:0, behavior:'smooth'});
}
function stopEdit(){
  editingId = null;
  clearForm();
  document.getElementById('form-title').textContent = '新增员工';
  document.getElementById('btn-add').textContent = '+ 新增员工';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

function groupLabel(e){
  if(e.employeeType==='兼职') return '兼职 Part-time (时薪)';
  if(e.nationality==='本地') return '本地员工 - ' + (e.hasPayslip==='无Payslip' ? '无 Payslip' : '有 Payslip');
  return e.nationality + '员工';
}

function renderEmpList(){
  var fc = document.getElementById('filter-company').value;
  var fs = document.getElementById('filter-status').value;
  var list = employees.filter(function(e){
    var okC = fc==='全部' || e.company===fc;
    var okS = fs==='全部' || (e.status||'在职')===fs;
    return okC && okS;
  });
  var container = document.getElementById('emp-list');
  if(list.length===0){
    container.innerHTML = '<div class="empty-state">暂无员工记录</div>';
    return;
  }
  var groups = {};
  var order = [];
  list.forEach(function(e){
    var g = groupLabel(e);
    if(!groups[g]){ groups[g] = []; order.push(g); }
    groups[g].push(e);
  });
  var html = '';
  order.forEach(function(g){
    html += '<p style="font-size:13px;font-weight:600;margin:0 0 8px;color:var(--text-secondary);">'+esc(g)+' <span style="font-weight:400;color:var(--text-muted);">('+groups[g].length+'人)</span></p>';
    html += '<div class="emp-list" style="margin-bottom:18px;">';
    groups[g].forEach(function(e){
      var isOpen = !!expanded[e.id];
      html += '<div class="emp-row">';
      html += '<div class="emp-row-head" onclick="toggleRow(\''+e.id+'\')">'
        + '<div class="avatar">'+esc(e.nameEn||e.nameCn||'?').slice(0,1).toUpperCase()+'</div>'
        + '<div style="flex:1;min-width:0;">'
        + '<p class="emp-name">'+esc(e.nameEn)+' <span class="cn">'+esc(e.nameCn)+'</span></p>'
        + '<p class="emp-meta">'+esc(e.department)+' · '+esc(e.position)+' · '+(e.paymentMethod==='现金'?'<span style="color:var(--accent);font-weight:600;">现金</span>':'银行转账')+' · '+(e.employeeType==='兼职'? '时薪 '+fmt(e.hourlyRate) : '底薪 '+fmt(e.basicSalary)+' · 津贴 '+fmt(e.allowance))+'</p>'
        + '</div>'
        + '<span class="badge '+(e.status==='离职'?'inactive':'active')+'">'+(e.status||'在职')+'</span>'
        + '<span class="chevron">'+(isOpen?'▼':'▶')+'</span>'
        + '</div>';
      if(isOpen){
        html += '<div class="emp-detail"><table>'
          + row('公司', e.company)
          + row('NRIC/Passport', e.nric)
          + row('IC/护照扫描件', e.icFile ? '<a href="'+esc(e.icFile)+'" target="_blank">查看链接</a>' : '-', true)
          + row('Email', e.email) + row('联络电话', e.contact) + row('地址', e.address)
          + row('性别', e.gender) + row('国籍', e.nationality) + row('入职日期', e.joinDate)
          + row('员工类型', e.employeeType) + row('是否有Payslip', e.nationality==='本地'&&e.employeeType!=='兼职' ? e.hasPayslip : '-')
          + row('支付方式', e.paymentMethod||'银行转账')
          + row('底薪', e.employeeType==='兼职'?'-':fmt(e.basicSalary))
          + row('固定津贴', e.employeeType==='兼职'?'-':fmt(e.allowance))
          + row('年假天数(按年资自动算)', e.employeeType==='兼职'?'-':annualLeaveEntitlement(e)+' 天' + (e.annualLeave>0?' (手动设定)':' (2年以下8天/2-5年12天/5年以上16天)'))
          + row('时薪', e.employeeType==='兼职' ? fmt(e.hourlyRate) : '-')
          + row('紧急联络人', (e.emergencyName||'-') + (e.emergencyRel? ' ('+e.emergencyRel+')':''))
          + row('紧急联络电话', e.emergencyNumber)
          + row('银行名称', e.bankName) + row('户口持有人', e.accountHolder) + row('银行户口号码', e.bankAccountNumber)
          + row('KWSP 号码', e.kwspNumber) + row('PCB 号码', e.pcbNumber)
          + '</table>';
        if(isAdmin()){
          html += '<div class="detail-actions">'
          + '<button class="secondary small" onclick="event.stopPropagation();editEmp(\''+e.id+'\')">编辑</button>'
          + '<button class="secondary small" onclick="event.stopPropagation();toggleStatus(\''+e.id+'\')">切换在职/离职</button>'
          + '<button class="secondary small" onclick="event.stopPropagation();delEmp(\''+e.id+'\')">删除</button>'
          + '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  container.innerHTML = html;

  function row(label, val, isHtml){
    return '<tr><td>'+label+'</td><td>'+(isHtml? (val||'-') : esc(val||'-'))+'</td></tr>';
  }
}

function toggleRow(id){ expanded[id] = !expanded[id]; renderEmpList(); }

async function delEmp(id){
  if(!isAdmin()) return;
  if(!confirm('确定删除这个员工资料吗?')) return;
  var { error } = await sb.from('employees').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  employees = employees.filter(function(e){ return e.id!==id; });
  renderEmpList();
}

async function toggleStatus(id){
  if(!isAdmin()) return;
  var e = employees.find(function(x){ return x.id===id; });
  if(!e) return;
  var newStatus = e.status==='离职' ? '在职' : '离职';
  var { error } = await sb.from('employees').update({ status: newStatus }).eq('id', id);
  if(error){ alert('更新失败:' + error.message); return; }
  e.status = newStatus;
  renderEmpList();
}

function editEmp(id){
  var e = employees.find(function(x){ return x.id===id; });
  if(e) startEdit(e);
}

async function submitForm(){
  if(!isAdmin()) return;
  var nameEn = document.getElementById('f-nameen').value.trim();
  if(!nameEn){ document.getElementById('emp-msg').textContent = '请输入 English name'; return; }
  var data = {};
  Object.keys(EMP_DOM_ID).forEach(function(k){
    var el = document.getElementById(fmapId(k));
    var v = el.value;
    data[k] = (k==='basicSalary'||k==='allowance'||k==='hourlyRate'||k==='annualLeave') ? (Number(v)||0) : (v.trim ? v.trim() : v);
  });

  if(editingId){
    var row = objToRow(EMP_FIELD_MAP, data);
    var { error } = await sb.from('employees').update(row).eq('id', editingId);
    if(error){ document.getElementById('emp-msg').textContent = '保存失败:' + error.message; return; }
    var idx = employees.findIndex(function(e){ return e.id===editingId; });
    data.id = editingId;
    data.status = employees[idx].status;
    employees[idx] = data;
    document.getElementById('emp-msg').textContent = '已更新';
    stopEdit();
  } else {
    data.status = '在职';
    var row2 = objToRow(EMP_FIELD_MAP, data);
    var { data: inserted, error: err2 } = await sb.from('employees').insert(row2).select().single();
    if(err2){ document.getElementById('emp-msg').textContent = '新增失败:' + err2.message; return; }
    employees.push(rowToObj(EMP_FIELD_MAP, inserted));
    clearForm();
    document.getElementById('emp-msg').textContent = '已新增';
  }
  setTimeout(function(){ document.getElementById('emp-msg').textContent=''; }, 1500);
  renderEmpList();
}
