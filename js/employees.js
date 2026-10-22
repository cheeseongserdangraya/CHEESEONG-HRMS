// 员工资料模块
var employees = [];
var expanded = {};
var editingId = null;

async function fetchEmployees(){
  var { data, error } = await sb.from('employees').select('*').order('created_at', { ascending: true });
  if(error){ alert('读取员工资料失败:' + error.message); return; }
  employees = data.map(function(row){ return rowToObj(EMP_FIELD_MAP, row); });
}

// ---- 员工资料变更记录(生效日) ----
// 薪水相关/公司/职位这些栏位,改的时候会问「几号开始生效」,记在 employee_changes 表。
// 薪水计算按月份去查「那个月该用的值」(empAtMonth),生效日所在的月整个月用新的,之前的月份完全不动。
// 每个栏位第一次有变更时,会同时存一笔 1900-01-01 的「起始值」(改之前的旧值),所以任何月份都查得到值。
var TRACKED_FIELDS = {
  employeeType:'员工类型', basicSalary:'底薪', allowance:'津贴', hourlyRate:'时薪',
  company:'公司', costBranch:'实际成本归属', department:'部门', position:'职位'
};
var TRACKED_NUMERIC = { basicSalary:true, allowance:true, hourlyRate:true };
var CHANGE_BASELINE_DATE = '1900-01-01';
var employeeChanges = [];       // employee_changes 全部记录
var changesByEmp = {};          // employeeId -> field -> [{id,date,value}](按日期从早到晚)
var employeeChangesReady = false; // 变更记录表读取成功才算准备好(还没建表的话,不让改薪水,免得没留历史)

function encChangeValue(v){ return (v===null || v===undefined) ? '' : String(v); }
function decChangeValue(field, v){ return TRACKED_NUMERIC[field] ? (Number(v)||0) : (v||''); }

function buildChangeIndex(){
  changesByEmp = {};
  employeeChanges.forEach(function(c){
    var byField = changesByEmp[c.employeeId] || (changesByEmp[c.employeeId] = {});
    (byField[c.field] || (byField[c.field] = [])).push({ id:c.id, date:c.effectiveDate, value:decChangeValue(c.field, c.value) });
  });
  Object.keys(changesByEmp).forEach(function(id){
    Object.keys(changesByEmp[id]).forEach(function(f){
      changesByEmp[id][f].sort(function(a,b){ return a.date.localeCompare(b.date); });
    });
  });
}

async function fetchEmployeeChanges(){
  var { data, error } = await sb.from('employee_changes').select('*');
  if(error){
    console.warn('读取员工变更记录失败(可能还没建 employee_changes 表):' + error.message);
    employeeChangesReady = false;
    return;
  }
  employeeChanges = data.map(function(row){ return rowToObj(CHANGE_FIELD_MAP, row); });
  buildChangeIndex();
  employeeChangesReady = true;
}

// 某个员工的某个栏位,在 month('YYYY-MM')那个月该用什么值
function trackedValueAt(e, field, month){
  var rows = changesByEmp[e.id] && changesByEmp[e.id][field];
  if(!rows || rows.length===0) return e[field];
  var pick = null;
  rows.forEach(function(r){ if(r.date.slice(0,7) <= month) pick = r; });
  return pick ? pick.value : rows[0].value;
}

// 回传「这个月的这个员工」:有变更记录的栏位换成那个月该用的值,其他照旧
function empAtMonth(e, month){
  var byField = changesByEmp[e.id];
  if(!byField) return e;
  var copy = Object.assign({}, e);
  Object.keys(byField).forEach(function(f){ copy[f] = trackedValueAt(e, f, month); });
  return copy;
}

function normTracked(field, v){ return TRACKED_NUMERIC[field] ? (Number(v)||0) : (v||''); }
function showChangeVal(field, v){
  if(field==='costBranch') return v==='split' ? '平分' : (v || '跟登记公司一样');
  if(TRACKED_NUMERIC[field]) return fmt(v);
  return v || '(空)';
}

// 改了哪些要记生效日的栏位
function detectTrackedChanges(oldEmp, data){
  var out = [];
  Object.keys(TRACKED_FIELDS).forEach(function(f){
    var a = normTracked(f, oldEmp[f]), b = normTracked(f, data[f]);
    if(a !== b) out.push({ field:f, oldValue:a, newValue:b });
  });
  return out;
}

