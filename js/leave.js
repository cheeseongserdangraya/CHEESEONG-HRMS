// 请假管理模块
var leaveRecords = [];
var carryRecords = [];
var AL_MAX_CARRY = 5;
var editingLeaveId = null;

async function fetchLeaveRecords(){
  var [leaveRes, carryRes] = await Promise.all([
    sb.from('leave_records').select('*').order('start_date', { ascending: false }),
    sb.from('leave_carry').select('*')
  ]);
  if(leaveRes.error){ alert('读取请假记录失败:' + leaveRes.error.message); } else {
    leaveRecords = leaveRes.data.map(function(row){ return rowToObj(LEAVE_FIELD_MAP, row); });
  }
  if(carryRes.error){ alert('读取年假结转记录失败:' + carryRes.error.message); } else {
    carryRecords = carryRes.data.map(function(row){ return rowToObj(CARRY_FIELD_MAP, row); });
  }
}

function populateLeaveEmployeeSelect(){
  var company = document.getElementById('leave-company').value;
  var sel = document.getElementById('leave-employee');
  var active = employees.filter(function(e){ return e.company===company && (e.status||'在职')==='在职' && !e.noBenefits; });
  sel.innerHTML = active.map(function(e){ return '<option value="'+e.id+'">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+'</option>'; }).join('');
  if(active.length===0){ sel.innerHTML = '<option value="">该公司暂无在职员工</option>'; }
  updateLeaveBalancePreview();
}

function autoCalcLeaveDays(){
  var start = document.getElementById('leave-start').value;
  var end = document.getElementById('leave-end').value;
  if(!start) return;
  if(!end) document.getElementById('leave-end').value = start;
  var s = new Date(start), e = new Date(end||start);
  var days = Math.round((e-s)/86400000) + 1;
  if(days>0) document.getElementById('leave-days').value = days;
  updateLeaveBalancePreview();
}

function serviceYearsCompleted(emp, asOfDate){
  if(!emp || !emp.joinDate) return 0;
  var join = new Date(emp.joinDate);
  var ref = asOfDate ? new Date(asOfDate) : new Date();
  var years = (ref - join) / (365.25*86400000);
  return years < 0 ? 0 : Math.floor(years);
}

function leaveTier(emp, asOfDate){
  var yrs = serviceYearsCompleted(emp, asOfDate);
  if(yrs <= 2) return {AL:8, MC:14};
  if(yrs <= 5) return {AL:12, MC:18};
  return {AL:16, MC:22};
}

function isMyanmarEmployee(emp){ return !!(emp && emp.nationality==='缅甸'); }

function annualLeaveEntitlement(emp, asOfDate){
  if(!emp) return 0;
  if(isMyanmarEmployee(emp)) return 0; // 缅甸员工没有AL额度,所有假期一律算无薪假
  if(emp.annualLeave && Number(emp.annualLeave)>0) return Number(emp.annualLeave); // manual override
  if(!emp.joinDate) return 0;
  return leaveTier(emp, asOfDate).AL;
}

function mcLeaveEntitlement(emp, asOfDate){
  if(!emp || !emp.joinDate) return 0;
  if(isMyanmarEmployee(emp)) return 0;
  return leaveTier(emp, asOfDate).MC;
}

function clEntitlement(emp){ return isMyanmarEmployee(emp) ? 0 : 1; }
function mlEntitlement(emp){ return (emp && emp.gender==='女' && !isMyanmarEmployee(emp)) ? 98 : 0; }
function plEntitlement(emp){ return (emp && emp.gender==='男' && !isMyanmarEmployee(emp)) ? 5 : 0; }

function carryInDays(employeeId, year){
  var rec = carryRecords.find(function(r){ return r.employeeId===employeeId && r.toYear===year; });
  return rec ? rec.days : 0;
}

function accruedAnnualLeave(emp, asOfDate){
  // 按月累计,不是年初一次性给满 — 例如一年8天,到7月大概只累计了8*7/12天
  if(!emp) return 0;
  var d = asOfDate ? new Date(asOfDate) : new Date();
  var full = annualLeaveEntitlement(emp, asOfDate);
  var joinYear = emp.joinDate ? Number((emp.joinDate||'').slice(0,4)) : d.getFullYear();
  var refYear = d.getFullYear();
  var monthsElapsed = d.getMonth() + 1; // Jan累计到1月 = 1/12, 直到12月 = 12/12
  if(joinYear === refYear && emp.joinDate){
    // 当年入职,只从入职那个月开始累计
    var joinMonth = Number((emp.joinDate||'').slice(5,7));
    monthsElapsed = Math.max(0, monthsElapsed - joinMonth + 1);
  }
  var carryIn = carryInDays(emp.id, refYear.toString());
  return Math.round(full * monthsElapsed / 12) + carryIn;
}

function daysForType(employeeId, type, year, excludeId){
  return round2(leaveRecords.filter(function(r){ return r.employeeId===employeeId && r.type===type && (r.start||'').slice(0,4)===year && r.id!==excludeId; })
    .reduce(function(s,r){ return s + r.days; }, 0));
}

function annualLeaveUsed(employeeId, year, excludeId){
  var emp = employees.find(function(e){ return e.id===employeeId; });
  if(isMyanmarEmployee(emp)) return 0; // 缅甸员工没有AL概念,所有假期都算无薪假
  var alDays = daysForType(employeeId, '年假', year, excludeId);
  var elDays = daysForType(employeeId, '紧急事假', year, excludeId);
  var clDays = daysForType(employeeId, '同情假', year, excludeId); // 同情假CL固定1天,超过从AL扣
  var clOverflow = Math.max(0, round2(clDays - clEntitlement(emp)));
  // 注意:「丧假」是另一种独立的有薪假(死亡证明书那种),不计入年假扣除,系统只记录用了几天,不在这里处理
  return round2(alDays + elDays + clOverflow);
}

function unpaidLeaveDaysForMonth(employeeId, month){
  var emp = employees.find(function(e){ return e.id===employeeId; });
  if(isMyanmarEmployee(emp)){
    // 缅甸员工:不管选什么假期类型,一律算无薪假
    return leaveRecords.filter(function(r){ return r.employeeId===employeeId && (r.start||'').slice(0,7)===month; })
      .reduce(function(s,r){ return s + r.days; }, 0);
  }
  return leaveRecords.filter(function(r){ return r.employeeId===employeeId && r.type==='无薪假' && (r.start||'').slice(0,7)===month; })
    .reduce(function(s,r){ return s + r.days; }, 0);
}

function updateLeaveBalancePreview(){
  var employeeId = document.getElementById('leave-employee').value;
  var type = document.getElementById('leave-type').value;
  var el = document.getElementById('leave-preview');
  if(!employeeId){ el.innerHTML = '<span style="color:var(--text-muted);">请先选择员工</span>'; return; }
  var emp = employees.find(function(e){ return e.id===employeeId; });
  var asOfDate = document.getElementById('leave-start').value || new Date().toISOString().slice(0,10);
  var year = asOfDate.slice(0,4);
  var thisDays = Number(document.getElementById('leave-days').value)||0;

  if(isMyanmarEmployee(emp)){
    el.innerHTML = '<span style="color:var(--warning);">⚠️ 缅甸员工:不管选什么假期类型,一律算无薪假,会按 底薪/26×'+thisDays+'天 从薪水扣除,没有AL/MC/CL额度</span>';
    return;
  }
  if(type==='无薪假'){
    el.innerHTML = '<span style="color:var(--text-muted);">无薪假会自动按 底薪/26×天数 从对应月份的薪水里扣除</span>';
    return;
  }
  if(type==='其他'){
    el.innerHTML = '<span style="color:var(--text-muted);">此类型不影响任何假期额度,只作记录用</span>';
    return;
  }
  if(type==='年假' || type==='紧急事假' || type==='同情假'){
    var alEnt = accruedAnnualLeave(emp, asOfDate);
    var alUsed = annualLeaveUsed(employeeId, year, editingLeaveId);
    var extra = type==='紧急事假' ? thisDays : (type==='同情假' ? Math.max(0, round2(thisDays + leaveDaysForType(employeeId,'同情假',year) - clEntitlement(emp))) : thisDays);
    var alRemain = round2(alEnt - alUsed - (type==='年假'?thisDays:extra));
    var note = type==='紧急事假' ? '(EL会从年假额度扣)' : (type==='同情假' ? '(同情假固定1天,超过的部分会从年假扣)' : '');
    el.innerHTML = '截至 '+asOfDate+' 累计年假 <b>'+alEnt+'</b> 天,'+year+'年已用(含EL/超额同情假) <b>'+alUsed+'</b> 天,这次影响年假 <b>'+(type==='年假'?thisDays:extra)+'</b> 天 '+note+',之后年假剩余 <b style="color:'+(alRemain<0?'var(--danger)':'var(--success)')+';">'+alRemain+'</b> 天'
      + (alRemain<0?' <span style="color:var(--danger);">(超过目前累计的年假)</span>':'');
    return;
  }
  if(type==='丧假'){
    var bvUsed = leaveDaysForType(employeeId, '丧假', year);
    el.innerHTML = '丧假是独立的有薪假,不影响年假额度,系统只记录天数。'+year+'年已记录 <b>'+bvUsed+'</b> 天,这次 <b>'+thisDays+'</b> 天'
      + '<br/><span style="color:var(--text-muted);">政策参考:直属亲属(配偶/父母/子女/岳父母/家公家婆)3天;兄弟姐妹/公婆/外公外婆2天;超过部分要自己核对,手动改成无薪假或提醒扣年假。须提供死亡证明书。</span>';
    return;
  }
  if(type==='PH假期'){
    var phAccrued = phLeaveAccrued(employeeId);
    var phUsed = phLeaveUsedAllTime(employeeId, editingLeaveId);
    var phRemain = round2(phAccrued - phUsed - thisDays);
    el.innerHTML = 'PH假期累积(来自「PH假期」分页记录)<b>'+phAccrued+'</b> 天,已用 <b>'+phUsed+'</b> 天,这次请 <b>'+thisDays+'</b> 天,之后剩余 <b style="color:'+(phRemain<0?'var(--danger)':'var(--success)')+';">'+phRemain+'</b> 天'
      + (phRemain<0?' <span style="color:var(--danger);">(超过累积的PH假期,先去「PH假期」分页补记录)</span>':'');
    return;
  }
  if(type==='病假'){
    var mcEnt = mcLeaveEntitlement(emp, asOfDate);
    var mcUsed = daysForType(employeeId, '病假', year, editingLeaveId);
    var mcRemain = round2(mcEnt - mcUsed - thisDays);
    el.innerHTML = '该员工工龄对应病假额度 <b>'+mcEnt+'</b> 天/年,'+year+'年已用 <b>'+mcUsed+'</b> 天,这次请 <b>'+thisDays+'</b> 天,之后剩余 <b style="color:'+(mcRemain<0?'var(--danger)':'var(--success)')+';">'+mcRemain+'</b> 天'
      + (mcRemain<0?' <span style="color:var(--danger);">(超过病假额度)</span>':'')
      + '<br/><span style="color:var(--text-muted);">病假需要医生证明;如是工作伤害住院,享有60天</span>';
    return;
  }
  if(type==='产假'){
    if(emp && emp.gender!=='女'){ el.innerHTML = '<span style="color:var(--danger);">该员工性别登记为男,产假通常只适用于女性员工,请确认</span>'; return; }
    var mlUsed = daysForType(employeeId, '产假', year, editingLeaveId);
    el.innerHTML = '产假额度 <b>98</b> 天(有薪),已用 <b>'+mlUsed+'</b> 天,这次请 <b>'+thisDays+'</b> 天<br/><span style="color:var(--text-muted);">产假后需填写MC form + 医生证明书 + 孩子的报生纸</span>';
    return;
  }
  if(type==='陪产假'){
    if(emp && emp.gender!=='男'){ el.innerHTML = '<span style="color:var(--danger);">该员工性别登记为女,陪产假通常只适用于男性员工,请确认</span>'; return; }
    var plUsed = daysForType(employeeId, '陪产假', year, editingLeaveId);
    var plRemain = round2(5 - plUsed - thisDays);
    el.innerHTML = '陪产假额度 <b>5</b> 天(有薪),已用 <b>'+plUsed+'</b> 天,这次请 <b>'+thisDays+'</b> 天,之后剩余 <b style="color:'+(plRemain<0?'var(--danger)':'var(--success)')+';">'+plRemain+'</b> 天'
      + (plRemain<0?' <span style="color:var(--danger);">(超过陪产假额度)</span>':'')
      + '<br/><span style="color:var(--text-muted);">陪产假后需填写MC form + 医生证明书 + 孩子的报生纸</span>';
    return;
  }
  el.innerHTML = '';
}

async function addLeaveRecord(){
  if(!isAdmin()) return;
  var employeeId = document.getElementById('leave-employee').value;
  var start = document.getElementById('leave-start').value;
  var end = document.getElementById('leave-end').value || start;
  var days = Number(document.getElementById('leave-days').value)||0;
  if(!employeeId){ document.getElementById('leave-msg').textContent = '请先新增员工资料'; return; }
  if(!start){ document.getElementById('leave-msg').textContent = '请选择开始日期'; return; }
  if(days<=0){ document.getElementById('leave-msg').textContent = '请输入天数'; return; }
  var data = {
    employeeId: employeeId,
    company: document.getElementById('leave-company').value,
    type: document.getElementById('leave-type').value,
    start: start,
    end: end,
    days: days,
    notes: document.getElementById('leave-notes').value.trim()
  };
  if(editingLeaveId){
    var { error } = await sb.from('leave_records').update(objToRow(LEAVE_FIELD_MAP, data)).eq('id', editingLeaveId);
    if(error){ document.getElementById('leave-msg').textContent = '保存失败:' + error.message; return; }
    var idx = leaveRecords.findIndex(function(r){ return r.id===editingLeaveId; });
    data.id = editingLeaveId;
    leaveRecords[idx] = data;
    document.getElementById('leave-msg').textContent = '已更新';
    stopLeaveEdit();
  } else {
    var { data: inserted, error: err2 } = await sb.from('leave_records').insert(objToRow(LEAVE_FIELD_MAP, data)).select().single();
    if(err2){ document.getElementById('leave-msg').textContent = '新增失败:' + err2.message; return; }
    leaveRecords.push(rowToObj(LEAVE_FIELD_MAP, inserted));
    document.getElementById('leave-msg').textContent = '已新增';
    ['leave-start','leave-end','leave-days','leave-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  }
  setTimeout(function(){ document.getElementById('leave-msg').textContent=''; }, 2000);
  updateLeaveBalancePreview();
  renderLeaveList();
  renderLeaveOverview();
}

function startLeaveEdit(r){
  editingLeaveId = r.id;
  document.getElementById('leave-company').value = r.company;
  populateLeaveEmployeeSelect();
  document.getElementById('leave-employee').value = r.employeeId;
  document.getElementById('leave-type').value = r.type;
  document.getElementById('leave-start').value = r.start;
  document.getElementById('leave-end').value = r.end;
  document.getElementById('leave-days').value = r.days;
  document.getElementById('leave-notes').value = r.notes;
  document.getElementById('btn-leave-submit').textContent = '保存修改';
  document.getElementById('btn-leave-cancel').style.display = 'inline-block';
  updateLeaveBalancePreview();
  window.scrollTo({top:0, behavior:'smooth'});
}
function stopLeaveEdit(){
  editingLeaveId = null;
  ['leave-start','leave-end','leave-days','leave-notes'].forEach(function(id){ document.getElementById(id).value=''; });
  document.getElementById('btn-leave-submit').textContent = '+ 新增记录';
  document.getElementById('btn-leave-cancel').style.display = 'none';
}

async function delLeaveRecord(id){
  if(!isAdmin()) return;
  var { error } = await sb.from('leave_records').delete().eq('id', id);
  if(error){ alert('删除失败:' + error.message); return; }
  leaveRecords = leaveRecords.filter(function(r){ return r.id!==id; });
  if(editingLeaveId===id) stopLeaveEdit();
  renderLeaveList();
  renderLeaveOverview();
}

function renderLeaveList(){
  var fc = document.getElementById('leave-filter-company').value;
  var fy = document.getElementById('leave-filter-year').value;
  var list = leaveRecords.filter(function(r){
    var okC = fc==='全部' || r.company===fc;
    var okY = !fy || (r.start||'').indexOf(fy)===0;
    return okC && okY;
  });
  var container = document.getElementById('leave-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无请假记录</div>'; return; }

  var byEmployee = {};
  var order = [];
  list.forEach(function(r){
    var emp = employees.find(function(e){ return e.id===r.employeeId; });
    var name = emp ? (emp.nameEn||emp.nameCn) : '(已删除员工)';
    if(!byEmployee[r.employeeId]){ byEmployee[r.employeeId] = { name:name, company:r.company, emp:emp, records:[] }; order.push(r.employeeId); }
    byEmployee[r.employeeId].records.push(r);
  });
  order.sort(function(a,b){ return byEmployee[a].name.localeCompare(byEmployee[b].name); });

  var typeColor = {'年假':'var(--success)','病假':'var(--warning)','紧急事假':'var(--accent)','无薪假':'var(--danger)','同情假':'var(--text-muted)','丧假':'var(--text-muted)','产假':'var(--accent)','陪产假':'var(--accent)','PH假期':'var(--success)','其他':'var(--text-secondary)'};

  var html = '';
  order.forEach(function(empId){
    var g = byEmployee[empId];
    g.records.sort(function(a,b){ return (b.start||'').localeCompare(a.start||''); });
    var year = fy || new Date().getFullYear().toString();
    var asOfToday = (year===new Date().getFullYear().toString()) ? new Date().toISOString().slice(0,10) : year+'-12-31';
    var entitlement = accruedAnnualLeave(g.emp, asOfToday);
    var usedAnnual = annualLeaveUsed(empId, year);
    var mcEnt = mcLeaveEntitlement(g.emp, asOfToday);
    var mcUsed = leaveDaysForType(empId, '病假', year);
    html += '<div class="card">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px;">'
      + '<p style="font-weight:600;font-size:14px;margin:0;">'+esc(g.name)+' <span style="color:var(--text-muted);font-weight:400;font-size:12px;">'+esc(g.company)+'</span></p>'
      + '<p style="font-size:12px;margin:0;color:var(--text-secondary);">'+year+'年 AL:已用 <b>'+usedAnnual+'</b>/'+entitlement+'天,剩 <b style="color:'+(entitlement-usedAnnual<0?'var(--danger)':'var(--success)')+';">'+round2(entitlement-usedAnnual)+'</b> · MC:已用 <b>'+mcUsed+'</b>/'+mcEnt+'天</p>'
      + '</div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
      + '<tr style="color:var(--text-secondary);"><th style="text-align:left;padding:4px 6px 4px 0;">类型</th><th style="text-align:left;padding:4px 6px;">日期</th><th style="text-align:right;padding:4px 6px;">天数</th><th style="text-align:left;padding:4px 6px;">备注</th><th style="padding:4px 6px;"></th></tr>';
    g.records.forEach(function(r){
      html += '<tr style="border-top:1px solid var(--border);" data-leave-id="'+r.id+'">'
        + '<td style="padding:6px;color:'+(typeColor[r.type]||'inherit')+';font-weight:500;">'+esc(r.type)+'</td>'
        + '<td style="padding:6px;">'+esc(r.start)+(r.end&&r.end!==r.start?' ~ '+esc(r.end):'')+'</td>'
        + '<td style="padding:6px;text-align:right;">'+r.days+'</td>'
        + '<td style="padding:6px;color:var(--text-secondary);">'+esc(r.notes||'-')+'</td>'
        + '<td style="padding:6px;white-space:nowrap;">'+(isAdmin() ? '<button type="button" class="secondary small leave-edit-btn">编辑</button> <button type="button" class="secondary small leave-del-btn">删除</button>' : '')+'</td>'
        + '</tr>';
    });
    html += '</table></div>';
  });
  container.innerHTML = html;

  container.querySelectorAll('.leave-edit-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      var id = btn.closest('tr').getAttribute('data-leave-id');
      var r = leaveRecords.find(function(x){ return x.id===id; });
      if(r) startLeaveEdit(r);
    });
  });
  container.querySelectorAll('.leave-del-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      delLeaveRecord(btn.closest('tr').getAttribute('data-leave-id'));
    });
  });
}

