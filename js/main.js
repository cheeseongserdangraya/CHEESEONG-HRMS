// 主入口:登入检查、加载所有数据、tab 切换

function switchTab(tab){
  document.getElementById('panel-emp').style.display = tab==='emp' ? 'block' : 'none';
  document.getElementById('panel-pay').style.display = tab==='pay' ? 'block' : 'none';
  document.getElementById('panel-mc').style.display = tab==='mc' ? 'block' : 'none';
  document.getElementById('panel-loan').style.display = tab==='loan' ? 'block' : 'none';
  document.getElementById('panel-att').style.display = tab==='att' ? 'block' : 'none';
  document.getElementById('panel-leave').style.display = tab==='leave' ? 'block' : 'none';
  document.getElementById('panel-ph').style.display = tab==='ph' ? 'block' : 'none';
  document.getElementById('tab-emp').classList.toggle('active', tab==='emp');
  document.getElementById('tab-pay').classList.toggle('active', tab==='pay');
  document.getElementById('tab-mc').classList.toggle('active', tab==='mc');
  document.getElementById('tab-loan').classList.toggle('active', tab==='loan');
  document.getElementById('tab-att').classList.toggle('active', tab==='att');
  document.getElementById('tab-leave').classList.toggle('active', tab==='leave');
  document.getElementById('tab-ph').classList.toggle('active', tab==='ph');
  if(tab==='emp') renderEmpList();
  if(tab==='pay') loadPayroll();
  if(tab==='mc'){ populateMcEmployeeSelect(); renderMcList(); }
  if(tab==='loan'){ populateLoanEmployeeSelect(); renderLoanList(); }
  if(tab==='att'){ populateLateEmployeeSelect(); renderLateList(); populateOtEmployeeSelect(); renderOtList(); }
  if(tab==='leave'){ populateLeaveEmployeeSelect(); renderLeaveList(); renderLeaveOverview(); renderCarryList(); }
  if(tab==='ph'){ renderPhChecklist(); renderPhSelectedTable(); renderPhHistory(); }
}

(async function init(){
  var profile = await requireAuth();
  if(!profile) return; // requireAuth 已经处理跳转

  applyRoleUI();

  var now = new Date();
  document.getElementById('pay-month').value = now.toISOString().slice(0,7);
  document.getElementById('mc-date').value = now.toISOString().slice(0,10);
  document.getElementById('loan-date').value = now.toISOString().slice(0,10);
  document.getElementById('late-date').value = now.toISOString().slice(0,10);
  document.getElementById('ot-date').value = now.toISOString().slice(0,10);
  document.getElementById('leave-start').value = now.toISOString().slice(0,10);
  document.getElementById('leave-end').value = now.toISOString().slice(0,10);
  document.getElementById('carry-year').value = now.getFullYear();
  document.getElementById('ph-batch-month').value = now.toISOString().slice(0,7);

  // 一次性载入所有表(公司规模小,全部载入内存跟原本 localStorage 版行为一致)
  await Promise.all([
    fetchEmployees(),
    fetchMcClaims(),
    fetchLoanRecords(),
    fetchAttendanceRecords(),
    fetchLeaveRecords(),
    fetchPhRecords()
  ]);

  renderEmpList();
})();
