// 需要先在 HTML 里用 <script src="https://unpkg.com/@supabase/supabase-js@2"></script> 载入 SDK,
// 再载入 config.js,最后载入这个文件。

var sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

// 目前登入用户的 profile(role / display_name),由 requireAuth() 填好
var currentProfile = null;

async function requireAuth(){
  var { data: { session } } = await sb.auth.getSession();
  if(!session){
    window.location.href = 'index.html';
    return null;
  }
  var { data: profile, error } = await sb
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', session.user.id)
    .single();
  if(error || !profile){
    // 登入成功但还没建 profile 记录,视同无权限
    await sb.auth.signOut();
    window.location.href = 'index.html?err=noprofile';
    return null;
  }
  currentProfile = profile;
  return profile;
}

function isAdmin(){ return !!currentProfile && currentProfile.role === 'admin'; }

async function signOut(){
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

// 统一错误提示:把 Supabase 返回的 error 显示在指定的 msg 元素上
function showErr(elId, error, fallback){
  var el = document.getElementById(elId);
  if(!el) return;
  el.textContent = error ? (error.message || fallback || '发生错误') : '';
}
