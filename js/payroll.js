// 薪水计算模块
var payrollGroups = {};
var payrollSavedRowIds = {}; // employeeId -> 已存在的 payroll_records.id(用来 update 而不是 insert)
var payrollLoadedKey = null; // 目前内存里 payrollGroups 对应的 "公司|月份",用来判断切分页要不要重新抓资料库
var payrollGroupOpen = {}; // gid -> 是否展开,预设全部收合,局部重新渲染(例如切OT手动金额)时要记得维持

// 切回「薪水计算」分页时用:公司/月份没换的话就不重新抓资料库,保留还没存档的编辑
function showPayrollTab(){
  var company = document.getElementById('pay-company').value;
  var month = document.getElementById('pay-month').value;
  var curKey = company + '|' + month;
  if(payrollLoadedKey===curKey && Object.keys(payrollGroups).length>0){
    renderPayTable();
  } else {
    loadPayroll();
  }
}

function mcAmountForMonth(employeeId, month){
  return round2(mcClaims.filter(function(c){ return c.employeeId===employeeId && (c.date||'').slice(0,7)===month; })
    .reduce(function(s,c){ return s + c.claimAmount; }, 0));
}

async function loadPayroll(){
  var company = document.getElementById('pay-company').value;
  var month = document.getElementById('pay-month').value;
  if(!month){ return; }

  var { data, error } = await sb.from('payroll_records').select('*').eq('company', company).eq('month', month);
  if(error){ alert('读取薪水记录失败:' + error.message); return; }
  var saved = {};
  payrollSavedRowIds = {};
  data.forEach(function(row){
    var o = rowToObj(PAYROLL_FIELD_MAP, row);
    saved[o.employeeId] = o;
    payrollSavedRowIds[o.employeeId] = o.id;
  });

  var active = employees.filter(function(e){
    if(e.company!==company) return false;
    if((e.status||'在职')==='在职') return true;
    // 离职员工:只要离职日期是这个月或之后,代表这个月他还在职、要照常出现;离职月之后才排除
    return !!(e.resignDate && e.resignDate.slice(0,7) >= month);
  });
  active.sort(function(a,b){ return (a.nameEn||'').localeCompare(b.nameEn||''); });
  payrollGroups = {};
  active.forEach(function(e){
    var g = groupLabel(e);
    if(!payrollGroups[g]) payrollGroups[g] = { isHourly: e.employeeType==='兼职', rows: [] };
    var s = saved[e.id];
    var hasSaved = !!s;
    s = s || {};
    var mcClaim = mcAmountForMonth(e.id, month);
    var loanRepay = loanRepayForMonth(e.id, month);
    var otDaysLogged = otCountForMonth(e.id, month);
    var lateCount = lateCountForMonth(e.id, month);
    var unpaidDays = unpaidLeaveDaysForMonth(e.id, month);
    if(e.employeeType==='兼职'){
      payrollGroups[g].rows.push({
        employeeId: e.id, name: e.nameEn,
        hourlyRate: (s.hourlyRate!==undefined && s.hourlyRate!==null) ? s.hourlyRate : (e.hourlyRate||0),
        hours: s.hours||0, mcClaim: mcClaim, advance: loanRepay, notes: s.notes||''
      });
    } else {
      payrollGroups[g].rows.push({
        employeeId: e.id, name: e.nameEn,
        basicSalary: (s.basicSalary!==undefined && s.basicSalary!==null) ? s.basicSalary : e.basicSalary,
        allowance: hasSaved ? (s.allowance||0) : (e.allowance||0),
        phDays: s.phDays||0, otHours: s.otHours||0,
        otAmountOverride: (s.otAmountOverride!==undefined && s.otAmountOverride!==null) ? s.otAmountOverride : null,
        teamBonus: s.teamBonus||0, commissionSharing: s.commissionSharing||0,
        bonus: s.bonus||0, otherAdjustment: s.otherAdjustment||0, mistakeAmount: s.mistakeAmount||0, advance: loanRepay,
        epfSocso: s.epfSocso||0, pcb: s.pcb||0, mcClaim: mcClaim,
        otDaysLogged: otDaysLogged, lateCount: lateCount, unpaidDays: unpaidDays,
        notes: s.notes||''
      });
    }
  });
  payrollLoadedKey = company + '|' + month;
  renderPayTable();
}

