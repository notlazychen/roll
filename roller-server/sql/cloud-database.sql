-- ============================================================================
-- 随机小队 · 云服务数据库定义（归档副本）
-- ============================================================================
-- 目标环境 : 微信云服务应用 随机小队（applicationId = wbapp_p0sx1yZd07GTa43kL2wLYf）
-- 数据库   : PostgreSQL（平台托管）
-- 用途     : 这份文件是「已部署结构」的可读归档与重建脚本。云端环境是权威来源，
--            本文件与云端保持一致；换环境或重建时按下面的顺序整段执行即可。
--
-- 执行方式（用云数据库工具，一条一条来，工具单次只接受一条语句）：
--   mode = migrate   （建表 / 索引 / 函数 / RLS / GRANT 都走 migrate，它绕过 RLS）
--   mode = read      （只想核对结构时用）
--
-- ⚠ 顺序不能乱：
--   1) 先建表与索引
--   2) 再建辅助函数（策略里要用 roll_is_member，必须先在）
--   3) 再开 RLS 并建策略
--   4) 最后建业务函数并收回 anon 的执行权
--   另外：DROP POLICY 与 CREATE POLICY 不要并行下发，并行执行顺序不确定，
--   会出现策略刚建好就被 DROP 掉的情况（踩过一次）。
--
-- 设计要点
--   · 客户端对 5 张表只有 SELECT 权限，没有任何 INSERT/UPDATE/DELETE 策略。
--     所有写操作都必须走 SECURITY DEFINER 函数，函数内部逐条校验
--     登录态 / 成员资格 / 队长身份 / 当前阶段 / 人数上限。
--   · auth.uid() 返回 text（不是 uuid），所以所有 owner_id 列都是
--     TEXT NOT NULL DEFAULT auth.uid()。
--   · 表 GRANT 与行策略是两道独立的门，缺一道就会报形似「策略失效」的 42501。
--   · 不加外键：级联清理放在业务函数里显式做，避免删除顺序被约束反向限制。
-- ============================================================================


-- ============================================================================
-- 1. 表结构
-- ============================================================================

