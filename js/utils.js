// 共用工具函数 + 各表 camelCase(前端用) <-> snake_case(数据库字段)对照表

function fmt(n){ n = Number(n)||0; return 'RM' + n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function round2(n){ return Math.round((Number(n)||0)*100)/100; }
function esc(s){ return (s||'').toString().replace(/</g,'&lt;'); }
function sanitizeId(s){
  var out = '';
  for(var i=0;i<s.length;i++){
    var c = s.charCodeAt(i);
    out += /[a-zA-Z0-9]/.test(s[i]) ? s[i] : ('c'+c);
  }
  return out;
}
function todayStr(){ return new Date().toISOString().slice(0,10); }

// 用 FIELD_MAP(camelKey -> db_column)在 row(db) 和 obj(前端) 之间转换
function rowToObj(map, row){
  var o = { id: row.id };
  Object.keys(map).forEach(function(k){ o[k] = row[map[k]]; });
  return o;
}
function objToRow(map, obj){
  var row = {};
  Object.keys(map).forEach(function(k){
    if(obj[k]!==undefined) row[map[k]] = obj[k];
  });
  return row;
}

var EMP_FIELD_MAP = {
  nric:'nric', icFile:'ic_file_url', nameEn:'name_en', nameCn:'name_cn',
  gender:'gender', nationality:'nationality', email:'email', contact:'contact',
  address:'address', company:'company', department:'department', position:'position',
  joinDate:'join_date', employeeType:'employee_type', hasPayslip:'has_payslip', paymentMethod:'payment_method',
  basicSalary:'basic_salary', allowance:'allowance', hourlyRate:'hourly_rate', annualLeave:'annual_leave_override',
  emergencyName:'emergency_name', emergencyNumber:'emergency_number', emergencyRel:'emergency_rel',
  bankName:'bank_name', accountHolder:'account_holder', bankAccountNumber:'bank_account_number',
  kwspNumber:'kwsp_number', pcbNumber:'pcb_number', status:'status', noBenefits:'no_benefits'
};

var PAYROLL_FIELD_MAP = {
  employeeId:'employee_id', company:'company', month:'month', basicSalary:'basic_salary',
  allowance:'allowance', phDays:'ph_days', otHours:'ot_hours',
  teamBonus:'team_bonus', commissionSharing:'commission_sharing', bonus:'bonus',
  epfSocso:'epf_socso', pcb:'pcb', hours:'hours', notes:'notes'
};

var MC_FIELD_MAP = {
  employeeId:'employee_id', company:'company', date:'date',
  billAmount:'bill_amount', claimAmount:'claim_amount', clinic:'clinic',
  receipt:'receipt_url', notes:'notes'
};

var LOAN_FIELD_MAP = {
  employeeId:'employee_id', company:'company', type:'type', date:'date', amount:'amount', notes:'notes'
};

var ATT_FIELD_MAP = {
  employeeId:'employee_id', company:'company', date:'date', time:'time', notes:'notes'
};

var LEAVE_FIELD_MAP = {
  employeeId:'employee_id', company:'company', type:'type',
  start:'start_date', end:'end_date', days:'days', notes:'notes'
};

var CARRY_FIELD_MAP = {
  employeeId:'employee_id', fromYear:'from_year', toYear:'to_year', days:'days'
};

var PH_FIELD_MAP = {
  employeeId:'employee_id', company:'company', batchMonth:'batch_month',
  description:'description', days:'days', choice:'choice'
};

// boss 账号:隐藏/停用所有新增/编辑/删除相关的表单与按钮
function applyRoleUI(){
  document.getElementById('user-name').textContent = currentProfile.display_name || currentProfile.role;
  var badge = document.getElementById('user-role-badge');
  badge.textContent = currentProfile.role === 'admin' ? '管理员 Admin' : '老板 Boss (只读)';
  badge.className = 'badge ' + (currentProfile.role==='admin' ? 'role-admin' : 'role-boss');

  if(isAdmin()) return;

  document.getElementById('boss-hint').style.display = 'block';
  ['emp-form-card','mc-form-card','loan-form-card','late-form-card','ot-form-card','leave-form-card','carry-card','ph-form-card']
    .forEach(function(id){ var el = document.getElementById(id); if(el) el.style.display = 'none'; });
  var payBtn = document.getElementById('btn-pay-save');
  if(payBtn) payBtn.style.display = 'none';
}