function phAmount(row){ return round2(row.basicSalary/26 * (Number(row.phDays)||0)); }
function otAmount(row){
  if(row.otAmountOverride!==null && row.otAmountOverride!==undefined) return round2(row.otAmountOverride);
  return round2(row.basicSalary/26/10 * (Number(row.otHours)||0) * 1.5);
}
function otManual(row){ return row.otAmountOverride!==null && row.otAmountOverride!==undefined; }

function toggleOtManual(gid, i){
  if(!isAdmin()) return;
  var label = findGroupByGid(gid);
  var row = payrollGroups[label].rows[i];
  if(otManual(row)){
    row.otAmountOverride = null; // 切回小时公式
  } else {
    row.otAmountOverride = otAmount(row); // 用目前算出的金额当起始值,方便她再自己微调
  }
  renderPayTable();
}
function tscAmount(row){ return round2((Number(row.teamBonus)||0) + (Number(row.commissionSharing)||0)); }
function hourlyTotal(row){ return round2((Number(row.hourlyRate)||0) * (Number(row.hours)||0)); }
function unpaidDeduction(row){ return round2(row.basicSalary/26 * (Number(row.unpaidDays)||0)); }
function sumField(rows, fn){ return round2(rows.reduce(function(s,r){ return s + (Number(fn(r))||0); }, 0)); }

function renderHourlyTotalRow(gid, rows){
  var hoursTotal = sumField(rows, function(r){ return r.hours; });
  var mcTotal = sumField(rows, function(r){ return r.mcClaim; });
  var advanceTotal = sumField(rows, function(r){ return r.advance; });
  var netTotal = sumField(rows, function(r){ return computeNet(r, true); });
  return '<tr style="border-top:2px solid var(--border);font-weight:700;">'
    + '<td style="position:static;">TOTAL</td>'
    + '<td>-</td>'
    + '<td id="coltot-hours-'+gid+'">'+hoursTotal+'</td>'
    + '<td id="coltot-mcClaim-'+gid+'" style="color:var(--success);">'+(mcTotal>0?'+'+fmt(mcTotal):'-')+'</td>'
    + '<td id="coltot-advance-'+gid+'" style="color:var(--danger);">'+(advanceTotal>0?'-'+fmt(advanceTotal):'-')+'</td>'
    + '<td>-</td>'
    + '<td id="grouptotal-'+gid+'">'+fmt(netTotal)+'</td>'
    + '</tr>';
}