// 把变更写进 employee_changes,并回传「各栏位现在(最晚生效日)的值」,让员工资料那行存最新的
async function recordEmployeeChanges(empId, changed, effectiveDate){
  var upserts = [];
  changed.forEach(function(c){
    var existing = (changesByEmp[empId] && changesByEmp[empId][c.field]) || [];
    if(existing.length===0){
      upserts.push({ employeeId:empId, field:c.field, effectiveDate:CHANGE_BASELINE_DATE, value:encChangeValue(c.oldValue) });
    }
    upserts.push({ employeeId:empId, field:c.field, effectiveDate:effectiveDate, value:encChangeValue(c.newValue) });
  });
  var rows = upserts.map(function(r){ return objToRow(CHANGE_FIELD_MAP, r); });
  var { data, error } = await sb.from('employee_changes').upsert(rows, { onConflict:'employee_id,field,effective_date' }).select();
  if(error) return { error: error };
  data.forEach(function(row){
    var o = rowToObj(CHANGE_FIELD_MAP, row);
    employeeChanges = employeeChanges.filter(function(c){ return !(c.employeeId===o.employeeId && c.field===o.field && c.effectiveDate===o.effectiveDate); });
    employeeChanges.push(o);
  });
  buildChangeIndex();
  var latest = {};
  changed.forEach(function(c){
    var list = changesByEmp[empId][c.field];
    latest[c.field] = list[list.length-1].value;
  });
  return { latest: latest };
}

function changeHistoryHtml(e){
  var byField = changesByEmp[e.id];
  if(!byField) return '';
  var items = [];
  Object.keys(byField).forEach(function(f){
    var rows = byField[f];
    for(var i=1; i<rows.length; i++){ items.push({ field:f, row:rows[i], prev:rows[i-1].value }); }
  });
  if(items.length===0) return '';
  items.sort(function(a,b){ return b.row.date.localeCompare(a.row.date); });
  var html = '<p style="font-size:12px;font-weight:600;color:var(--text-secondary);margin:12px 0 4px;">变更记录(从生效日所在的月份起套用新的,之前的月份不变)</p>'
    + '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  items.forEach(function(it){
    html += '<tr style="border-top:1px solid var(--border);">'
      + '<td style="padding:4px 6px 4px 0;white-space:nowrap;">'+esc(it.row.date)+' 起</td>'
      + '<td style="padding:4px 6px;">'+esc(TRACKED_FIELDS[it.field])+'</td>'
      + '<td style="padding:4px 6px;color:var(--text-secondary);">'+esc(showChangeVal(it.field, it.prev))+' → <b style="color:var(--text);">'+esc(showChangeVal(it.field, it.row.value))+'</b></td>'
      + '<td style="padding:4px 0;text-align:right;">'+(isAdmin() ? '<button class="secondary small" onclick="event.stopPropagation();delEmpChange(\''+e.id+'\',\''+it.row.id+'\',\''+it.field+'\')">删除</button>' : '')+'</td>'
      + '</tr>';
  });
  return html + '</table>';
}

async function delEmpChange(empId, changeId, field){
  if(!isAdmin()) return;
  if(!confirm('确定删除这条变更记录吗?\n删除后,从那个生效日起的月份会改回用前一个数值。已经保存过的月份(底薪等已锁在那个月的)不会自动改。')) return;
  var { error } = await sb.from('employee_changes').delete().eq('id', changeId);
  if(error){ alert('删除失败:' + error.message); return; }
  employeeChanges = employeeChanges.filter(function(c){ return c.id!==changeId; });
  buildChangeIndex();
  // 员工资料那行存的是「最晚生效日」的值,删完要跟着更新
  var list = changesByEmp[empId] && changesByEmp[empId][field];
  var e = employees.find(function(x){ return x.id===empId; });
  if(list && list.length && e){
    var latestVal = list[list.length-1].value;
    var patch = {}; patch[field] = latestVal;
    var { error: err2 } = await sb.from('employees').update(objToRow(EMP_FIELD_MAP, patch)).eq('id', empId);
    if(err2){ alert('变更记录已删除,但更新员工资料失败:' + err2.message); }
    else { e[field] = latestVal; }
  }
  renderEmpList();
}