-- 小队（一次随机活动的容器）
CREATE TABLE IF NOT EXISTS public.roll_groups (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id         text        NOT NULL DEFAULT auth.uid(),  -- 队长的云账号 uid
  owner_name       text,                                      -- 队长昵称（冗余，改昵称时同步）
  code             text        NOT NULL,                      -- 6 位小队号，大厅按它搜索
  theme            text        NOT NULL,                      -- 主题，最多 10 字
  passcode         text,                                      -- 5 位数字口令，NULL 表示无口令
  stage            text        NOT NULL DEFAULT 'config',     -- config | preparing | rolling | result
  prep_deadline    timestamptz,                               -- 准备环节截止时间；NULL 表示不限时
  prep_started_at  timestamptz,
  result_option_id bigint,                                    -- 本轮抽中的备选项
  result_at        timestamptz,
  round_count      bigint      NOT NULL DEFAULT 0,            -- 开过几轮，用于强制重播动画
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 小队成员
CREATE TABLE IF NOT EXISTS public.roll_members (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   bigint      NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  owner_name text,
  ready      text        NOT NULL DEFAULT 'none',  -- none | confirm
  joined_at  timestamptz NOT NULL DEFAULT now()
);

-- 备选项（投票即权重）
CREATE TABLE IF NOT EXISTS public.roll_options (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   bigint      NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  owner_name text,
  title      text        NOT NULL,                  -- 最多 20 字
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 投票
CREATE TABLE IF NOT EXISTS public.roll_votes (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  group_id   bigint      NOT NULL,
  option_id  bigint      NOT NULL,
  owner_id   text        NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 站内通知（随机结果 / 准备通知 / 新成员 / 解散 / 中断）
CREATE TABLE IF NOT EXISTS public.roll_notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id    text        NOT NULL DEFAULT auth.uid(),  -- 收件人
  group_id    bigint,                                   -- 小队被解散后仍保留，故可为空
  group_theme text,
  type        text        NOT NULL,                     -- result | prepare | cancel | member | dissolved
  content     text        NOT NULL,
  is_read     boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);


-- ============================================================================
-- 2. 索引与唯一约束
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS roll_groups_code_key
  ON public.roll_groups (code);

-- 同一个人在同一小队只能有一条成员记录（重复加入靠它兜底）
CREATE UNIQUE INDEX IF NOT EXISTS roll_members_group_user_key
  ON public.roll_members (group_id, owner_id);

-- 同一小队内备选项不重名（函数里先查一次给出友好文案，这里是最后一道）
CREATE UNIQUE INDEX IF NOT EXISTS roll_options_group_title_key
  ON public.roll_options (group_id, title);

-- 一个人对同一个备选项只能投一票
CREATE UNIQUE INDEX IF NOT EXISTS roll_votes_option_user_key
  ON public.roll_votes (option_id, owner_id);

CREATE INDEX IF NOT EXISTS roll_votes_group_idx
  ON public.roll_votes (group_id);

-- 消息中心按人倒序翻页
CREATE INDEX IF NOT EXISTS roll_notifications_owner_idx
  ON public.roll_notifications (owner_id, created_at DESC);


-- ============================================================================
-- 3. 辅助函数
-- ============================================================================
-- 这两个函数是 RLS 的地基：成员制策略不能直接内联子查询查 roll_members，
-- 否则策略求值时会再次触发自身策略，造成无限递归。
-- 用 SECURITY DEFINER 把它提到策略之外，递归就断了。

CREATE OR REPLACE FUNCTION public.roll_is_member(p_group_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM roll_members
    WHERE group_id = p_group_id AND owner_id = auth.uid()
  )
$function$;

CREATE OR REPLACE FUNCTION public.roll_is_captain(p_group_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM roll_groups
    WHERE id = p_group_id AND owner_id = auth.uid()
  )
$function$;


-- ============================================================================
-- 4. 行级安全（RLS）
-- ============================================================================
-- 第一道门：表级 GRANT（下面第 5 节）。
-- 第二道门：行策略。这里只开 SELECT —— 写入一律没有策略，等于全部关闭。
-- 因此客户端连「改自己那一行」都做不到，只能调业务函数。

ALTER TABLE public.roll_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roll_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roll_options       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roll_votes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roll_notifications ENABLE ROW LEVEL SECURITY;

-- 小队：只有队内成员看得到
-- （大厅需要看到别人创建的小队，所以大厅走 roll_hall 函数，不走这张表的直查）
CREATE POLICY roll_groups_read_member ON public.roll_groups
  FOR SELECT TO authenticated
  USING (roll_is_member(id));

-- 成员名单：队内可见。大厅卡片上的人数走 roll_hall 函数里的子查询，不受这里影响。
CREATE POLICY roll_members_read_member ON public.roll_members
  FOR SELECT TO authenticated
  USING (roll_is_member(group_id));

CREATE POLICY roll_options_read_member ON public.roll_options
  FOR SELECT TO authenticated
  USING (roll_is_member(group_id));

CREATE POLICY roll_votes_read_member ON public.roll_votes
  FOR SELECT TO authenticated
  USING (roll_is_member(group_id));

-- 通知：只看自己的。这条不需要成员校验，收件人就是自己。
CREATE POLICY roll_notifications_read_own ON public.roll_notifications
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

-- 清理旧的策略定义（重建环境时用，正常情况不必执行）
-- DROP POLICY IF EXISTS roll_groups_read_member        ON public.roll_groups;
-- DROP POLICY IF EXISTS roll_members_read_member       ON public.roll_members;
-- DROP POLICY IF EXISTS roll_options_read_member       ON public.roll_options;
-- DROP POLICY IF EXISTS roll_votes_read_member         ON public.roll_votes;
-- DROP POLICY IF EXISTS roll_notifications_read_own    ON public.roll_notifications;


-- ============================================================================
-- 5. 表级授权（第一道门，漏了会得到 42501）
-- ============================================================================

GRANT SELECT ON public.roll_groups        TO authenticated, anon;
GRANT SELECT ON public.roll_members       TO authenticated, anon;
GRANT SELECT ON public.roll_options       TO authenticated, anon;
GRANT SELECT ON public.roll_votes         TO authenticated, anon;
GRANT SELECT ON public.roll_notifications TO authenticated, anon;

-- 平台建表时默认会把完整增删改查给到 authenticated，
-- 能挡住写的是「没有对应策略」这件事本身（RLS 第二道门），不是 GRANT。
-- 这里显式收回写权限，让两道门说同一句话，出问题时更容易定位。
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.roll_groups, public.roll_members, public.roll_options,
     public.roll_votes, public.roll_notifications
  FROM authenticated, anon;


-- ============================================================================
-- 6. 纯函数（无副作用，方便单测与复用）
-- ============================================================================

-- 加权随机：给定权重数组与一个 [0,1) 随机数，返回命中下标（从 0 开始）。
-- 全部权重为 0 时退化成等权，避免无解；返回 NULL 表示权重数组为空。
CREATE OR REPLACE FUNCTION public.roll_pick_index(
  p_weights double precision[],
  p_r01     double precision
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_n     integer;
  v_total double precision := 0;
  v_acc   double precision := 0;
  v_r     double precision;
  v_w     double precision;
  i       integer;
BEGIN
  IF p_weights IS NULL THEN
    RETURN NULL;
  END IF;
  v_n := COALESCE(array_length(p_weights, 1), 0);
  IF v_n = 0 THEN
    RETURN NULL;
  END IF;

  FOR i IN 1..v_n LOOP
    v_total := v_total + GREATEST(COALESCE(p_weights[i], 0), 0);
  END LOOP;

  -- 夹到 [0, 1) 内，避免随机数恰好取到 1 时越界
  v_r := LEAST(GREATEST(COALESCE(p_r01, 0), 0), 0.999999999999);

  -- 全部权重为 0：按等权分配
  IF v_total <= 0 THEN
    v_total := v_n;
    FOR i IN 1..v_n LOOP
      v_acc := v_acc + 1;
      IF v_r * v_total < v_acc THEN
        RETURN i - 1;
      END IF;
    END LOOP;
    RETURN v_n - 1;
  END IF;

  FOR i IN 1..v_n LOOP
    v_w := GREATEST(COALESCE(p_weights[i], 0), 0);
    v_acc := v_acc + v_w;
    IF v_r * v_total < v_acc THEN
      RETURN i - 1;
    END IF;
  END LOOP;

  RETURN v_n - 1;
END
$function$;

-- 阶段推进：准备环节 → 随机环节的判定规则（纯函数，便于单独验证）。
--   全员确认  → rolling
--   到达截止  → rolling
--   其它      → 留在 preparing
-- 非 preparing 阶段原样透传。
CREATE OR REPLACE FUNCTION public.roll_next_stage(
  p_stage        text,
  p_deadline     timestamp with time zone,
  p_member_count integer,
  p_confirmed    integer,
  p_now          timestamp with time zone
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE
    WHEN p_stage IS DISTINCT FROM 'preparing' THEN p_stage
    WHEN COALESCE(p_member_count, 0) > 0 AND COALESCE(p_confirmed, 0) >= p_member_count THEN 'rolling'
    WHEN p_deadline IS NOT NULL AND p_now >= p_deadline THEN 'rolling'
    ELSE 'preparing'
  END
$function$;


-- ============================================================================
-- 7. 业务函数
-- ============================================================================
-- 全部 SECURITY DEFINER（绕过 RLS，因此必须自己校验权限），统一返回 jsonb：
--   成功 { "ok": true, ... }
--   失败 { "ok": false, "error": "给用户看的中文文案" }
-- 建好后务必收回 anon 的执行权（平台建函数时默认会授给 anon）。

-- ---------------------------------------------------------------------------
-- 7.1 建队 / 改队 / 解散
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.roll_create_group(
  p_theme     text,
  p_passcode  text,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_theme text := btrim(COALESCE(p_theme, ''));
  v_pass  text := btrim(COALESCE(p_passcode, ''));
  v_name  text := btrim(COALESCE(p_user_name, ''));
  v_code  text;
  v_id    bigint;
  v_try   integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;
  IF v_theme = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '请填写小队主题');
  END IF;
  IF char_length(v_theme) > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队主题最多 10 个字');
  END IF;
  IF v_pass <> '' AND v_pass !~ '^[0-9]{5}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', '口令必须是 5 位数字');
  END IF;
  IF v_name = '' THEN
    v_name := '冒险者';
  END IF;

  -- 生成不重复的 6 位小队号
  LOOP
    v_try := v_try + 1;
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM roll_groups WHERE code = v_code);
    IF v_try > 40 THEN
      RETURN jsonb_build_object('ok', false, 'error', '邀请码生成失败，请重试');
    END IF;
  END LOOP;

  INSERT INTO roll_groups (owner_id, owner_name, code, theme, passcode)
  VALUES (v_uid, v_name, v_code, v_theme, NULLIF(v_pass, ''))
  RETURNING id INTO v_id;

  -- 建队人自动成为第一个成员（否则队长在成员列表里查不到自己）
  INSERT INTO roll_members (group_id, owner_id, owner_name)
  VALUES (v_id, v_uid, v_name);

  RETURN jsonb_build_object('ok', true, 'groupId', v_id, 'code', v_code);
END
$function$;

-- 改主题与改口令是两个独立开关：
--   p_theme 为 NULL 表示不改主题；p_change_passcode 为 true 才动口令。
--   口令传空串 = 取消口令（落库成 NULL）。
CREATE OR REPLACE FUNCTION public.roll_update_group(
  p_group_id         bigint,
  p_theme            text,
  p_passcode         text,
  p_change_passcode  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_theme text;
  v_pass  text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roll_groups WHERE id = p_group_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', '只有队长可以修改小队信息');
  END IF;

  IF p_theme IS NOT NULL THEN
    v_theme := btrim(p_theme);
    IF v_theme = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', '请填写小队主题');
    END IF;
    IF char_length(v_theme) > 10 THEN
      RETURN jsonb_build_object('ok', false, 'error', '小队主题最多 10 个字');
    END IF;
    UPDATE roll_groups SET theme = v_theme WHERE id = p_group_id;
  END IF;

  IF p_change_passcode THEN
    v_pass := btrim(COALESCE(p_passcode, ''));
    IF v_pass <> '' AND v_pass !~ '^[0-9]{5}$' THEN
      RETURN jsonb_build_object('ok', false, 'error', '口令必须是 5 位数字');
    END IF;
    UPDATE roll_groups SET passcode = NULLIF(v_pass, '') WHERE id = p_group_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_delete_group(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_theme text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT theme INTO v_theme FROM roll_groups WHERE id = p_group_id AND owner_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '只有队长可以解散小队');
  END IF;

  -- 先给其余成员各留一条通知（表里没外键，删完就查不到成员了）
  INSERT INTO roll_notifications (owner_id, group_id, group_theme, type, content)
  SELECT m.owner_id, p_group_id, v_theme, 'dissolved', '小队「' || v_theme || '」已被队长解散'
  FROM roll_members m
  WHERE m.group_id = p_group_id AND m.owner_id <> v_uid;

  DELETE FROM roll_votes   WHERE group_id = p_group_id;
  DELETE FROM roll_options WHERE group_id = p_group_id;
  DELETE FROM roll_members WHERE group_id = p_group_id;
  DELETE FROM roll_groups  WHERE id = p_group_id;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- ---------------------------------------------------------------------------
-- 7.2 大厅 / 进出小队
-- ---------------------------------------------------------------------------

-- 大厅：列出所有小队（含未加入的），带上「我是否已加入」。
-- 因为 roll_groups 的 SELECT 策略只放行队内成员，这里必须走 SECURITY DEFINER。
CREATE OR REPLACE FUNCTION public.roll_hall(p_keyword text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid();
  v_kw   text := btrim(COALESCE(p_keyword, ''));
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT COALESCE(jsonb_agg(x.row ORDER BY x.created_at DESC), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT g.created_at,
           jsonb_build_object(
             'id', g.id,
             'code', g.code,
             'theme', g.theme,
             'ownerId', g.owner_id,
             'ownerName', COALESCE(g.owner_name, '冒险者'),
             'owner', (g.owner_id = v_uid),
             'hasPasscode', (g.passcode IS NOT NULL),
             'stage', g.stage,
             'memberCount', (SELECT count(*) FROM roll_members m WHERE m.group_id = g.id),
             'joined', EXISTS (SELECT 1 FROM roll_members m WHERE m.group_id = g.id AND m.owner_id = v_uid),
             'createdAt', (extract(epoch from g.created_at) * 1000)::bigint
           ) AS row
    FROM roll_groups g
    WHERE v_kw = ''
       OR g.code = v_kw              -- 完整小队号精确命中
       OR g.theme ILIKE '%' || v_kw || '%'
  ) x;

  RETURN jsonb_build_object('ok', true, 'groups', v_rows);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_join(
  p_group_id  bigint,
  p_passcode  text,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_g     roll_groups;
  v_pass  text := btrim(COALESCE(p_passcode, ''));
  v_name  text := btrim(COALESCE(p_user_name, ''));
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  -- 已经在队里就当成功，避免重复点击报错
  IF EXISTS (SELECT 1 FROM roll_members WHERE group_id = p_group_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  IF v_g.passcode IS NOT NULL AND v_g.passcode <> v_pass THEN
    RETURN jsonb_build_object('ok', false, 'error', '口令不正确');
  END IF;

  -- 锁住小队行再数人数，防止并发加入挤破上限
  PERFORM 1 FROM roll_groups WHERE id = p_group_id FOR UPDATE;

  SELECT count(*) INTO v_count FROM roll_members WHERE group_id = p_group_id;
  IF v_count >= 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队人数已达上限 20 人');
  END IF;

  IF v_name = '' THEN
    v_name := '冒险者';
  END IF;

  INSERT INTO roll_members (group_id, owner_id, owner_name)
  VALUES (p_group_id, v_uid, v_name);

  INSERT INTO roll_notifications (owner_id, group_id, group_theme, type, content)
  VALUES (v_g.owner_id, p_group_id, v_g.theme, 'member', v_name || ' 加入了小队');

  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_leave(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
  v_g   roll_groups;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  IF v_g.owner_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', '队长不能退出，请直接解散小队');
  END IF;

  -- 退队要一并撤掉自己的票，否则会留下投给已不在队里的人的权重
  DELETE FROM roll_votes   WHERE group_id = p_group_id AND owner_id = v_uid;
  DELETE FROM roll_members WHERE group_id = p_group_id AND owner_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- ---------------------------------------------------------------------------
-- 7.3 备选项与投票
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.roll_add_option(
  p_group_id  bigint,
  p_title     text,
  p_user_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_g     roll_groups;
  v_title text := btrim(COALESCE(p_title, ''));
  v_name  text := btrim(COALESCE(p_user_name, ''));
  v_id    bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;
  IF v_title = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '请填写备选项内容');
  END IF;
  IF char_length(v_title) > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', '备选项最多 20 个字');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roll_members WHERE group_id = p_group_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先加入小队');
  END IF;

  -- 只有配置阶段能加；准备/随机/结果阶段一律锁定
  IF v_g.stage <> 'config' THEN
    RETURN jsonb_build_object('ok', false, 'error', '当前阶段不可添加备选项');
  END IF;

  IF EXISTS (SELECT 1 FROM roll_options WHERE group_id = p_group_id AND title = v_title) THEN
    RETURN jsonb_build_object('ok', false, 'error', '这个备选项已经有了');
  END IF;

  IF v_name = '' THEN
    v_name := '冒险者';
  END IF;

  INSERT INTO roll_options (group_id, owner_id, owner_name, title)
  VALUES (p_group_id, v_uid, v_name, v_title)
  RETURNING id INTO v_id;

  -- 关键：创建者自动投自己一票。
  -- 否则新备选项权重为 0，在加权随机里永远抽不中，看起来像「加了没用」。
  INSERT INTO roll_votes (group_id, option_id, owner_id)
  VALUES (p_group_id, v_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'optionId', v_id, 'autoVoted', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_delete_option(p_option_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_o     roll_options;
  v_stage text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_o FROM roll_options WHERE id = p_option_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '备选项不存在');
  END IF;

  SELECT stage INTO v_stage FROM roll_groups WHERE id = v_o.group_id;
  IF v_stage IS DISTINCT FROM 'config' THEN
    RETURN jsonb_build_object('ok', false, 'error', '当前阶段不可删除');
  END IF;

  IF v_o.owner_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', '只有创建者可以删除这个备选项');
  END IF;

  DELETE FROM roll_votes   WHERE option_id = p_option_id;
  DELETE FROM roll_options WHERE id = p_option_id;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- 投票开关：已投则撤，未投则投。返回 voted 表示操作后的状态。
CREATE OR REPLACE FUNCTION public.roll_toggle_vote(p_option_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   text := auth.uid();
  v_o     roll_options;
  v_stage text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_o FROM roll_options WHERE id = p_option_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '备选项不存在');
  END IF;

  SELECT stage INTO v_stage FROM roll_groups WHERE id = v_o.group_id;
  IF v_stage IS DISTINCT FROM 'config' THEN
    RETURN jsonb_build_object('ok', false, 'error', '准备环节中已锁定投票');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roll_members WHERE group_id = v_o.group_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先加入小队');
  END IF;

  IF EXISTS (SELECT 1 FROM roll_votes WHERE option_id = p_option_id AND owner_id = v_uid) THEN
    DELETE FROM roll_votes WHERE option_id = p_option_id AND owner_id = v_uid;
    RETURN jsonb_build_object('ok', true, 'voted', false);
  END IF;

  INSERT INTO roll_votes (group_id, option_id, owner_id)
  VALUES (v_o.group_id, p_option_id, v_uid);

  RETURN jsonb_build_object('ok', true, 'voted', true);
END
$function$;

-- ---------------------------------------------------------------------------
-- 7.4 准备环节
-- ---------------------------------------------------------------------------

-- p_seconds = 0 表示不限时（只能靠全员确认推进）
CREATE OR REPLACE FUNCTION public.roll_start_prepare(
  p_group_id bigint,
  p_seconds  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
  v_g   roll_groups;
  v_n   integer;
  v_sec integer := COALESCE(p_seconds, 0);
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  IF v_g.owner_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', '只有队长可以开启随机');
  END IF;

  IF v_g.stage <> 'config' THEN
    RETURN jsonb_build_object('ok', false, 'error', '当前阶段不可开启随机');
  END IF;

  SELECT count(*) INTO v_n FROM roll_options WHERE group_id = p_group_id;
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先添加备选项');
  END IF;

  IF v_sec < 0 THEN
    v_sec := 0;
  END IF;
  IF v_sec > 3600 THEN
    v_sec := 3600;
  END IF;

  UPDATE roll_groups
     SET stage = 'preparing',
         prep_started_at = now(),
         prep_deadline = CASE WHEN v_sec > 0 THEN now() + make_interval(secs => v_sec) ELSE NULL END,
         result_option_id = NULL,
         result_at = NULL
   WHERE id = p_group_id;

  UPDATE roll_members SET ready = 'none' WHERE group_id = p_group_id;

  INSERT INTO roll_notifications (owner_id, group_id, group_theme, type, content)
  SELECT m.owner_id, p_group_id, v_g.theme, 'prepare', '队长开启了随机，请确认准备完毕'
  FROM roll_members m
  WHERE m.group_id = p_group_id AND m.owner_id <> v_uid;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- p_action = 'confirm' 表示「我准备好了」；'cancel' 表示放弃本次（回到配置阶段）
CREATE OR REPLACE FUNCTION public.roll_set_ready(
  p_group_id bigint,
  p_action   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid();
  v_g    roll_groups;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  IF p_action NOT IN ('confirm', 'cancel') THEN
    RETURN jsonb_build_object('ok', false, 'error', '无效的操作');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  IF v_g.stage <> 'preparing' THEN
    RETURN jsonb_build_object('ok', false, 'error', '当前不在准备环节');
  END IF;

  SELECT COALESCE(owner_name, '冒险者') INTO v_name
  FROM roll_members
  WHERE group_id = p_group_id AND owner_id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先加入小队');
  END IF;

  IF p_action = 'cancel' THEN
    UPDATE roll_groups
       SET stage = 'config', prep_deadline = NULL, prep_started_at = NULL
     WHERE id = p_group_id;
    UPDATE roll_members SET ready = 'none' WHERE group_id = p_group_id;

    INSERT INTO roll_notifications (owner_id, group_id, group_theme, type, content)
    VALUES (v_g.owner_id, p_group_id, v_g.theme, 'cancel', v_name || ' 取消了本次准备，随机已中断');

    RETURN jsonb_build_object('ok', true, 'cancelled', true);
  END IF;

  UPDATE roll_members SET ready = 'confirm'
   WHERE group_id = p_group_id AND owner_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'cancelled', false);
END
$function$;

-- 回到配置阶段，清掉本轮结果与全部准备状态
CREATE OR REPLACE FUNCTION public.roll_back_to_config(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM roll_groups WHERE id = p_group_id AND owner_id = v_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', '只有队长可以操作');
  END IF;

  UPDATE roll_groups
     SET stage = 'config',
         prep_deadline = NULL,
         prep_started_at = NULL,
         result_option_id = NULL,
         result_at = NULL
   WHERE id = p_group_id;

  UPDATE roll_members SET ready = 'none' WHERE group_id = p_group_id;

  RETURN jsonb_build_object('ok', true);
END
$function$;

-- ---------------------------------------------------------------------------
-- 7.5 核心枢纽：快照 + 阶段推进 + 抽取（小队页每秒轮询它）
-- ---------------------------------------------------------------------------
-- 一次调用完成四件事，所以客户端轮询只需要 1 个请求：
--   1) 按 roll_next_stage 推进阶段（全员确认 / 到点）
--   2) 若进入 rolling：加权抽取 → 写结果 → 给全体成员广播通知 → 重置 ready
--   3) 重置本轮准备标记
--   4) 返回完整快照（小队 / 成员 / 备选项 / 权重 / 我的身份）
-- 一轮只出一个结果，靠 UPDATE ... AND result_option_id IS NULL 的
-- 「只有我改到了才发通知」来保证（并发轮询时不会重复抽）。

CREATE OR REPLACE FUNCTION public.roll_sync(p_group_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid        text := auth.uid();
  v_g          roll_groups;
  v_stage      text;
  v_total      integer := 0;
  v_confirmed  integer := 0;
  v_members    jsonb;
  v_options    jsonb;
  v_weights    jsonb;
  v_ids        bigint[];
  v_ws         double precision[];
  v_idx        integer;
  v_picked     bigint;
  v_sum        double precision := 0;
  v_is_member  boolean;
  v_is_captain boolean;
  v_marked     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', '小队不存在或已被解散');
  END IF;

  SELECT count(*), count(*) FILTER (WHERE ready = 'confirm')
    INTO v_total, v_confirmed
  FROM roll_members WHERE group_id = p_group_id;

  v_stage := roll_next_stage(v_g.stage, v_g.prep_deadline, v_total, v_confirmed, now());

  IF v_stage = 'rolling' AND v_g.stage = 'preparing' THEN
    UPDATE roll_groups SET stage = 'rolling'
     WHERE id = p_group_id AND stage = 'preparing';
    v_g.stage := 'rolling';
    v_marked := true;
  END IF;

  IF v_g.stage = 'rolling' THEN
    -- 拉出备选项 id 与其得票数（得票数就是权重）
    SELECT array_agg(t.id ORDER BY t.id), array_agg(t.cnt::double precision ORDER BY t.id)
      INTO v_ids, v_ws
    FROM (
      SELECT o.id, COALESCE(w.cnt, 0) AS cnt
      FROM roll_options o
      LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM roll_votes v WHERE v.option_id = o.id) w ON true
      WHERE o.group_id = p_group_id
    ) t;

    v_picked := NULL;
    IF v_ids IS NOT NULL AND array_length(v_ids, 1) > 0 THEN
      v_idx := roll_pick_index(v_ws, random());
      IF v_idx IS NOT NULL THEN
        v_picked := v_ids[v_idx + 1];  -- 数组下标从 1 开始
      END IF;
    END IF;

    UPDATE roll_groups
       SET stage = 'result',
           result_option_id = v_picked,
           result_at = now(),
           round_count = round_count + 1
     WHERE id = p_group_id AND stage = 'rolling' AND result_option_id IS NULL;

    -- 只有真正改到本行的那一次调用才广播，避免多人同时轮询时重复通知
    IF FOUND THEN
      INSERT INTO roll_notifications (owner_id, group_id, group_theme, type, content)
      SELECT m.owner_id, p_group_id, v_g.theme, 'result',
             COALESCE((SELECT o.title FROM roll_options o WHERE o.id = v_picked), '（无备选项）')
      FROM roll_members m WHERE m.group_id = p_group_id;
    END IF;

    SELECT * INTO v_g FROM roll_groups WHERE id = p_group_id;
  END IF;

  IF v_marked THEN
    UPDATE roll_members SET ready = 'none' WHERE group_id = p_group_id AND ready <> 'none';
  END IF;

  v_is_member  := EXISTS (
    SELECT 1 FROM roll_members WHERE group_id = p_group_id AND owner_id = v_uid
  );
  v_is_captain := (v_g.owner_id = v_uid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id,
           'uid', m.owner_id,
           'name', COALESCE(m.owner_name, '冒险者'),
           'ready', m.ready,
           'joinedAt', (extract(epoch from m.joined_at) * 1000)::bigint
         ) ORDER BY m.id), '[]'::jsonb)
    INTO v_members
  FROM roll_members m WHERE m.group_id = p_group_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', o.id,
           'title', o.title,
           'creatorId', o.owner_id,
           'creatorName', COALESCE(o.owner_name, '冒险者'),
           'createdAt', (extract(epoch from o.created_at) * 1000)::bigint,
           'voteCount', COALESCE(w.cnt, 0),
           'voters', COALESCE(w.voters, '[]'::jsonb)
         ) ORDER BY o.id), '[]'::jsonb)
    INTO v_options
  FROM roll_options o
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt, jsonb_agg(v.owner_id) AS voters
    FROM roll_votes v WHERE v.option_id = o.id
  ) w ON true
  WHERE o.group_id = p_group_id;

  SELECT COALESCE(sum(t.cnt), 0) INTO v_sum
  FROM (
    SELECT COALESCE(w.cnt, 0) AS cnt
    FROM roll_options o
    LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM roll_votes v WHERE v.option_id = o.id) w ON true
    WHERE o.group_id = p_group_id
  ) t;

  -- 权重表：得票数即权重；票数全为 0 时页面按等权画盘，所以 percent 退化成 1/n
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'optionId', t.id,
           'title', t.title,
           'votes', t.cnt,
           'weight', t.cnt,
           'percent', CASE WHEN v_sum > 0
                        THEN (t.cnt::double precision / v_sum)
                        ELSE (1.0 / t.n) END,
           'colorIndex', t.rn - 1
         ) ORDER BY t.rn), '[]'::jsonb)
    INTO v_weights
  FROM (
    SELECT o.id, o.title, COALESCE(w.cnt, 0) AS cnt,
           row_number() OVER (ORDER BY o.id) AS rn,
           count(*) OVER () AS n
    FROM roll_options o
    LEFT JOIN LATERAL (SELECT count(*) AS cnt FROM roll_votes v WHERE v.option_id = o.id) w ON true
    WHERE o.group_id = p_group_id
  ) t;

  RETURN jsonb_build_object(
    'ok', true,
    'group', jsonb_build_object(
      'id', v_g.id,
      'code', v_g.code,
      'theme', v_g.theme,
      -- 非成员不下发口令，防止「先进去退出再改口令」之类的越权读取
      'passcode', CASE WHEN v_is_member THEN v_g.passcode ELSE NULL END,
      'ownerId', v_g.owner_id,
      'ownerName', COALESCE(v_g.owner_name, '冒险者'),
      'stage', v_g.stage,
      'prepDeadline', CASE WHEN v_g.prep_deadline IS NULL THEN NULL
                          ELSE (extract(epoch from v_g.prep_deadline) * 1000)::bigint END,
      'prepStartedAt', CASE WHEN v_g.prep_started_at IS NULL THEN NULL
                           ELSE (extract(epoch from v_g.prep_started_at) * 1000)::bigint END,
      'resultOptionId', v_g.result_option_id,
      'resultAt', CASE WHEN v_g.result_at IS NULL THEN NULL
                      ELSE (extract(epoch from v_g.result_at) * 1000)::bigint END,
      'round', v_g.round_count,
      'createdAt', (extract(epoch from v_g.created_at) * 1000)::bigint,
      'memberCount', v_total,
      'hasPasscode', (v_g.passcode IS NOT NULL)
    ),
    'members', v_members,
    'options', v_options,
    'weights', jsonb_build_object(
      'items', v_weights,
      'totalVotes', v_sum::integer,
      'uniform', (v_sum <= 0)
    ),
    'isMember', v_is_member,
    'isLeader', v_is_captain,
    'me', jsonb_build_object('uid', v_uid)
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 7.6 昵称 / 信息中心 / 统计
-- ---------------------------------------------------------------------------

-- 改昵称要把三张表里的冗余名字一起刷掉，否则老小队里还是旧名
CREATE OR REPLACE FUNCTION public.roll_set_nickname(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  text := auth.uid();
  v_name text := btrim(COALESCE(p_name, ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', '昵称不能为空');
  END IF;
  IF char_length(v_name) > 12 THEN
    RETURN jsonb_build_object('ok', false, 'error', '昵称最多 12 个字');
  END IF;

  UPDATE roll_members SET owner_name = v_name WHERE owner_id = v_uid;
  UPDATE roll_options SET owner_name = v_name WHERE owner_id = v_uid;
  UPDATE roll_groups  SET owner_name = v_name WHERE owner_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'name', v_name);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_mark_notifications_read()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  UPDATE roll_notifications SET is_read = true
   WHERE owner_id = v_uid AND is_read = false;

  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_clear_notifications()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid text := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  DELETE FROM roll_notifications WHERE owner_id = v_uid;

  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.roll_my_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    text := auth.uid();
  v_joined integer;
  v_owned  integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', '请先登录');
  END IF;

  SELECT count(*) INTO v_joined FROM roll_members WHERE owner_id = v_uid;
  SELECT count(*) INTO v_owned  FROM roll_groups  WHERE owner_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'joinedCount', v_joined, 'ownedCount', v_owned);
END
$function$;


-- ============================================================================
-- 8. 函数执行权
-- ============================================================================
-- 平台建函数时默认会连 anon 一起授予 EXECUTE。业务函数必须收回：
-- 匿名调用虽然会撞上函数内部的 auth.uid() IS NULL 检查，但那是兜底，
-- 不该把可达面留在那里。roll_pick_index / roll_next_stage 是纯计算、
-- 不读写任何数据，保留公开执行权没有风险。

REVOKE EXECUTE ON FUNCTION public.roll_create_group(text, text, text)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_hall(text)                                                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_sync(bigint)                                                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_update_group(bigint, text, text, boolean)                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_join(bigint, text, text)                                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_leave(bigint)                                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_delete_group(bigint)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_add_option(bigint, text, text)                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_delete_option(bigint)                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_toggle_vote(bigint)                                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_start_prepare(bigint, integer)                                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_set_ready(bigint, text)                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_back_to_config(bigint)                                            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_set_nickname(text)                                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_mark_notifications_read()                                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_clear_notifications()                                             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_my_stats()                                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_is_member(bigint)                                                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.roll_is_captain(bigint)                                                FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.roll_create_group(text, text, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_hall(text)                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_sync(bigint)                                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_update_group(bigint, text, text, boolean)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_join(bigint, text, text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_leave(bigint)                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_delete_group(bigint)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_add_option(bigint, text, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_delete_option(bigint)                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_toggle_vote(bigint)                                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_start_prepare(bigint, integer)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_set_ready(bigint, text)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_back_to_config(bigint)                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_set_nickname(text)                                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_mark_notifications_read()                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_clear_notifications()                                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_my_stats()                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_is_member(bigint)                                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.roll_is_captain(bigint)                                          TO authenticated;


-- ============================================================================
-- 9. 核对清单（改完跑一遍，确认结构与预期一致）
-- ============================================================================
-- 表：应返回 5 行，relrowsecurity 全为 true
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname LIKE 'roll_%' AND relkind = 'r' ORDER BY relname;
--
-- 策略：应返回 5 行，全部是 SELECT
--   SELECT tablename, policyname, cmd, qual FROM pg_policies
--    WHERE tablename LIKE 'roll_%' ORDER BY tablename;
--
-- 函数：21 个（2 辅助 + 2 纯函数 + 17 业务）
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'roll_%';
--
-- anon 执行权：业务函数应为 0 行；纯函数允许存在
--   SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname LIKE 'roll_%'
--      AND p.proacl::text LIKE '%anon=X%' ORDER BY p.proname;
-- ============================================================================