function renderMonthlyTotalRow(gid, rows){
  var csTotal = sumField(rows, function(r){ return r.commissionSharing; });
  var advTotal = sumField(rows, function(r){ return r.advance; });
  var unpaidTotal = sumField(rows, unpaidDeduction);
  var mcTotal = sumField(rows, function(r){ return r.mcClaim; });
  return '<tr style="border-top:2px solid var(--border);font-weight:700;">'
    + '<td style="position:static;">TOTAL</td>'
    + '<td id="coltot-basicSalary-'+gid+'">'+fmt(sumField(rows, function(r){ return r.basicSalary; }))+'</td>'
    + '<td id="coltot-allowance-'+gid+'">'+fmt(sumField(rows, function(r){ return r.allowance; }))+'</td>'
    + '<td>-</td>'
    + '<td id="coltot-ph-'+gid+'">'+fmt(sumField(rows, phAmount))+'</td>'
    + '<td>-</td>'
    + '<td id="coltot-ot-'+gid+'">'+fmt(sumField(rows, otAmount))+'</td>'
    + '<td id="coltot-teamBonus-'+gid+'">'+fmt(sumField(rows, function(r){ return r.teamBonus; }))+'</td>'
    + '<td id="coltot-commissionSharing-'+gid+'">'+fmt(csTotal)+'</td>'
    + '<td id="coltot-tsc-'+gid+'">'+fmt(sumField(rows, tscAmount))+'</td>'
    + '<td id="coltot-bonus-'+gid+'">'+fmt(sumField(rows, function(r){ return r.bonus; }))+'</td>'
    + '<td id="coltot-advance-'+gid+'" style="color:var(--danger);">'+(advTotal>0?'-'+fmt(advTotal):'-')+'</td>'
    + '<td id="coltot-epfSocso-'+gid+'">'+fmt(sumField(rows, function(r){ return r.epfSocso; }))+'</td>'
    + '<td id="coltot-pcb-'+gid+'">'+fmt(sumField(rows, function(r){ return r.pcb; }))+'</td>'
    + '<td id="coltot-csback-'+gid+'" style="color:var(--danger);">-'+fmt(csTotal)+'</td>'
    + '<td id="coltot-unpaid-'+gid+'" style="color:var(--danger);">'+(unpaidTotal>0?'-'+fmt(unpaidTotal):'-')+'</td>'
    + '<td id="coltot-otherAdjustment-'+gid+'">'+fmt(sumField(rows, function(r){ return r.otherAdjustment; }))+'</td>'
    + '<td id="coltot-mistakeAmount-'+gid+'">'+fmt(sumField(rows, function(r){ return r.mistakeAmount; }))+'</td>'
    + '<td id="coltot-mcClaim-'+gid+'" style="color:var(--success);">'+(mcTotal>0?'+'+fmt(mcTotal):'-')+'</td>'
    + '<td>-</td>'
    + '<td id="grouptotal-'+gid+'">'+fmt(sumField(rows, function(r){ return computeNet(r, false); }))+'</td>'
    + '</tr>';
}

function refreshGroupTotals(gid, group){
  var rows = group.rows;
  function upd(id, text){ var el = document.getElementById(id); if(el) el.textContent = text; }
  if(group.isHourly){
    upd('coltot-hours-'+gid, sumField(rows, function(r){ return r.hours; }));
    var mcTotal = sumField(rows, function(r){ return r.mcClaim; });
    upd('coltot-mcClaim-'+gid, mcTotal>0?'+'+fmt(mcTotal):'-');
    var advanceTotal = sumField(rows, function(r){ return r.advance; });
    upd('coltot-advance-'+gid, advanceTotal>0?'-'+fmt(advanceTotal):'-');
    upd('grouptotal-'+gid, fmt(sumField(rows, function(r){ return computeNet(r,true); })));
  } else {
    upd('coltot-basicSalary-'+gid, fmt(sumField(rows, function(r){ return r.basicSalary; })));
    upd('coltot-allowance-'+gid, fmt(sumField(rows, function(r){ return r.allowance; })));
    upd('coltot-ph-'+gid, fmt(sumField(rows, phAmount)));
    upd('coltot-ot-'+gid, fmt(sumField(rows, otAmount)));
    upd('coltot-teamBonus-'+gid, fmt(sumField(rows, function(r){ return r.teamBonus; })));
    var csTotal = sumField(rows, function(r){ return r.commissionSharing; });
    upd('coltot-commissionSharing-'+gid, fmt(csTotal));
    upd('coltot-tsc-'+gid, fmt(sumField(rows, tscAmount)));
    upd('coltot-bonus-'+gid, fmt(sumField(rows, function(r){ return r.bonus; })));
    var advTotal = sumField(rows, function(r){ return r.advance; });
    upd('coltot-advance-'+gid, advTotal>0?'-'+fmt(advTotal):'-');
    upd('coltot-epfSocso-'+gid, fmt(sumField(rows, function(r){ return r.epfSocso; })));
    upd('coltot-pcb-'+gid, fmt(sumField(rows, function(r){ return r.pcb; })));
    upd('coltot-csback-'+gid, '-'+fmt(csTotal));
    var unpaidTotal = sumField(rows, unpaidDeduction);
    upd('coltot-unpaid-'+gid, unpaidTotal>0?'-'+fmt(unpaidTotal):'-');
    upd('coltot-otherAdjustment-'+gid, fmt(sumField(rows, function(r){ return r.otherAdjustment; })));
    upd('coltot-mistakeAmount-'+gid, fmt(sumField(rows, function(r){ return r.mistakeAmount; })));
    var mcTotal2 = sumField(rows, function(r){ return r.mcClaim; });
    upd('coltot-mcClaim-'+gid, mcTotal2>0?'+'+fmt(mcTotal2):'-');
    upd('grouptotal-'+gid, fmt(sumField(rows, function(r){ return computeNet(r,false); })));
  }
  var summaryTotalEl = document.getElementById('summarytotal-'+gid);
  if(summaryTotalEl){
    var sum = rows.reduce(function(s,r){ return s + computeNet(r, group.isHourly); }, 0);
    summaryTotalEl.textContent = fmt(round2(sum));
  }
}