// 页面里自己的小窗口问「几号开始生效」(比浏览器自带的 prompt 可靠,也能直接点日历选日期)
// 回传日期字符串 YYYY-MM-DD,按取消回传 null
function askEffectiveDate(summary, defaultDate){
  return new Promise(function(resolve){
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
    overlay.innerHTML = '<div style="background:var(--surface,#fff);color:var(--text,#222);border-radius:12px;padding:20px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3);">'
      + '<p style="font-weight:700;font-size:15px;margin:0 0 8px;">从几号开始生效?</p>'
      + '<p style="font-size:12px;color:var(--text-secondary,#666);margin:0 0 4px;">这次改了:</p>'
      + '<div style="font-size:13px;margin:0 0 12px;white-space:pre-line;">'+esc(summary)+'</div>'
      + '<input type="date" id="eff-date" value="'+esc(defaultDate)+'" style="width:100%;margin-bottom:8px;" />'
      + '<p style="font-size:12px;color:var(--text-secondary,#666);margin:0 0 14px;">生效日所在的那个月,整个月都会用新的;之前的月份不会变。</p>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button type="button" class="secondary" id="eff-cancel">取消(不保存)</button>'
      + '<button type="button" id="eff-ok">确定并保存</button></div></div>';
    document.body.appendChild(overlay);
    function close(v){ document.body.removeChild(overlay); resolve(v); }
    overlay.querySelector('#eff-cancel').onclick = function(){ close(null); };
    overlay.querySelector('#eff-ok').onclick = function(){ close(overlay.querySelector('#eff-date').value || ''); };
  });
}

// 补记变更日期:员工资料已经是新的值了(例如在有「生效日」功能之前就改了),
// 这里补上「从哪天起变成现在这样、之前是什么」,之前的月份就会照旧值算。
function backfillControlHtml(field, cur){
  var sel = function(opts){ return '<select data-bf="'+field+'" style="width:100%;">'+opts.map(function(o){ return '<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>'; }).join('')+'</select>'; };
  if(field==='employeeType') return sel([['','(没变)'],['兼职','兼职(时薪)'],['正式员工','正式员工(月薪)']]);
  if(field==='company') return sel([['','(没变)'],['FIRSTONE','FIRSTONE'],['CS FIRSTONE','CS FIRSTONE'],['TONGPOPO','TONGPOPO']]);
  if(field==='costBranch') return sel([['','(没变)'],['__same','跟登记公司一样'],['FIRSTONE','算在 FIRSTONE'],['CS FIRSTONE','算在 CS FIRSTONE'],['split','FIRSTONE/CS FIRSTONE 平分']]);
  if(TRACKED_NUMERIC[field]) return '<input type="number" data-bf="'+field+'" placeholder="(没变就留空)" style="width:100%;" />';
  return '<input type="text" data-bf="'+field+'" placeholder="(没变就留空)" style="width:100%;" />';
}

function askBackfill(e){
  return new Promise(function(resolve){
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;';
    var rows = Object.keys(TRACKED_FIELDS).map(function(f){
      return '<tr><td style="padding:4px 8px 4px 0;white-space:nowrap;">'+esc(TRACKED_FIELDS[f])+'</td>'
        + '<td style="padding:4px 8px;color:var(--text-secondary,#666);">'+esc(showChangeVal(f, e[f]))+'</td>'
        + '<td style="padding:4px 0;">'+backfillControlHtml(f, e[f])+'</td></tr>';
    }).join('');
    overlay.innerHTML = '<div style="background:var(--surface,#fff);color:var(--text,#222);border-radius:12px;padding:20px;max-width:520px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.3);">'
      + '<p style="font-weight:700;font-size:15px;margin:0 0 6px;">补记变更日期 - '+esc(e.nameEn||e.nameCn)+'</p>'
      + '<p style="font-size:12px;color:var(--text-secondary,#666);margin:0 0 10px;">下面「现在」是员工资料里目前的值。哪一项是从某一天才变成现在这样的,就在右边填「改之前的旧值」,没变的留着不填。</p>'
      + '<table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:10px;"><tr style="color:var(--text-secondary,#666);font-size:12px;"><td>项目</td><td>现在</td><td>改之前的旧值</td></tr>'+rows+'</table>'
      + '<label style="font-size:12px;">从哪一天起变成现在这样(这个日期所在的月份起用现在的值)</label>'
      + '<input type="date" id="bf-date" value="'+esc(todayStr().slice(0,8)+'01')+'" style="width:100%;margin:4px 0 14px;" />'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button type="button" class="secondary" id="bf-cancel">取消</button>'
      + '<button type="button" id="bf-ok">确定补记</button></div></div>';
    document.body.appendChild(overlay);
    function close(v){ document.body.removeChild(overlay); resolve(v); }
    overlay.querySelector('#bf-cancel').onclick = function(){ close(null); };
    overlay.querySelector('#bf-ok').onclick = function(){
      var olds = {};
      overlay.querySelectorAll('[data-bf]').forEach(function(el){ if(el.value!=='') olds[el.getAttribute('data-bf')] = el.value; });
      close({ date: overlay.querySelector('#bf-date').value || '', olds: olds });
    };
  });
}

