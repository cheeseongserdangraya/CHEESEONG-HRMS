# FIRSTONE HRMS — Supabase + Vercel 版

这是从 `FIRSTONE_HRMS.html`(单机 localStorage 版)改造成的多账号线上版本。纯静态网站(HTML/CSS/JS,没有打包步骤),数据存在 Supabase,部署在 Vercel。

只有 2 个登入账号:**admin**(Jolee,能看能改所有数据)和 **boss**(老板,只能看,不能改)。

---

## 一、建立 Supabase 项目

1. 去 [supabase.com](https://supabase.com) 注册/登入,New Project(免费方案即可),记住设定的数据库密码。
2. 项目建好后,左边选单 **SQL Editor** → New query,把这个仓库里的 [supabase/schema.sql](supabase/schema.sql) 整份贴上去,点 Run。
   - 这一步会建好 `profiles` 表 + 7 张业务表 + 所有权限规则(RLS)。
3. 左边选单 **Authentication → Users** → Add user,建 2 个账号:
   - 一个给你自己用(admin),例如 `jolee@yourdomain.com`,设一个密码
   - 一个给老板用(boss),例如 `boss@yourdomain.com`,设一个密码
   - 建好后点进每个用户,复制它的 **User UID**(一串 uuid)
4. 回到 **SQL Editor**,执行(把 UUID 换成上一步复制的):
   ```sql
   insert into public.profiles (id, role, display_name) values
     ('<admin 用户的 UUID>', 'admin', 'Jolee'),
     ('<boss 用户的 UUID>', 'boss', '老板');
   ```
5. 左边选单 **Project Settings → API**,记下两个值:
   - **Project URL**(例如 `https://xxxx.supabase.co`)
   - **anon public** key(一长串字符)

## 二、把 Project URL / anon key 填进代码

打开 [js/config.js](js/config.js),把两个占位值换成上一步记下的:

```js
window.SUPABASE_URL = 'https://xxxx.supabase.co';
window.SUPABASE_ANON_KEY = '你的 anon public key';
```

> 这个 anon key 本来就是设计给前端公开使用的(不是密钥),真正的权限管控是 schema.sql 里设的 RLS 规则,所以放心跟着代码一起上传到 GitHub。

## 三、（可选)搬迁旧数据

如果你手上有旧版 HTML 工具导出的备份 JSON:

1. 先本地打开这个新系统确认能正常登入(见下面「本地测试」)
2. 用 admin 账号登入后,打开 `migrate.html`
3. 选择备份 JSON 文件,确认员工数量对得上,点「开始搬迁」
4. **这个操作只做一次**,重复执行会把数据插入两遍。搬完之后可以不用管这个页面。

## 四、部署到 Vercel

这是纯静态网站,不需要 build 步骤:

1. 把这个文件夹推到一个 GitHub repo(新建一个空 repo,`git init` → `git add` → `git commit` → 推上去)
2. 去 [vercel.com](https://vercel.com) 用 GitHub 账号登入 → Add New Project → 选这个 repo
3. Framework Preset 选 **Other**(不需要 build command,不需要 output directory,原样部署静态文件即可)
4. Deploy,等个几十秒会给你一个 `xxx.vercel.app` 网址
5. 之后每次改代码、推到 GitHub,Vercel 会自动重新部署

## 五、本地测试(部署前先自己看一下)

这台电脑没有装 Node.js,不过是纯静态文件,用 Python 内建的小型服务器就能预览:

```bash
cd "这个文件夹"
python3 -m http.server 8080
```

然后浏览器打开 `http://localhost:8080`,应该会看到登入页。

## 六、日常使用

- **backup 数据**:定期去 Supabase 后台 **Table Editor**,选每张表右上角 Export → CSV,存一份到你的 Google Drive,这就是备份(跟以前"导出 JSON"的习惯类似)。
- **加薪水/改员工资料**:用 admin 账号登入,「员工资料」tab 里编辑
- **老板要看数据**:给老板 boss 账号的 email + 密码,他登入后所有 tab 都能看,但看不到新增/编辑/删除的按钮,输入框也是锁住的(不能改)

## 七、文件结构

```
index.html          登入页
app.html            主系统(六个 tab)
migrate.html        旧数据搬迁工具(只用一次)
css/style.css        样式(照搬旧版)
js/config.js          Supabase 连接设定(要填自己的值)
js/supabaseClient.js  登入检查 / 角色判断
js/utils.js            共用函数 + 数据库字段对照表
js/employees.js        员工资料模块
js/payroll.js           薪水计算模块
js/mcClaims.js          医药费报销模块
js/loans.js              借支记录模块
js/attendance.js        打卡比对模块(迟到/OT记录)
js/leave.js              请假管理模块
js/main.js               主入口(登入检查、载入数据、tab切换)
supabase/schema.sql     数据库结构 + 权限规则
```

## 八、还没做的功能(照原本说明文档,这次范围之外)

- 员工福利金"银行户口"功能
- 自动发 email 通知(如果之后要做,可以用 Supabase Edge Functions)