function computeNet(row, isHourly){
  var mc = Number(row.mcClaim)||0;
  if(isHourly) return round2(hourlyTotal(row) + mc - Number(row.advance));
  return round2(row.basicSalary + Number(row.allowance) + phAmount(row) + otAmount(row)
    + tscAmount(row) + Number(row.bonus) + Number(row.otherAdjustment||0) - Number(row.advance)
    - Number(row.commissionSharing) - Number(row.epfSocso) - Number(row.pcb) + mc - unpaidDeduction(row));
}
function totalCost(row, isHourly){
  var mc = Number(row.mcClaim)||0;
  if(isHourly) return round2(hourlyTotal(row) + mc);
  return round2(row.basicSalary + Number(row.allowance) + phAmount(row) + otAmount(row)
    + tscAmount(row) + Number(row.bonus) + Number(row.otherAdjustment||0) + mc - unpaidDeduction(row));
}

function numInput(gid, i, f, v, w){
  var dis = isAdmin() ? '' : 'disabled';
  return '<input type="number" data-g="'+gid+'" data-i="'+i+'" data-f="'+f+'" value="'+v+'" oninput="updateCell(this)" style="width:'+(w||70)+'px" '+dis+' />';
}

function renderPayTable(){
  var container = document.getElementById('pay-table');
  var groupKeys = Object.keys(payrollGroups);
  if(groupKeys.length===0){
    container.innerHTML = '<div class="empty-state">该公司暂无在职员工,请先在"员工资料"新增</div>';
    updateStats();
    return;
  }

  // 组的显示顺序固定,跟「员工资料」页面一致:本地-有Payslip → 本地-无Payslip → 尼泊尔 → 兼职 → 缅甸
  var GROUP_ORDER = ['本地员工 - 有 Payslip', '本地员工 - 无 Payslip', '尼泊尔员工', '兼职 Part-time (时薪)', '缅甸员工'];
  function groupRank(g){
    var idx = GROUP_ORDER.indexOf(g);
    return idx>-1 ? idx : GROUP_ORDER.length;
  }
  groupKeys.sort(function(a,b){ return groupRank(a)-groupRank(b); });

  var html = '';
  groupKeys.forEach(function(label){
    var gid = sanitizeId(label);
    var group = payrollGroups[label];
    var rows = group.rows;
    var notesDis = isAdmin() ? '' : 'disabled';
    var isOpen = !!payrollGroupOpen[gid];
    var summaryTotal = rows.reduce(function(s,r){ return s + computeNet(r, group.isHourly); }, 0);
    html += '<div style="margin-bottom:20px;">';
    html += '<details'+(isOpen?' open':'')+' ontoggle="payrollGroupOpen[\''+gid+'\']=this.open;">';
    html += '<summary style="cursor:pointer;font-size:13px;font-weight:600;margin:0 0 8px;">'+esc(label)+' <span style="color:var(--text-muted);font-weight:400;">('+rows.length+'人)</span>'
      + ' <span style="color:var(--text-secondary);font-weight:600;">· TOTAL <span id="summarytotal-'+gid+'">'+fmt(round2(summaryTotal))+'</span></span></summary>';
    if(group.isHourly){
      html += '<div class="pay-table-wrap"><table class="pay-table"><tr><th>姓名</th><th>时薪</th><th>时数</th><th>MC报销(自动)</th><th>预支/借支(自动)</th><th>备注</th><th>总薪水</th></tr>';
      rows.forEach(function(row, i){
        html += '<tr>'
          + '<td style="font-weight:500;white-space:nowrap;">'+esc(row.name)+'</td>'
          + '<td>'+numInput(gid,i,'hourlyRate',row.hourlyRate,60)+'</td>'
          + '<td>'+numInput(gid,i,'hours',row.hours,60)+'</td>'
          + '<td style="color:var(--success);white-space:nowrap;">'+(row.mcClaim>0?'+'+fmt(row.mcClaim):'-')+'</td>'
          + '<td style="color:var(--danger);white-space:nowrap;">'+(row.advance>0?'-'+fmt(row.advance):'-')+'</td>'
          + '<td><input type="text" class="notes-input" data-g="'+gid+'" data-i="'+i+'" data-f="notes" value="'+esc(row.notes)+'" onchange="updateCell(this)" '+notesDis+' /></td>'
          + '<td style="font-weight:600;white-space:nowrap;" id="net-'+gid+'-'+i+'">'+fmt(computeNet(row,true))+'</td>'
          + '</tr>';
      });
      html += renderHourlyTotalRow(gid, rows);
      html += '</table></div>';
    } else {
      var headers = ['姓名','底薪','津贴','PH天数','PH金额','OT小时','OT金额','团队奖金','佣金分成(月中已发)','服务费总分成TSC','花红','预支/借支(自动)','EPF/SOCSO/EIS','PCB','已扣佣金(自动)','无薪假扣款(自动)','其他调整(+/-)','犯错金额(仅记录,不影响薪水)','MC报销(自动)','备注','净工资'];
      html += '<div class="pay-table-wrap"><table class="pay-table"><tr>' + headers.map(function(h){ return '<th>'+h+'</th>'; }).join('') + '</tr>';
      rows.forEach(function(row, i){
        html += '<tr>'
          + '<td style="font-weight:500;white-space:nowrap;">'+esc(row.name)+'</td>'
          + '<td>'+numInput(gid,i,'basicSalary',row.basicSalary,80)+'</td>'
          + '<td>'+numInput(gid,i,'allowance',row.allowance)+'</td>'
          + '<td>'+numInput(gid,i,'phDays',row.phDays,55)+'</td>'
          + '<td style="color:var(--text-secondary);white-space:nowrap;" id="phamt-'+gid+'-'+i+'">'+fmt(phAmount(row))+'</td>'
          + '<td>'+(otManual(row)
              ? '<span style="color:var(--text-muted);">-</span>'
              : numInput(gid,i,'otHours',row.otHours,55)+(row.otDaysLogged>0?'<div style="font-size:11px;color:var(--accent);white-space:nowrap;">打卡记录:'+row.otDaysLogged+'天有OT</div>':''))+'</td>'
          + '<td>'+(otManual(row)
              ? numInput(gid,i,'otAmountOverride',row.otAmountOverride,70)
              : '<span style="color:var(--text-secondary);white-space:nowrap;" id="otamt-'+gid+'-'+i+'">'+fmt(otAmount(row))+'</span>')
            + (isAdmin() ? '<div><button type="button" class="secondary small" style="margin-top:4px;padding:2px 6px;font-size:10px;" onclick="toggleOtManual(\''+gid+'\','+i+')">'+(otManual(row)?'改回小时公式':'改手动金额')+'</button></div>' : '')
            + '</td>'
          + '<td>'+numInput(gid,i,'teamBonus',row.teamBonus)+'</td>'
          + '<td>'+numInput(gid,i,'commissionSharing',row.commissionSharing)+'</td>'
          + '<td style="font-weight:500;white-space:nowrap;" id="tsc-'+gid+'-'+i+'">'+fmt(tscAmount(row))+'</td>'
          + '<td>'+numInput(gid,i,'bonus',row.bonus)+'</td>'
          + '<td style="color:var(--danger);white-space:nowrap;">'+(row.advance>0?'-'+fmt(row.advance):'-')+'</td>'
          + '<td>'+numInput(gid,i,'epfSocso',row.epfSocso)+'</td>'
          + '<td>'+numInput(gid,i,'pcb',row.pcb)+'</td>'
          + '<td style="color:var(--danger);white-space:nowrap;" id="csback-'+gid+'-'+i+'">-'+fmt(row.commissionSharing)+'</td>'
          + '<td style="color:var(--danger);white-space:nowrap;">'+(row.unpaidDays>0?'-'+fmt(unpaidDeduction(row))+' ('+row.unpaidDays+'天)':'-')+'</td>'
          + '<td>'+numInput(gid,i,'otherAdjustment',row.otherAdjustment)+'</td>'
          + '<td>'+numInput(gid,i,'mistakeAmount',row.mistakeAmount)+'</td>'
          + '<td style="color:var(--success);white-space:nowrap;">'+(row.mcClaim>0?'+'+fmt(row.mcClaim):'-')+'</td>'
          + '<td><input type="text" class="notes-input" data-g="'+gid+'" data-i="'+i+'" data-f="notes" value="'+esc(row.notes)+'" onchange="updateCell(this)" '+notesDis+' /></td>'
          + '<td style="font-weight:600;white-space:nowrap;" id="net-'+gid+'-'+i+'">'+fmt(computeNet(row,false))+'</td>'
          + '</tr>';
      });
      html += renderMonthlyTotalRow(gid, rows);
      html += '</table></div>';
    }
    html += '</details>';
    html += '</div>';
  });
  container.innerHTML = html;
  updateStats();
}