async function backfillEmpChange(empId){
  if(!isAdmin()) return;
  var e = employees.find(function(x){ return x.id===empId; });
  if(!e) return;
  if(!employeeChangesReady){ alert('员工变更记录表还没建好,请先去 Supabase 执行建表 SQL。'); return; }
  var res = await askBackfill(e);
  if(res===null) return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(res.date) || isNaN(new Date(res.date).getTime())){ alert('没有选日期,没有补记。'); return; }
  var changed = [];
  Object.keys(res.olds).forEach(function(f){
    var oldVal = res.olds[f];
    if(f==='costBranch' && oldVal==='__same') oldVal = '';
    var a = normTracked(f, oldVal), b = normTracked(f, e[f]);
    if(a !== b) changed.push({ field:f, oldValue:a, newValue:b });
  });
  if(changed.length===0){ alert('没有填任何跟「现在」不一样的旧值,没有补记。'); return; }
  var rec = await recordEmployeeChanges(empId, changed, res.date);
  if(rec.error){ alert('补记失败:' + rec.error.message); return; }
  // 员工资料那行存「最晚生效日」的值,万一补记的日期不是最晚的,要同步
  var patch = {}, needPatch = false;
  Object.keys(rec.latest).forEach(function(f){
    if(normTracked(f, rec.latest[f]) !== normTracked(f, e[f])){ patch[f] = rec.latest[f]; needPatch = true; }
  });
  if(needPatch){
    var { error: err2 } = await sb.from('employees').update(objToRow(EMP_FIELD_MAP, patch)).eq('id', empId);
    if(err2){ alert('补记已存,但更新员工资料失败:' + err2.message); }
    else { Object.assign(e, patch); }
  }
  renderEmpList();
}

function toggleSalaryFields(){
  var isHourly = document.getElementById('f-emptype').value === '兼职';
  document.getElementById('salary-fields-monthly').style.display = isHourly ? 'none' : 'grid';
  document.getElementById('salary-fields-hourly').style.display = isHourly ? 'grid' : 'none';
}

function clearForm(){
  Object.keys(EMP_DOM_ID).forEach(function(k){
    var el = document.getElementById(fmapId(k));
    if(el) el.value = (k==='gender'?'男': k==='nationality'?'本地': k==='company'?'FIRSTONE': k==='employeeType'?'正式员工': k==='hasPayslip'?'有Payslip': k==='paymentMethod'?'银行转账':'');
  });
  document.getElementById('f-nobenefits').checked = false;
  toggleSalaryFields();
}