function leaveDaysForType(employeeId, type, year){
  return daysForType(employeeId, type, year, null);
}

function renderLeaveOverview(){
  var fc = document.getElementById('ov-filter-company').value;
  var year = new Date().getFullYear().toString();
  var today = new Date().toISOString().slice(0,10);
  var list = employees.filter(function(e){
    var okC = fc==='全部' || e.company===fc;
    return okC && (e.status||'在职')==='在职' && !e.noBenefits && e.employeeType!=='兼职';
  });
  var container = document.getElementById('leave-overview');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无员工</div>'; return; }

  var COMPANY_ORDER = {'FIRSTONE':0, 'CS FIRSTONE':1, 'TONGPOPO':2};
  var NAT_ORDER = {'本地':0, '尼泊尔':1, '缅甸':2};
  function natRank(nat){ return NAT_ORDER[nat]!==undefined ? NAT_ORDER[nat] : 99; }
  list.sort(function(a,b){
    if(fc==='全部'){
      var ca = COMPANY_ORDER[a.company]!==undefined ? COMPANY_ORDER[a.company] : 99;
      var cb = COMPANY_ORDER[b.company]!==undefined ? COMPANY_ORDER[b.company] : 99;
      if(ca!==cb) return ca-cb;
    }
    var na = natRank(a.nationality), nb = natRank(b.nationality);
    if(na!==nb) return na-nb;
    return (a.nameEn||'').localeCompare(b.nameEn||'');
  });

  var html = '<table class="pay-table"><tr><th>姓名</th><th>公司</th>'
    + '<th>AL 累计/已用/剩余</th><th>PH假期 累积/已用/剩余</th><th>MC 额度/已用/剩余</th><th>同情假 额度/已用/剩余</th><th>丧假 已用</th>'
    + '<th>EL 已用</th><th>ML 已用</th><th>PL 已用</th><th>无薪假</th><th>医疗费报销 RM</th></tr>';
  list.forEach(function(e){
    var alAccrued = accruedAnnualLeave(e, today);
    var alUsed = annualLeaveUsed(e.id, year);
    var alRemain = round2(alAccrued - alUsed);

    var mcEnt = mcLeaveEntitlement(e, today);
    var mcUsedDays = leaveDaysForType(e.id, '病假', year);
    var mcRemainDays = round2(mcEnt - mcUsedDays);

    var clEnt = clEntitlement(e);
    var clUsedDays = leaveDaysForType(e.id, '同情假', year);
    var clRemainDays = round2(clEnt - clUsedDays);

    var bvUsedDays = leaveDaysForType(e.id, '丧假', year); // 丧假不设额度,只记录天数

    var phAccruedDays = phLeaveAccrued(e.id);
    var phUsedDays = phLeaveUsedAllTime(e.id);
    var phRemainDays = round2(phAccruedDays - phUsedDays);

    var elUsedDays = leaveDaysForType(e.id, '紧急事假', year);
    var mlUsedDays = leaveDaysForType(e.id, '产假', year);
    var plUsedDays = leaveDaysForType(e.id, '陪产假', year);
    var unpaidDays = isMyanmarEmployee(e)
      ? round2(leaveRecords.filter(function(r){ return r.employeeId===e.id && (r.start||'').slice(0,4)===year; }).reduce(function(s,r){ return s+r.days; }, 0))
      : leaveDaysForType(e.id, '无薪假', year);

    var mcClaimUsed = mcClaims.filter(function(c){ return c.employeeId===e.id && (c.date||'').slice(0,4)===year; }).reduce(function(s,c){ return s+c.claimAmount; }, 0);

    html += '<tr>'
      + '<td style="font-weight:500;white-space:nowrap;">'+esc(e.nameEn)+(e.nameCn?' '+esc(e.nameCn):'')+' <span style="color:var(--text-muted);font-weight:400;font-size:11px;">('+esc(e.nationality||'其他')+')</span></td>'
      + '<td style="white-space:nowrap;">'+esc(e.company)+(isMyanmarEmployee(e)?' <span style="color:var(--warning);font-size:11px;">(缅甸-全算无薪)</span>':'')+'</td>'
      + '<td style="white-space:nowrap;">'+alAccrued+' / '+alUsed+' / <b style="color:'+(alRemain<0?'var(--danger)':'var(--success)')+';">'+alRemain+'</b></td>'
      + '<td style="white-space:nowrap;">'+phAccruedDays+' / '+phUsedDays+' / <b style="color:'+(phRemainDays<0?'var(--danger)':'var(--success)')+';">'+phRemainDays+'</b></td>'
      + '<td style="white-space:nowrap;">'+mcEnt+' / '+mcUsedDays+' / <b style="color:'+(mcRemainDays<0?'var(--danger)':'var(--success)')+';">'+mcRemainDays+'</b></td>'
      + '<td style="white-space:nowrap;">'+clEnt+' / '+clUsedDays+' / <b style="color:'+(clRemainDays<0?'var(--danger)':'var(--success)')+';">'+clRemainDays+'</b></td>'
      + '<td>'+bvUsedDays+'</td>'
      + '<td>'+elUsedDays+'</td>'
      + '<td>'+mlUsedDays+'</td>'
      + '<td>'+plUsedDays+'</td>'
      + '<td>'+unpaidDays+'</td>'
      + '<td>'+fmt(mcClaimUsed)+'</td>'
      + '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;
}

async function setCarry(employeeId, fromYear, toYear, days){
  if(!isAdmin()) return;
  var idx = carryRecords.findIndex(function(r){ return r.employeeId===employeeId && r.toYear===toYear; });
  if(days<=0){
    if(idx>-1){
      var { error } = await sb.from('leave_carry').delete().eq('id', carryRecords[idx].id);
      if(error){ alert('删除结转记录失败:' + error.message); return; }
      carryRecords.splice(idx,1);
    }
  } else {
    var data = { employeeId: employeeId, fromYear: fromYear, toYear: toYear, days: days };
    var { data: upserted, error: err2 } = await sb.from('leave_carry')
      .upsert(objToRow(CARRY_FIELD_MAP, data), { onConflict: 'employee_id,to_year' })
      .select().single();
    if(err2){ alert('保存结转记录失败:' + err2.message); return; }
    var newObj = rowToObj(CARRY_FIELD_MAP, upserted);
    if(idx>-1) carryRecords[idx] = newObj; else carryRecords.push(newObj);
  }
}

function renderCarryList(){
  var fc = document.getElementById('carry-filter-company').value;
  var year = document.getElementById('carry-year').value || new Date().getFullYear().toString();
  var nextYear = (Number(year)+1).toString();
  var list = employees.filter(function(e){
    var okC = fc==='全部' || e.company===fc;
    return okC && (e.status||'在职')==='在职' && !e.noBenefits && e.employeeType!=='兼职';
  });
  var container = document.getElementById('carry-list');
  if(list.length===0){ container.innerHTML = '<div class="empty-state">暂无员工</div>'; return; }
  list.sort(function(a,b){ return (a.nameEn||'').localeCompare(b.nameEn||''); });

  var rows = list.map(function(e){
    var fullYearEntitlement = accruedAnnualLeave(e, year+'-12-31');
    var used = annualLeaveUsed(e.id, year);
    var remaining = round2(fullYearEntitlement - used);
    var suggested = Math.max(0, Math.min(remaining, AL_MAX_CARRY));
    var forfeited = Math.max(0, round2(remaining - AL_MAX_CARRY));
    return { e:e, remaining:remaining, suggested:suggested, forfeited:forfeited };
  }).filter(function(r){ return r.remaining>0; });

  if(rows.length===0){ container.innerHTML = '<div class="empty-state">'+year+'年底没有员工有剩余年假</div>'; return; }

  var html = '<table class="pay-table"><tr><th>姓名</th><th>公司</th><th style="text-align:right;">'+year+'年底剩余</th><th style="text-align:right;">建议结转(封顶5天)</th><th style="text-align:right;">会作废</th><th>实际结转到'+nextYear+'年</th></tr>';
  rows.forEach(function(r, i){
    var current = carryInDays(r.e.id, nextYear) || r.suggested;
    var dis = isAdmin() ? '' : 'disabled';
    html += '<tr data-emp="'+r.e.id+'">'
      + '<td style="font-weight:500;white-space:nowrap;">'+esc(r.e.nameEn)+(r.e.nameCn?' '+esc(r.e.nameCn):'')+'</td>'
      + '<td>'+esc(r.e.company)+'</td>'
      + '<td style="text-align:right;">'+r.remaining+' 天</td>'
      + '<td style="text-align:right;color:var(--success);">'+r.suggested+' 天</td>'
      + '<td style="text-align:right;color:'+(r.forfeited>0?'var(--danger)':'var(--text-muted)')+';">'+r.forfeited+' 天</td>'
      + '<td><input type="number" step="0.5" class="carry-input" data-emp="'+r.e.id+'" data-from="'+year+'" data-to="'+nextYear+'" value="'+current+'" style="width:70px;" '+dis+' /></td>'
      + '</tr>';
  });
  html += '</table>';
  container.innerHTML = html;

  container.querySelectorAll('.carry-input').forEach(function(inp){
    inp.addEventListener('change', async function(){
      await setCarry(inp.getAttribute('data-emp'), inp.getAttribute('data-from'), inp.getAttribute('data-to'), Number(inp.value)||0);
      renderLeaveOverview();
    });
  });
}