function findGroupByGid(gid){
  return Object.keys(payrollGroups).find(function(label){ return sanitizeId(label)===gid; });
}

function updateCell(inp){
  if(!isAdmin()) return;
  var gid = inp.getAttribute('data-g');
  var i = Number(inp.getAttribute('data-i'));
  var f = inp.getAttribute('data-f');
  var label = findGroupByGid(gid);
  var group = payrollGroups[label];
  var row = group.rows[i];
  row[f] = f==='notes' ? inp.value : (Number(inp.value)||0);
  if(group.isHourly){
    var netEl = document.getElementById('net-'+gid+'-'+i); if(netEl) netEl.textContent = fmt(computeNet(row,true));
  } else {
    var phEl = document.getElementById('phamt-'+gid+'-'+i); if(phEl) phEl.textContent = fmt(phAmount(row));
    var otEl = document.getElementById('otamt-'+gid+'-'+i); if(otEl) otEl.textContent = fmt(otAmount(row));
    var tscEl = document.getElementById('tsc-'+gid+'-'+i); if(tscEl) tscEl.textContent = fmt(tscAmount(row));
    var csEl = document.getElementById('csback-'+gid+'-'+i); if(csEl) csEl.textContent = '-'+fmt(row.commissionSharing);
    var netEl2 = document.getElementById('net-'+gid+'-'+i); if(netEl2) netEl2.textContent = fmt(computeNet(row,false));
  }
  refreshGroupTotals(gid, group);
  updateStats();
}

