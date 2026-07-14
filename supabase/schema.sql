-- FIRSTONE HRMS — Supabase schema
-- 在 Supabase 项目的 SQL Editor 里整份贴上执行一次即可。
-- 执行顺序:先建 profiles,再建 7 张业务表,最后设 RLS。

create extension if not exists pgcrypto;

-- ============================================================
-- 1. profiles(跟 auth.users 一对一,存 role)
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','boss')),
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- 判断当前登入用户角色的辅助函数(security definer 绕开 RLS 递归问题)
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_boss()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'boss'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 2. employees 员工资料
-- ============================================================
create table public.employees (
  id uuid primary key default gen_random_uuid(),
  nric text,
  ic_file_url text,
  name_en text not null,
  name_cn text,
  gender text,
  nationality text,
  email text,
  contact text,
  address text,
  company text,
  department text,
  position text,
  join_date date,
  employee_type text,               -- '正式员工' / '兼职'
  has_payslip text,                 -- '有Payslip' / '无Payslip'
  payment_method text,              -- '银行转账' / '现金'
  basic_salary numeric default 0,
  allowance numeric default 0,
  hourly_rate numeric default 0,
  annual_leave_override numeric,    -- 留空则按年资自动算
  emergency_name text,
  emergency_number text,
  emergency_rel text,
  bank_name text,
  account_holder text,
  bank_account_number text,
  kwsp_number text,
  pcb_number text,
  status text not null default '在职',  -- '在职' / '离职',离职不删除
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_employees_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

-- ============================================================
-- 3. payroll_records 月薪水记录(一行 = 一个员工某月的输入)
-- ============================================================
create table public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  month text not null,              -- 'YYYY-MM'
  allowance numeric default 0,
  ph_days numeric default 0,
  ot_hours numeric default 0,
  team_bonus numeric default 0,
  commission_sharing numeric default 0,
  bonus numeric default 0,
  epf_socso numeric default 0,
  pcb numeric default 0,
  hours numeric default 0,          -- 兼职员工时数
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, month)
);

create trigger trg_payroll_updated_at
  before update on public.payroll_records
  for each row execute function public.set_updated_at();

-- ============================================================
-- 4. mc_claims 医药费报销
-- ============================================================
create table public.mc_claims (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  date date not null,
  bill_amount numeric not null default 0,
  claim_amount numeric not null default 0,
  clinic text,
  receipt_url text,
  notes text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5. loan_records 借支/还款记录
-- ============================================================
create table public.loan_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  type text not null check (type in ('borrow','repay')),
  date date not null,
  amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_loan_updated_at
  before update on public.loan_records
  for each row execute function public.set_updated_at();

-- ============================================================
-- 6. attendance_late 迟到记录 / attendance_ot OT记录
-- ============================================================
create table public.attendance_late (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  date date not null,
  time text,                        -- 打卡时间文字,例如 "10.12AM"
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_late_updated_at
  before update on public.attendance_late
  for each row execute function public.set_updated_at();

create table public.attendance_ot (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  date date not null,
  time text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_ot_updated_at
  before update on public.attendance_ot
  for each row execute function public.set_updated_at();

-- ============================================================
-- 7. leave_records 请假记录
-- ============================================================
create table public.leave_records (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  company text,
  type text not null,               -- 年假/病假/丧假/紧急事假/产假/陪产假/无薪假/其他
  start_date date not null,
  end_date date,
  days numeric not null default 0,  -- 支持 0.5 半天
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_leave_updated_at
  before update on public.leave_records
  for each row execute function public.set_updated_at();

-- ============================================================
-- 8. leave_carry 年假结转记录
-- ============================================================
create table public.leave_carry (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  from_year text not null,
  to_year text not null,
  days numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (employee_id, to_year)
);

-- ============================================================
-- RLS:所有业务表一律 admin 全权限、boss 只读
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'employees','payroll_records','mc_claims','loan_records',
    'attendance_late','attendance_ot','leave_records','leave_carry'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('create policy "%1$s_select" on public.%1$s for select using (is_admin() or is_boss());', t);
    execute format('create policy "%1$s_insert" on public.%1$s for insert with check (is_admin());', t);
    execute format('create policy "%1$s_update" on public.%1$s for update using (is_admin()) with check (is_admin());', t);
    execute format('create policy "%1$s_delete" on public.%1$s for delete using (is_admin());', t);
  end loop;
end $$;

-- ============================================================
-- 建好之后手动做的事(Supabase 后台操作,SQL 做不到):
-- 1. Authentication → Users → 新增 2 个用户(admin 的 email + boss 的 email,各设一个密码)
-- 2. 记下这两个用户的 UUID(Users 列表点进去可以看到 id)
-- 3. 回到 SQL Editor 执行(把下面的 UUID 换成真的):
--
--    insert into public.profiles (id, role, display_name) values
--      ('<admin-user-uuid>', 'admin', 'Jolee'),
--      ('<boss-user-uuid>', 'boss', '老板');
-- ============================================================
