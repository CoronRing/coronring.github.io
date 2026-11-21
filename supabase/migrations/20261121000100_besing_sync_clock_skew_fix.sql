-- Use server-assigned `synced_at` for delta pull watermarks on `besing_sync_history`
-- so minor clock skew between iPhone, iPad, Windows PC, and Postgres can never cause
-- duplicate delta pulls or missed history items.

alter table public.besing_sync_history
    add column if not exists synced_at timestamptz not null default now();

create index if not exists idx_besing_sync_history_space_synced
    on public.besing_sync_history (space_hash, synced_at desc);

create or replace function public.besing_sync_push(
    p_secret  text,
    p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space         public.besing_sync_spaces;
    v_now           timestamptz := now();
    v_instance_id   text;
    v_device_name   text;
    v_browser       text;
    v_platform      text;
    v_mode          text;
    v_account_label text;
    v_device_exists boolean;
    v_device_count  integer;
    v_tabs          jsonb;
    v_groups        jsonb;
    v_closed        jsonb;
    v_snapshot_hash text;
    v_has_snapshot  boolean := false;
    v_hist_item     jsonb;
    v_url           text;
    v_host          text;
    v_title         text;
    v_visited_at    timestamptz;
    v_bucket        bigint;
    v_hist_count    integer := 0;
    v_usage_item    jsonb;
    v_day           date;
    v_seconds       integer;
    v_visits        integer;
    v_usage_count   integer := 0;
    v_pruned_hist   integer := 0;
    v_pruned_usage  integer := 0;
begin
    v_space := public._besing_sync_auth(p_secret);

    if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
        raise exception 'invalid payload' using errcode = '22023';
    end if;

    if octet_length(p_payload::text) > 262144 then
        raise exception 'payload too large' using errcode = '22023';
    end if;

    v_instance_id := left(btrim(coalesce(p_payload ->> 'instance_id', '')), 80);
    if char_length(v_instance_id) < 4 then
        raise exception 'invalid instance_id' using errcode = '22023';
    end if;

    v_device_name   := left(coalesce(nullif(btrim(p_payload ->> 'device_name'), ''), 'Device'), 80);
    v_browser       := left(lower(coalesce(nullif(btrim(p_payload ->> 'browser'), ''), 'unknown')), 32);
    v_platform      := left(lower(coalesce(nullif(btrim(p_payload ->> 'platform'), ''), 'unknown')), 32);
    v_mode          := case when (p_payload ->> 'mode') = 'extension' then 'extension' else 'userscript' end;
    v_account_label := left(btrim(coalesce(p_payload ->> 'account_label', '')), 120);

    select exists(
        select 1 from public.besing_sync_devices
        where space_hash = v_space.space_hash and instance_id = v_instance_id
    ) into v_device_exists;

    if not v_device_exists then
        select count(*) into v_device_count
        from public.besing_sync_devices
        where space_hash = v_space.space_hash;

        if v_device_count >= v_space.max_devices then
            raise exception 'device limit reached' using errcode = '54000';
        end if;
    end if;

    if p_payload ? 'tabs' or p_payload ? 'groups' or p_payload ? 'closed' then
        v_has_snapshot := true;

        if p_payload ? 'tabs' and jsonb_typeof(p_payload -> 'tabs') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_tabs
            from (
                select jsonb_build_object(
                    'id', left(coalesce(t ->> 'id', ''), 64),
                    'url', public._besing_clean_url(t ->> 'url'),
                    'title', left(coalesce(t ->> 'title', ''), 200),
                    'groupId', coalesce(t ->> 'groupId', ''),
                    'windowId', coalesce(t ->> 'windowId', ''),
                    'active', coalesce((t ->> 'active')::boolean, false),
                    'pinned', coalesce((t ->> 'pinned')::boolean, false),
                    'lastActiveAt', coalesce(t ->> 'lastActiveAt', '')
                ) as elem
                from jsonb_array_elements(p_payload -> 'tabs') with ordinality as arr(t, ord)
                where ord <= 200
                  and public._besing_clean_url(t ->> 'url') is not null
            ) sub;
        end if;

        if p_payload ? 'groups' and jsonb_typeof(p_payload -> 'groups') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_groups
            from (
                select jsonb_build_object(
                    'id', left(coalesce(g ->> 'id', ''), 64),
                    'windowId', left(coalesce(g ->> 'windowId', ''), 64),
                    'title', left(coalesce(g ->> 'title', ''), 120),
                    'color', left(coalesce(g ->> 'color', 'grey'), 24),
                    'collapsed', coalesce((g ->> 'collapsed')::boolean, false)
                ) as elem
                from jsonb_array_elements(p_payload -> 'groups') with ordinality as arr(g, ord)
                where ord <= 50
            ) sub;
        end if;

        if p_payload ? 'closed' and jsonb_typeof(p_payload -> 'closed') = 'array' then
            select coalesce(jsonb_agg(elem), '[]'::jsonb) into v_closed
            from (
                select jsonb_build_object(
                    'url', public._besing_clean_url(c ->> 'url'),
                    'title', left(coalesce(c ->> 'title', ''), 200),
                    'closedAt', left(coalesce(c ->> 'closedAt', ''), 40)
                ) as elem
                from jsonb_array_elements(p_payload -> 'closed') with ordinality as arr(c, ord)
                where ord <= 50
                  and public._besing_clean_url(c ->> 'url') is not null
            ) sub;
        end if;
    end if;

    if not v_device_exists then
        v_tabs   := coalesce(v_tabs, '[]'::jsonb);
        v_groups := coalesce(v_groups, '[]'::jsonb);
        v_closed := coalesce(v_closed, '[]'::jsonb);
        v_snapshot_hash := encode(extensions.digest(
            convert_to(v_device_name || '|' || v_browser || '|' || v_account_label || '|' || v_tabs::text || '|' || v_groups::text || '|' || v_closed::text, 'utf8'),
            'sha256'
        ), 'hex');

        insert into public.besing_sync_devices (
            space_hash, instance_id, device_name, browser, platform, mode, account_label,
            tabs_json, groups_json, closed_json, snapshot_hash, updated_at
        ) values (
            v_space.space_hash, v_instance_id, v_device_name, v_browser, v_platform, v_mode, v_account_label,
            v_tabs, v_groups, v_closed, v_snapshot_hash, v_now
        );
    elsif v_has_snapshot then
        update public.besing_sync_devices d
        set device_name   = v_device_name,
            browser       = v_browser,
            platform      = v_platform,
            mode          = v_mode,
            account_label = v_account_label,
            tabs_json     = coalesce(v_tabs, d.tabs_json),
            groups_json   = coalesce(v_groups, d.groups_json),
            closed_json   = coalesce(v_closed, d.closed_json),
            snapshot_hash = encode(extensions.digest(
                convert_to(
                    v_device_name || '|' || v_browser || '|' || v_account_label || '|' ||
                    coalesce(v_tabs, d.tabs_json)::text || '|' ||
                    coalesce(v_groups, d.groups_json)::text || '|' ||
                    coalesce(v_closed, d.closed_json)::text,
                    'utf8'
                ),
                'sha256'
            ), 'hex'),
            updated_at    = v_now
        where d.space_hash = v_space.space_hash and d.instance_id = v_instance_id;
    else
        update public.besing_sync_devices d
        set device_name   = v_device_name,
            browser       = v_browser,
            platform      = v_platform,
            mode          = v_mode,
            account_label = v_account_label,
            updated_at    = v_now
        where d.space_hash = v_space.space_hash and d.instance_id = v_instance_id;
    end if;

    if p_payload ? 'history' and jsonb_typeof(p_payload -> 'history') = 'array' then
        for v_hist_item in
            select elem
            from jsonb_array_elements(p_payload -> 'history') with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            v_url := public._besing_clean_url(v_hist_item ->> 'url');
            if v_url is null then
                continue;
            end if;

            v_host := left(lower(coalesce(nullif(btrim(v_hist_item ->> 'host'), ''), '')), 160);
            if v_host = '' then
                v_host := left(lower(coalesce((regexp_match(v_url, '^https?://([^/:?#]+)'))[1], 'unknown')), 160);
            end if;
            v_title := left(coalesce(v_hist_item ->> 'title', ''), 200);

            begin
                v_visited_at := coalesce((v_hist_item ->> 'visitedAt')::timestamptz, v_now);
            exception when others then
                v_visited_at := v_now;
            end;

            if v_visited_at < v_now - make_interval(days => v_space.retention_days)
               or v_visited_at > v_now + interval '10 minutes' then
                continue;
            end if;
            -- Clamp slightly-ahead client clocks to server time for consistent ordering.
            if v_visited_at > v_now then
                v_visited_at := v_now;
            end if;

            v_bucket := floor(extract(epoch from v_visited_at) / 300)::bigint;

            insert into public.besing_sync_history (
                space_hash, instance_id, device_name, browser, url, url_hash,
                host, title, visited_at, visited_bucket, visit_count, synced_at
            ) values (
                v_space.space_hash, v_instance_id, v_device_name, v_browser, v_url,
                encode(extensions.digest(convert_to(v_url, 'utf8'), 'sha256'), 'hex'),
                v_host, v_title, v_visited_at, v_bucket, 1, v_now
            )
            on conflict (space_hash, instance_id, url_hash, visited_bucket) do update
            set visited_at  = greatest(public.besing_sync_history.visited_at, excluded.visited_at),
                title       = case when excluded.title <> '' then excluded.title else public.besing_sync_history.title end,
                device_name = excluded.device_name,
                visit_count = least(public.besing_sync_history.visit_count + 1, 999),
                synced_at   = v_now;

            v_hist_count := v_hist_count + 1;
        end loop;
    end if;

    if p_payload ? 'usage' and jsonb_typeof(p_payload -> 'usage') = 'array' then
        for v_usage_item in
            select elem
            from jsonb_array_elements(p_payload -> 'usage') with ordinality as arr(elem, ord)
            where ord <= 100
        loop
            v_host := left(lower(btrim(coalesce(v_usage_item ->> 'host', ''))), 160);
            if v_host = '' or v_host ~ '[[:space:]]' then
                continue;
            end if;

            begin
                v_day := coalesce((v_usage_item ->> 'day')::date, current_date);
            exception when others then
                v_day := current_date;
            end;

            if v_day < (current_date - v_space.retention_days) or v_day > (current_date + 1) then
                continue;
            end if;

            begin
                v_seconds := greatest(0, least(3600, coalesce((v_usage_item ->> 'seconds')::integer, 0)));
                v_visits  := greatest(0, least(200, coalesce((v_usage_item ->> 'visits')::integer, 0)));
            exception when others then
                continue;
            end;

            if v_seconds = 0 and v_visits = 0 then
                continue;
            end if;

            insert into public.besing_sync_usage (
                space_hash, instance_id, day, host, active_seconds, visits, updated_at
            ) values (
                v_space.space_hash, v_instance_id, v_day, v_host, v_seconds, v_visits, v_now
            )
            on conflict (space_hash, instance_id, day, host) do update
            set active_seconds = least(86400, public.besing_sync_usage.active_seconds + excluded.active_seconds),
                visits         = least(100000, public.besing_sync_usage.visits + excluded.visits),
                updated_at     = v_now;

            v_usage_count := v_usage_count + 1;
        end loop;
    end if;

    if v_space.last_prune_at is null or v_space.last_prune_at < v_now - interval '1 hour' then
        delete from public.besing_sync_history
        where space_hash = v_space.space_hash
          and visited_at < v_now - make_interval(days => v_space.retention_days);
        get diagnostics v_pruned_hist = row_count;

        delete from public.besing_sync_usage
        where space_hash = v_space.space_hash
          and day < (current_date - v_space.retention_days);
        get diagnostics v_pruned_usage = row_count;

        update public.besing_sync_spaces
        set last_activity_at = v_now,
            last_prune_at    = v_now
        where space_hash = v_space.space_hash;
    else
        update public.besing_sync_spaces
        set last_activity_at = v_now
        where space_hash = v_space.space_hash;
    end if;

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'history_accepted', v_hist_count,
        'usage_accepted', v_usage_count,
        'pruned', v_pruned_hist + v_pruned_usage,
        'retention_days', v_space.retention_days
    );