function renderCashList(){
  var container = document.getElementById('cash-list');
  var byNationality = {};
  var order = [];
  var grandTotal = 0;
  Object.keys(payrollGroups).forEach(function(label){
    var group = payrollGroups[label];
    group.rows.forEach(function(row){
      var emp = employees.find(function(e){ return e.id===row.employeeId; });
      if(!emp || emp.paymentMethod!=='现金') return;
      var nat = emp.nationality || '其他';
      if(!byNationality[nat]){ byNationality[nat] = []; order.push(nat); }
      var net = computeNet(row, group.isHourly);
      byNationality[nat].push({ name: row.name, net: net });
      grandTotal += net;
    });
  });
  if(order.length===0){ container.innerHTML = ''; return; }
  var html = '<div class="card" style="border-color:var(--warning);background:var(--warning-light);">'
    + '<p style="font-size:15px;font-weight:600;margin:0 0 4px;">💵 本月现金准备清单</p>'
    + '<p style="font-size:12px;color:var(--text-secondary);margin:0 0 12px;">以下是用现金支付的员工,出粮前需要准备好这些现金</p>';
  order.forEach(function(nat){
    var rows = byNationality[nat];
    var subtotal = rows.reduce(function(s,r){ return s+r.net; }, 0);
    html += '<p style="font-size:13px;font-weight:600;margin:12px 0 6px;">'+esc(nat)+'员工现金 · 小计 '+fmt(subtotal)+'</p>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
    rows.forEach(function(r){
      html += '<tr><td style="padding:4px 0;border-bottom:1px solid var(--border);">'+esc(r.name)+'</td>'
        + '<td style="padding:4px 0;border-bottom:1px solid var(--border);text-align:right;font-weight:500;">'+fmt(r.net)+'</td></tr>';
    });
    html += '</table>';
  });
  html += '<p style="font-size:15px;font-weight:700;margin:14px 0 0;text-align:right;color:var(--warning);">现金总计:'+fmt(grandTotal)+'</p>';
  html += '</div>';
  container.innerHTML = html;
}