// camelKey -> DOM id (照搬原本 HTML 的 id 命名)
var EMP_DOM_ID = {
  nric:'f-nric', icFile:'f-icfile', nameEn:'f-nameen', nameCn:'f-namecn',
  gender:'f-gender', nationality:'f-nat', email:'f-email', contact:'f-contact',
  address:'f-address', company:'f-company', costBranch:'f-costbranch', department:'f-dept', position:'f-position',
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
  document.getElementById('f-nobenefits').checked = !!e.noBenefits;
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

  // 组的显示顺序固定:本地-有Payslip → 本地-无Payslip → 尼泊尔 → 兼职 → 缅甸
  var GROUP_ORDER = ['本地员工 - 有 Payslip', '本地员工 - 无 Payslip', '尼泊尔员工', '兼职 Part-time (时薪)', '缅甸员工'];
  function groupRank(g){
    var idx = GROUP_ORDER.indexOf(g);
    if(idx>-1) return idx;
    return GROUP_ORDER.length; // 没列到的国籍(例如"其他"),排在最后
  }
  order.sort(function(a,b){ return groupRank(a)-groupRank(b); });

  // 组内排序:选"全部公司"时先照 FIRSTONE → CS FIRSTONE → TONGPOPO 分,再照名字A-Z;选单一公司时直接照名字A-Z
  var COMPANY_ORDER = {'FIRSTONE':0, 'CS FIRSTONE':1, 'TONGPOPO':2};
  order.forEach(function(g){
    groups[g].sort(function(a,b){
      if(fc==='全部'){
        var ca = COMPANY_ORDER[a.company]!==undefined ? COMPANY_ORDER[a.company] : 99;
        var cb = COMPANY_ORDER[b.company]!==undefined ? COMPANY_ORDER[b.company] : 99;
        if(ca!==cb) return ca-cb;
      }
      return (a.nameEn||'').localeCompare(b.nameEn||'');
    });
  });

  function empCardHtml(e, numLabel){
    var isOpen = !!expanded[e.id];
    var html = '<div class="emp-row">';
    html += '<div class="emp-row-head" onclick="toggleRow(\''+e.id+'\')">'
      + '<div class="avatar">'+(numLabel!==undefined ? numLabel : esc(e.nameEn||e.nameCn||'?').slice(0,1).toUpperCase())+'</div>'
      + '<div style="flex:1;min-width:0;">'
      + '<p class="emp-name">'+esc(e.nameEn)+' <span class="cn">'+esc(e.nameCn)+'</span>'+(e.noBenefits?' <span class="badge role-boss" style="font-size:10px;">人头/无福利</span>':'')+(e.costBranch?' <span class="badge role-boss" style="font-size:10px;">成本:'+(e.costBranch==='split'?'平分':e.costBranch)+'</span>':'')+'</p>'
      + '<p class="emp-meta"><b style="color:var(--text-secondary);">'+esc(e.company)+'</b> · '+esc(e.department)+' · '+esc(e.position)+' · '+(e.paymentMethod==='现金'?'<span style="color:var(--accent);font-weight:600;">现金</span>':'银行转账')+' · '+(e.employeeType==='兼职'? '时薪 '+fmt(e.hourlyRate) : '底薪 '+fmt(e.basicSalary)+' · 津贴 '+fmt(e.allowance))+'</p>'
      + '</div>'
      + '<span class="badge '+(e.status==='离职'?'inactive':'active')+'">'+(e.status||'在职')+'</span>'
      + '<span class="chevron">'+(isOpen?'▼':'▶')+'</span>'
      + '</div>';
    if(isOpen){
      html += '<div class="emp-detail"><table>'
        + row('公司', e.company)
        + (e.costBranch ? row('实际成本归属', e.costBranch==='split' ? 'FIRSTONE/CS FIRSTONE 平分' : '算在 '+e.costBranch) : '')
        + row('NRIC/Passport', e.nric)
        + row('IC/护照扫描件', e.icFile ? '<a href="'+esc(e.icFile)+'" target="_blank">查看链接</a>' : '-', true)
        + row('Email', e.email) + row('联络电话', e.contact) + row('地址', e.address)
        + row('性别', e.gender) + row('国籍', e.nationality) + row('入职日期', e.joinDate)
        + (e.status==='离职' ? row('离职日期', e.resignDate||'(未填,薪水计算会抓不到他离职前的月份)') : '')
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
        + '</table>'
        + changeHistoryHtml(e);
      if(isAdmin()){
        html += '<div class="detail-actions">'
        + '<button class="secondary small" onclick="event.stopPropagation();editEmp(\''+e.id+'\')">编辑</button>'
        + '<button class="secondary small" onclick="event.stopPropagation();backfillEmpChange(\''+e.id+'\')">补记变更日期</button>'
        + '<button class="secondary small" onclick="event.stopPropagation();toggleStatus(\''+e.id+'\')">切换在职/离职</button>'
        + '<button class="secondary small" onclick="event.stopPropagation();delEmp(\''+e.id+'\')">删除</button>'
        + '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function row(label, val, isHtml){
    return '<tr><td>'+label+'</td><td>'+(isHtml? (val||'-') : esc(val||'-'))+'</td></tr>';
  }

  var html = '';
  order.forEach(function(g){
    html += '<p style="font-size:13px;font-weight:600;margin:0 0 8px;color:var(--text-secondary);">'+esc(g)+' <span style="font-weight:400;color:var(--text-muted);">('+groups[g].length+'人)</span></p>';
    html += '<div class="emp-list" style="margin-bottom:18px;">';
    if(fc==='全部'){
      // 全部公司检视:组内再照公司拆出子标题,子标题下按名字编号
      var byCompany = {};
      var companyOrder = [];
      groups[g].forEach(function(e){
        var c = e.company || '未指定公司';
        if(!byCompany[c]){ byCompany[c] = []; companyOrder.push(c); }
        byCompany[c].push(e);
      });
      companyOrder.sort(function(a,b){
        var ca = COMPANY_ORDER[a]!==undefined ? COMPANY_ORDER[a] : 99;
        var cb = COMPANY_ORDER[b]!==undefined ? COMPANY_ORDER[b] : 99;
        return ca-cb;
      });
      companyOrder.forEach(function(c){
        html += '<div style="padding:8px 16px;background:var(--surface-2);font-size:12px;font-weight:600;color:var(--text-secondary);border-bottom:1px solid var(--border);">'+esc(c)+'</div>';
        byCompany[c].forEach(function(e, idx){ html += empCardHtml(e, idx+1); });
      });
    } else {
      groups[g].forEach(function(e){ html += empCardHtml(e); });
    }
    html += '</div>';
  });
  container.innerHTML = html;
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
  var updateData = { status: newStatus };
  if(newStatus==='离职'){
    var d = prompt('这个员工的离职日期是?(格式 YYYY-MM-DD)\n填了之后,薪水计算才知道他离职前的那几个月还要照常算他,离职月之后就不会再出现。', e.resignDate || todayStr());
    if(d===null) return; // 按取消就不切换
    updateData.resignDate = d.trim() || null;
  } else {
    updateData.resignDate = null; // 重新在职,清掉之前的离职日期
  }
  var row = objToRow(EMP_FIELD_MAP, updateData);
  var { error } = await sb.from('employees').update(row).eq('id', id);
  if(error){ alert('更新失败:' + error.message); return; }
  e.status = newStatus;
  e.resignDate = updateData.resignDate;
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
  data.noBenefits = document.getElementById('f-nobenefits').checked;

  if(editingId){
    var idx = employees.findIndex(function(e){ return e.id===editingId; });
    // 改了薪水/公司/职位这些要问生效日:从那天所在的月份起才套用新的,之前的月份不动
    var changed = detectTrackedChanges(employees[idx], data);
    if(changed.length){
      if(!employeeChangesReady){
        document.getElementById('emp-msg').textContent = '还不能改这些资料:员工变更记录表还没建好(请先去 Supabase 执行建表 SQL),不然改了就没有历史记录。';
        return;
      }
      var summary = changed.map(function(c){
        return '· '+TRACKED_FIELDS[c.field]+':'+showChangeVal(c.field, c.oldValue)+' → '+showChangeVal(c.field, c.newValue);
      }).join('\n');
      var d = await askEffectiveDate(summary, todayStr().slice(0,8)+'01');
      if(d===null){ document.getElementById('emp-msg').textContent = '已取消,没有保存。'; return; }
      if(!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(new Date(d).getTime())){
        document.getElementById('emp-msg').textContent = '没有选生效日期,没有保存。请再按一次保存,选好日期。';
        return;
      }
      var rec = await recordEmployeeChanges(editingId, changed, d);
      if(rec.error){ document.getElementById('emp-msg').textContent = '保存变更记录失败:' + rec.error.message; return; }
      Object.keys(rec.latest).forEach(function(f){ data[f] = rec.latest[f]; }); // 员工资料那行存「最晚生效日」的值
    }
    var row = objToRow(EMP_FIELD_MAP, data);
    var { error } = await sb.from('employees').update(row).eq('id', editingId);
    if(error){ document.getElementById('emp-msg').textContent = '保存失败:' + error.message; return; }
    data.id = editingId;
    data.status = employees[idx].status;
    employees[idx] = Object.assign({}, employees[idx], data); // 保留没在表单里的栏位(例如离职日期)
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