end;
$$;

create or replace function public.besing_sync_pull(
    p_secret        text,
    p_since         timestamptz default null,
    p_device_hashes jsonb default '{}'::jsonb,
    p_history_limit integer default 150
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_space   public.besing_sync_spaces;
    v_now     timestamptz := now();
    v_limit   integer := greatest(1, least(500, coalesce(p_history_limit, 150)));
    v_hashes  jsonb := case when p_device_hashes is not null and jsonb_typeof(p_device_hashes) = 'object'
                            then p_device_hashes else '{}'::jsonb end;
    v_devices jsonb;
    v_history jsonb;
    v_usage   jsonb;
begin
    v_space := public._besing_sync_auth(p_secret);

    select coalesce(jsonb_agg(
        case
            when d.snapshot_hash <> '' and (v_hashes ->> d.instance_id) = d.snapshot_hash then
                jsonb_build_object(
                    'instance_id', d.instance_id,
                    'device_name', d.device_name,
                    'browser', d.browser,
                    'platform', d.platform,
                    'mode', d.mode,
                    'account_label', d.account_label,
                    'snapshot_hash', d.snapshot_hash,
                    'updated_at', d.updated_at,
                    'unchanged', true
                )
            else
                jsonb_build_object(
                    'instance_id', d.instance_id,
                    'device_name', d.device_name,
                    'browser', d.browser,
                    'platform', d.platform,
                    'mode', d.mode,
                    'account_label', d.account_label,
                    'tabs', d.tabs_json,
                    'groups', d.groups_json,
                    'closed', d.closed_json,
                    'snapshot_hash', d.snapshot_hash,
                    'updated_at', d.updated_at,
                    'unchanged', false
                )
        end
        order by d.updated_at desc
    ), '[]'::jsonb)
    into v_devices
    from public.besing_sync_devices d
    where d.space_hash = v_space.space_hash;

    select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
    into v_history
    from (
        select jsonb_build_object(
            'id', h.id,
            'instance_id', h.instance_id,
            'device_name', h.device_name,
            'browser', h.browser,
            'url', h.url,
            'host', h.host,
            'title', h.title,
            'visitedAt', h.visited_at,
            'visitCount', h.visit_count
        ) as row_obj
        from public.besing_sync_history h
        where h.space_hash = v_space.space_hash
          and h.visited_at >= v_now - make_interval(days => v_space.retention_days)
          and (p_since is null or h.synced_at > p_since)
        order by h.visited_at desc
        limit v_limit
    ) sub;

    select coalesce(jsonb_agg(
        jsonb_build_object(
            'instance_id', u.instance_id,
            'day', u.day,
            'host', u.host,
            'seconds', u.active_seconds,
            'visits', u.visits,
            'updatedAt', u.updated_at
        )
    ), '[]'::jsonb)
    into v_usage
    from public.besing_sync_usage u
    where u.space_hash = v_space.space_hash
      and u.day >= (current_date - v_space.retention_days)
      and (p_since is null or u.updated_at > p_since);

    return jsonb_build_object(
        'ok', true,
        'server_time', v_now,
        'retention_days', v_space.retention_days,
        'delta', (p_since is not null),
        'devices', v_devices,
        'history', v_history,
        'usage', v_usage
    );
end;
$$;