function updateStats(){
  renderCashList();
  var count = 0, total = 0, cost = 0, totalBank = 0, totalCash = 0;
  Object.keys(payrollGroups).forEach(function(label){
    var group = payrollGroups[label];
    group.rows.forEach(function(row){
      count++;
      var net = computeNet(row, group.isHourly);
      total += net;
      cost += totalCost(row, group.isHourly);
      var emp = employees.find(function(e){ return e.id===row.employeeId; });
      if(emp && emp.paymentMethod==='现金') totalCash += net; else totalBank += net;
    });
  });
  document.getElementById('stat-count').textContent = count;
  document.getElementById('stat-total').textContent = fmt(total);
  document.getElementById('stat-cost').textContent = fmt(cost);
  document.getElementById('stat-total-bank').textContent = fmt(totalBank);
  document.getElementById('stat-total-cash').textContent = fmt(totalCash);
}

async function savePayroll(){
  if(!isAdmin()) return;
  var company = document.getElementById('pay-company').value;
  var month = document.getElementById('pay-month').value;
  if(!month){ document.getElementById('pay-msg').textContent = '请选择月份'; return; }
  document.getElementById('pay-msg').textContent = '保存中…';

  var upserts = [];
  Object.keys(payrollGroups).forEach(function(label){
    var group = payrollGroups[label];
    group.rows.forEach(function(r){
      var o = { employeeId: r.employeeId, company: company, month: month, notes: r.notes||'' };
      if(group.isHourly){
        o.hours = r.hours; o.hourlyRate = r.hourlyRate; o.allowance = 0; o.phDays = 0; o.otHours = 0; o.teamBonus = 0; o.commissionSharing = 0; o.bonus = 0; o.epfSocso = 0; o.pcb = 0;
      } else {
        PAYROLL_FIELDS_MONTHLY.forEach(function(f){ o[f] = r[f]; });
        o.hours = 0;
      }
      upserts.push(objToRow(PAYROLL_FIELD_MAP, o));
    });
  });

  var { error } = await sb.from('payroll_records').upsert(upserts, { onConflict: 'employee_id,month' });
  if(error){ document.getElementById('pay-msg').textContent = '保存失败:' + error.message; return; }
  document.getElementById('pay-msg').textContent = '已保存 ' + new Date().toLocaleTimeString();
  setTimeout(function(){ document.getElementById('pay-msg').textContent=''; }, 2500);
}
var PAYROLL_FIELDS_MONTHLY = ['basicSalary','allowance','phDays','otHours','otAmountOverride','teamBonus','commissionSharing','bonus','otherAdjustment','mistakeAmount','epfSocso','pcb'];
